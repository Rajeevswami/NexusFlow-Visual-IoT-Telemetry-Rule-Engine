import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';

const { values } = parseArgs({ options: {
  requests: { type: 'string', default: '100' },
  'batch-size': { type: 'string', default: '100' },
  concurrency: { type: 'string', default: '10' },
  url: { type: 'string', default: 'http://localhost:5000' },
} });
const requests = Number(values.requests);
const batchSize = Number(values['batch-size']);
const concurrency = Number(values.concurrency);
if (!Number.isInteger(requests) || requests < 1 || requests > 100_000 ||
    !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000 ||
    !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 200) {
  console.error('Use --requests 1..100000, --batch-size 1..1000, --concurrency 1..200.');
  process.exit(1);
}
const baseUrl = new URL(values.url);
if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('The URL must use HTTP or HTTPS.');
const endpoint = new URL('/api/telemetry/batch', baseUrl);
const timestamp = new Date().toISOString();
// Reusing serialized input keeps client-side generation out of the measurement.
const payload = JSON.stringify(Array.from({ length: batchSize }, (_, i) => ({
  timestamp,
  metadata: { deviceId: `benchmark-${i % 100}`, sensorType: 'temperature', location: 'benchmark' },
  value: 50 + (i % 30),
  unit: '°C',
})));
let nextRequest = 0;
let writes = 0;
let failures = 0;
const started = performance.now();

async function worker() {
  while (nextRequest < requests) {
    nextRequest += 1;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.json();
      if (!response.ok || body.accepted !== batchSize) throw new Error(`HTTP ${response.status}: ${body.error?.message ?? 'unexpected accepted count'}`);
      writes += body.accepted;
    } catch (error) {
      failures += 1;
      if (failures <= 3) console.error(`Request failed: ${error.message}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));
const seconds = (performance.now() - started) / 1000;
console.log(`Accepted ${writes.toLocaleString()} readings in ${seconds.toFixed(2)} s (${failures} failed requests).`);
console.log(`Throughput: ${Math.round(writes / seconds).toLocaleString()} writes/sec. Mid-project target: 5,000 writes/sec (informational).`);
if (failures) process.exitCode = 1;
