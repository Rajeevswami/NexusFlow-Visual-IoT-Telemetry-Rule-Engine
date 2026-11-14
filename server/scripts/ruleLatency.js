import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';

/**
 * End-to-end rule latency: POST a reading -> the alert arrives over WebSocket.
 *
 * The script subscribes to the `alerts` channel, pushes readings that are guaranteed to
 * fire the compiled rule (a value above the threshold, with a moving-average window of
 * 1) and measures the time from the HTTP request leaving to the matching `alert`
 * message arriving on the socket.
 *
 * Usage
 *   npm run rule-latency -- --url http://localhost:5000 --samples 30
 *   npm run rule-latency -- --graph <graphId> --device turbine-001 --sensor temperature
 *
 * The server must already have the graph compiled (POST /api/graphs/:id/compile); the
 * script compiles it itself when --activate is passed or when no active graph matches.
 */

const { values } = parseArgs({ options: {
  url: { type: 'string', default: process.env.RULE_LATENCY_URL ?? 'http://localhost:5000' },
  samples: { type: 'string', default: '30' },
  device: { type: 'string', default: process.env.RULE_LATENCY_DEVICE ?? 'turbine-001' },
  sensor: { type: 'string', default: process.env.RULE_LATENCY_SENSOR ?? 'temperature' },
  value: { type: 'string', default: process.env.RULE_LATENCY_VALUE ?? '96' },
  graph: { type: 'string', default: '' },
  activate: { type: 'boolean', default: false },
  key: { type: 'string', default: process.env.INGEST_API_KEY ?? '' },
} });

const baseUrl = new URL(values.url);
if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('The URL must use HTTP or HTTPS.');
const samples = Number(values.samples);
const deviceId = values.device;
const sensorType = values.sensor;
const value = Number(values.value);
if (!Number.isInteger(samples) || samples < 1 || samples > 5000) {
  console.error('Use --samples 1..5000.');
  process.exit(1);
}
if (!Number.isFinite(value)) {
  console.error('--value must be a number.');
  process.exit(1);
}

const auth = values.key ? { 'x-api-key': values.key } : {};
const api = async (path, init = {}) => {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...auth, ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error?.message ?? 'request failed'}`);
  return body;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (sorted, fraction) => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
};

try {
  const health = await api('/api/health');
  if (health.status !== 'ok') throw new Error(`MongoDB is not connected (${health.database}).`);

  /* ------------------------------------------------- 1. find (or build) a live graph */
  const active = (await api('/api/graphs/active')).data;
  let graphId = values.graph || active[0]?.graphId || '';
  if (!graphId) {
    // Build a minimal rule that fires on a single reading: Sensor -> Threshold -> Log.
    const graph = {
      name: 'Latency probe rule',
      nodes: [
        { id: 'sensor', type: 'sensor', position: { x: 0, y: 0 }, data: { label: 'Sensor', config: { deviceId, sensorType } } },
        { id: 'limit', type: 'threshold', position: { x: 260, y: 0 }, data: { label: 'Threshold', config: { operator: '>', value: value - 1 } } },
        { id: 'log', type: 'log', position: { x: 520, y: 0 }, data: { label: 'Probe', config: { label: 'latency-probe', cooldownSeconds: 0 } } },
      ],
      edges: [
        { id: 'e1', source: 'sensor', target: 'limit' },
        { id: 'e2', source: 'limit', target: 'log' },
      ],
    };
    graphId = (await api('/api/graphs', { method: 'POST', body: JSON.stringify(graph) })).data._id;
    await api(`/api/graphs/${graphId}/compile`, { method: 'POST' });
  } else if (values.activate || !active.some((entry) => entry.graphId === graphId)) {
    await api(`/api/graphs/${graphId}/compile`, { method: 'POST' });
  }
  console.log(`Measuring alert latency for graph ${graphId} (${deviceId} / ${sensorType}, value ${value}).`);

  /* --------------------------------------------- 2. subscribe to the alerts channel */
  const wsUrl = new URL('/ws', `${baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${baseUrl.host}`);
  const socket = new WebSocket(wsUrl, { headers: auth });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const pending = new Map(); // alertId -> resolve
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type !== 'alert') return;
    const key = `${message.data.deviceId}:${message.data.nodeId}`;
    const resolve = pending.get(key);
    if (resolve) { pending.delete(key); resolve(performance.now()); }
  });
  socket.send(JSON.stringify({ type: 'subscribe', channels: ['alerts', `graph:${graphId}`] }));

  /* ------------------------------------- 3. push readings and time the round trip */
  const latencies = [];
  const failures = [];
  for (let i = 0; i < samples; i += 1) {
    const reading = {
      timestamp: new Date().toISOString(),
      metadata: { deviceId, sensorType, location: 'Latency probe' },
      value: value + (i % 2 === 0 ? 0 : 0.01), // always above the threshold
      unit: '°C',
    };
    const arrived = new Promise((resolve) => {
      pending.set(`${deviceId}:log`, resolve);
      setTimeout(() => { if (pending.delete(`${deviceId}:log`)) resolve(null); }, 10_000);
    });
    const sentAt = performance.now();
    try {
      await api('/api/telemetry', { method: 'POST', body: JSON.stringify(reading) });
    } catch (error) {
      failures.push(`ingestion failed: ${error.message}`);
      continue;
    }
    const receivedAt = await arrived;
    if (receivedAt === null) failures.push(`no alert for reading ${i + 1}`);
    else latencies.push(receivedAt - sentAt);
    // A short pause keeps cooldowns and the moving-average window out of the way.
    await sleep(20);
  }
  socket.close();

  const sorted = latencies.slice().sort((a, b) => a - b);
  const mean = sorted.length ? sorted.reduce((total, item) => total + item, 0) / sorted.length : 0;
  const table = (rows) => rows.map(([label, item]) => `  ${label.padEnd(26)} ${item}`).join('\n');

  console.log('---------------- NexusFlow rule latency ----------------');
  console.log(table([
    ['graph', graphId],
    ['source', `${deviceId} / ${sensorType}`],
    ['samples', `${sorted.length} of ${samples} measured`],
    ['average', `${mean.toFixed(1)} ms`],
    ['p50', `${percentile(sorted, 0.5).toFixed(1)} ms`],
    ['p95', `${percentile(sorted, 0.95).toFixed(1)} ms`],
    ['p99', `${percentile(sorted, 0.99).toFixed(1)} ms`],
    ['min / max', sorted.length ? `${sorted[0].toFixed(1)} / ${sorted.at(-1).toFixed(1)} ms` : 'n/a'],
    ['errors', failures.length],
  ]));
  if (failures.length) for (const failure of failures.slice(0, 5)) console.log(`    ! ${failure}`);
  console.log('--------------------------------------------------------');
  console.log(JSON.stringify({
    latency: 'ingest-to-websocket-alert',
    graphId,
    deviceId, sensorType,
    samples: sorted.length,
    averageMs: Number(mean.toFixed(1)),
    p50Ms: Number(percentile(sorted, 0.5).toFixed(1)),
    p95Ms: Number(percentile(sorted, 0.95).toFixed(1)),
    p99Ms: Number(percentile(sorted, 0.99).toFixed(1)),
    errors: failures.length,
  }));

  if (sorted.length === 0) process.exitCode = 1;
} catch (error) {
  console.error(`Rule latency measurement failed: ${error.message}`);
  process.exitCode = 1;
}
