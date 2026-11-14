import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';

/**
 * Ingestion throughput benchmark.
 *
 * Drives POST /api/telemetry/batch with a closed-loop load generator and reports the
 * numbers a reviewer will ask for:
 *
 *   total writes | duration | writes/sec | p50 | p95 | p99 latency | errors
 *
 * Usage
 *   npm run benchmark -- --duration 30 --target 5000
 *   npm run benchmark -- --requests 500 --batch-size 100 --concurrency 20
 *   npm run benchmark -- --url https://api.example.com --key $INGEST_API_KEY
 *
 * Notes
 *   - `--duration` (seconds) is a duration-bounded run; `--requests` is a count-bounded
 *     one. Duration wins when both are given.
 *   - `--warmup` seconds are executed and then discarded so JIT/connection setup does
 *     not pollute the measurement window.
 *   - A closed loop means the client is itself the ceiling: if the measured throughput
 *     is below the target, raise `--concurrency` rather than assuming the server is slow.
 *   - Set INGEST_API_KEY in the environment (or --key) when the server requires it.
 */

const { values } = parseArgs({ options: {
  requests: { type: 'string', default: '0' },
  'batch-size': { type: 'string', default: '100' },
  concurrency: { type: 'string', default: '16' },
  duration: { type: 'string', default: '30' },
  warmup: { type: 'string', default: '3' },
  target: { type: 'string', default: '5000' },
  url: { type: 'string', default: process.env.BENCHMARK_URL ?? 'http://localhost:5000' },
  key: { type: 'string', default: process.env.INGEST_API_KEY ?? '' },
} });

const requests = Number(values.requests);
const batchSize = Number(values['batch-size']);
const concurrency = Number(values.concurrency);
const durationSeconds = Number(values.duration);
const warmupSeconds = Number(values.warmup);
const target = Number(values.target);

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
  console.error('Use --batch-size 1..1000 (the API caps a batch at 1000 readings).');
  process.exit(1);
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 512) {
  console.error('Use --concurrency 1..512.');
  process.exit(1);
}
if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 3600) {
  console.error('Use --duration 1..3600 seconds.');
  process.exit(1);
}
if (!Number.isFinite(warmupSeconds) || warmupSeconds < 0 || warmupSeconds > 300) {
  console.error('Use --warmup 0..300 seconds.');
  process.exit(1);
}
if (values.requests !== '0' && (!Number.isInteger(requests) || requests < 1 || requests > 1_000_000)) {
  console.error('Use --requests 1..1000000, or 0 for a duration-bounded run.');
  process.exit(1);
}

const baseUrl = new URL(values.url);
if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('The URL must use HTTP or HTTPS.');
const endpoint = new URL('/api/telemetry/batch', baseUrl);
const useDuration = values.requests === '0';

// Reusing one serialized payload keeps client-side JSON generation out of the measurement.
const timestamp = new Date().toISOString();
const payload = JSON.stringify(Array.from({ length: batchSize }, (_, i) => ({
  timestamp,
  metadata: { deviceId: `benchmark-${i % 100}`, sensorType: 'temperature', location: 'benchmark' },
  value: 50 + (i % 30),
  unit: '°C',
})));
const headers = { 'Content-Type': 'application/json', ...(values.key ? { 'x-api-key': values.key } : {}) };

/* ------------------------------------------------------------------ load + stats */

/** Latencies of the measured window only, in milliseconds. */
const latencies = [];
let warmupWrites = 0;
let measuredWrites = 0;
let warmupErrors = 0;
let errors = 0;
let measuredRequests = 0;
let attempts = 0; // every request started, successful or not

const started = performance.now();
const warmupEndsAt = started + warmupSeconds * 1000;
const measureEndsAt = warmupEndsAt + durationSeconds * 1000;
const counting = () => performance.now() >= warmupEndsAt;

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

async function worker() {
  // Keep issuing requests until the run is over (duration mode) or the budget is spent.
  while (useDuration ? performance.now() < measureEndsAt : attempts < requests) {
    if (useDuration && performance.now() >= measureEndsAt) break;
    if (useDuration && performance.now() >= measureEndsAt) break;
    attempts += 1;
    const count = counting();
    const requestStarted = performance.now();
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: payload,
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.json();
      if (!response.ok || body.accepted !== batchSize) {
        throw new Error(`HTTP ${response.status}: ${body.error?.message ?? 'unexpected accepted count'}`);
      }
      const elapsed = performance.now() - requestStarted;
      if (count) {
        measuredWrites += body.accepted;
        latencies.push(elapsed);
        measuredRequests += 1;
      } else {
        warmupWrites += body.accepted;
      }
    } catch (error) {
      if (count) {
        errors += 1;
        if (errors <= 3) console.error(`Request failed: ${error.message}`);
      } else {
        warmupErrors += 1;
      }
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, useDuration ? concurrency : requests) }, worker));

/* ---------------------------------------------------------------------- report */

const measuredSeconds = Math.max(0.001, (performance.now() - warmupEndsAt) / 1000);
const writesPerSecond = measuredWrites / measuredSeconds;
const requestsPerSecond = measuredRequests / measuredSeconds;
const sorted = latencies.slice().sort((a, b) => a - b);
const p50 = percentile(sorted, 0.5);
const p95 = percentile(sorted, 0.95);
const p99 = percentile(sorted, 0.99);
const mean = sorted.length ? sorted.reduce((total, value) => total + value, 0) / sorted.length : 0;

const table = (rows) => rows.map(([label, value]) => `  ${label.padEnd(26)} ${value}`).join('\n');

console.log('---------------- NexusFlow ingestion benchmark ----------------');
console.log(table([
  ['endpoint', `${endpoint} (batch ${batchSize})`],
  ['concurrency', concurrency],
  ['warmup', `${warmupSeconds}s (${warmupWrites.toLocaleString()} writes, ${warmupErrors} errors)`],
  ['measured window', `${measuredSeconds.toFixed(2)}s`],
  ['total writes', measuredWrites.toLocaleString()],
  ['requests', `${measuredRequests.toLocaleString()} (${requestsPerSecond.toFixed(1)} req/s)`],
  ['throughput', `${Math.round(writesPerSecond).toLocaleString()} writes/sec`],
  ['target', `${target.toLocaleString()} writes/sec (${writesPerSecond >= target ? 'MET' : 'not met'})`],
  ['latency mean', `${mean.toFixed(1)} ms`],
  ['latency p50', `${p50.toFixed(1)} ms`],
  ['latency p95', `${p95.toFixed(1)} ms`],
  ['latency p99', `${p99.toFixed(1)} ms`],
  ['errors', `${errors} failed request(s)`],
]));
console.log('----------------------------------------------------------------');

// Machine-readable line for pasting into docs/PERFORMANCE_REPORT.md.
console.log(JSON.stringify({
  benchmark: 'ingestion',
  batchSize,
  concurrency,
  durationSeconds: Number(measuredSeconds.toFixed(2)),
  warmupSeconds,
  totalWrites: measuredWrites,
  writesPerSecond: Math.round(writesPerSecond),
  requestsPerSecond: Number(requestsPerSecond.toFixed(1)),
  targetWritesPerSecond: target,
  latencyMs: { mean: Number(mean.toFixed(1)), p50: Number(p50.toFixed(1)), p95: Number(p95.toFixed(1)), p99: Number(p99.toFixed(1)) },
  errors,
}));

if (errors) process.exitCode = 1;
