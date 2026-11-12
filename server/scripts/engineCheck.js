import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

/**
 * End-to-end engine check (Day 3 definition of done).
 *
 *   1. activates the sample turbine graph (Sensor -> MovingAverage(5) -> Threshold(>80) -> SMS),
 *   2. pushes a deterministic series of readings with anomaly spikes over HTTP or WebSocket,
 *   3. replays the same window logic locally to compute the EXPECTED alert count,
 *   4. reads back /api/alerts and prints fired vs expected (PASS/FAIL).
 *
 * Usage:  node scripts/engineCheck.js [--url http://localhost:5000] [--rounds 60]
 *          [--spike-every 7] [--transport http|ws] [--cooldown 0] [--keep]
 */

const { values } = parseArgs({ options: {
  url: { type: 'string', default: process.env.ENGINE_CHECK_URL ?? 'http://localhost:5000' },
  rounds: { type: 'string', default: '60' },
  'spike-every': { type: 'string', default: '7' },
  transport: { type: 'string', default: 'http' },
  cooldown: { type: 'string', default: '0' },
  keep: { type: 'boolean', default: false },
} });

const baseUrl = new URL(values.url);
const rounds = Number(values.rounds);
const spikeEvery = Number(values['spike-every']);
const cooldown = Number(values.cooldown);
const transport = String(values.transport).toLowerCase();
if (!Number.isInteger(rounds) || rounds < 10 || rounds > 1000) { console.error('--rounds must be 10..1000.'); process.exit(1); }
if (!Number.isInteger(spikeEvery) || spikeEvery < 2) { console.error('--spike-every must be >= 2.'); process.exit(1); }
if (!['http', 'ws'].includes(transport)) { console.error('--transport must be http or ws.'); process.exit(1); }

const api = (path, init) => fetch(new URL(path, baseUrl), { headers: { 'Content-Type': 'application/json' }, ...init });
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function json(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error?.message ?? 'request failed'}`);
  return body;
}

/* ------------------------------------------------------------------ 1. graph */
const sample = JSON.parse(readFileSync(fileURLToPath(new URL('../samples/turbine-graph.json', import.meta.url)), 'utf8'));

const health = await api('/api/health').then(json).catch((error) => { console.error(`Server unreachable at ${baseUrl}: ${error.message}`); process.exit(1); });
if (health.status !== 'ok') { console.error(`MongoDB is not connected (${health.database}). Start mongod first.`); process.exit(1); }

const graphs = (await json(await api('/api/graphs'))).data;
let graphId = graphs.find((graph) => graph.name === sample.name)?._id;
if (!graphId) {
  graphId = (await json(await api('/api/graphs', { method: 'POST', body: JSON.stringify(sample) }))).data._id;
  console.log(`Created graph "${sample.name}" (${graphId}).`);
} else {
  console.log(`Reusing saved graph "${sample.name}" (${graphId}).`);
}
if (cooldown > 0) sample.nodes.find((node) => node.type === 'smsAlert').data.config.cooldownSeconds = cooldown;

const activation = (await json(await api(`/api/graphs/${graphId}/compile`, { method: 'POST' }))).data;
console.log(`Activated: ${activation.nodeCount} nodes, source ${activation.sources[0].key}, subscriptions ${activation.subscriptions}.`);

/* ------------------------------------------------------- 2. deterministic series */
const DEVICE = 'turbine-001';
const SENSOR = 'temperature';
const runStart = new Date(Date.now() - 50);
const readings = [];
for (let i = 1; i <= rounds; i += 1) {
  const spike = i % spikeEvery === 0;
  const value = spike ? 95 + (i % 3) * 2 : 45 + (i % 5); // normals 45..49, spikes 95..99
  readings.push({
    timestamp: new Date(runStart.getTime() + i).toISOString(),
    metadata: { deviceId: DEVICE, sensorType: SENSOR, location: 'Engine check' },
    value: Math.round(value * 100) / 100,
    unit: '°C',
  });
}

/* ------------------------------------- 3. expected count (local replay of the rule)
   movingAverage(5) uses bufferCount(5, 1): it emits a (possibly partial) window on
   every reading, threshold passes when the window average is > 80. */
let expected = 0;
const window = [];
for (const reading of readings) {
  window.push(reading.value);
  if (window.length > 5) window.shift();
  const avg = window.reduce((sum, v) => sum + v, 0) / window.length;
  if (avg > 80) expected += 1;
}

/* ------------------------------------------------------------- 4. send readings */
let sent = 0;
if (transport === 'http') {
  const response = await json(await api('/api/telemetry/batch', { method: 'POST', body: JSON.stringify(readings) }));
  sent = response.accepted;
} else {
  const wsUrl = new URL('/ws', `${baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${baseUrl.host}`);
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let acked = 0;
  socket.on('message', (raw) => {
    try { if (JSON.parse(raw.toString()).type === 'ack') acked += 1; } catch { /* ignore */ }
  });
  for (const reading of readings) socket.send(JSON.stringify({ type: 'telemetry', data: reading }));
  while (acked < readings.length) await sleepMs(25);
  sent = acked;
  socket.close();
}
console.log(`Sent ${sent} readings over ${transport.toUpperCase()} at ${runStart.toISOString()} (spike every ${spikeEvery}).`);

// Give MongoDB writes + rule evaluation + alert persistence a moment to settle.
await sleepMs(900);

/* ---------------------------------------------------------- 5. count the alerts */
const alerts = (await json(await api(`/api/alerts?deviceId=${DEVICE}&limit=500`))).data;
const fired = alerts.filter((alert) => String(alert.graphId) === String(graphId) && new Date(alert.triggeredAt) >= runStart);
const status = (await json(await api('/api/engine/status'))).data;

/* ------------------------------------------------------------- 6. report + exit */
const pass = fired.length === expected;
console.log('');
console.log('---------------- NexusFlow engine check ----------------');
console.log(`  graph            : ${graphId} (cooldown ${cooldown}s)`);
console.log(`  readings sent    : ${sent}`);
console.log(`  alerts expected  : ${expected}`);
console.log(`  alerts fired     : ${fired.length}${fired.length ? `  (first: "${fired[fired.length - 1]?.message}")` : ''}`);
console.log(`  engine status    : ${status.activeGraphs} active graph(s), ${status.messagesProcessed} processed, ${status.alertsFired} alerts fired total`);
console.log(`  result           : ${pass ? 'PASS ✓' : 'FAIL ✗'}`);
console.log('--------------------------------------------------------');

if (!values.keep) {
  try { await api(`/api/graphs/${graphId}/deactivate`, { method: 'POST' }); console.log('Graph deactivated.'); }
  catch (error) { console.error(`Deactivate failed: ${error.message}`); }
}
process.exitCode = pass ? 0 : 1;
