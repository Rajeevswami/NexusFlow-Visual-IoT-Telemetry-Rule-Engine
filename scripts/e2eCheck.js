import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

// Uses the server's installed dependency; no root npm install is required.
const require = createRequire(new URL('../server/package.json', import.meta.url));
const WebSocket = require('ws');
const base = process.env.E2E_URL || 'http://localhost:5000';
const deviceId = `e2e-${randomUUID()}`;
const messages = [];
const completed = new Set();
let graphId;
let socket;
let active = false;
let step = '2 Save/load';
let failed = false;

function pass(name, detail) {
  completed.add(name);
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
}
async function api(route, init = {}) {
  const response = await fetch(new URL(route, base), {
    ...init,
    signal: AbortSignal.timeout(10_000),
    headers: {
      'content-type': 'application/json',
      ...(process.env.INGEST_API_KEY ? { 'x-api-key': process.env.INGEST_API_KEY } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${route}: ${response.status} ${body.error?.message || response.statusText}`);
  return body;
}
async function until(check, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(250);
  }
  throw new Error(`Timed out: ${description}`);
}
const alerts = async () => (await api(`/api/alerts?graphId=${graphId}&limit=500`)).data;
const deliveries = async () => (await api(`/api/deliveries?graphId=${graphId}&limit=500`)).data;
const readings = values => values.map(value => ({
  timestamp: new Date().toISOString(),
  metadata: { deviceId, sensorType: 'temperature', location: 'stabilization-check' },
  value,
  unit: 'C',
}));

try {
  await api('/api/health');
  const graph = JSON.parse(readFileSync(new URL('../server/samples/turbine-graph.json', import.meta.url), 'utf8'));
  graph.name = `Stabilization ${deviceId}`;
  graph.nodes[0].data.config.deviceId = deviceId;
  graph.nodes.find(n => n.type === 'smsAlert').data.config.cooldownSeconds = 0;
  graph.nodes.push({
    id: 'webhook-demo', type: 'webhook', position: { x: 900, y: 340 },
    data: { label: 'Mock Webhook', config: {
      url: process.env.DEMO_WEBHOOK_URL || 'http://127.0.0.1:5000/api/mock/webhook-receiver',
      method: 'POST', cooldownSeconds: 0,
      bodyTemplate: '{"device":"{{deviceId}}","value":{{value}}}',
    } },
  });
  graph.edges.push({ id: 'edge-webhook', source: 'threshold-1', target: 'webhook-demo' });
  graphId = (await api('/api/graphs', { method: 'POST', body: JSON.stringify(graph) })).data._id;
  const loaded = (await api(`/api/graphs/${graphId}`)).data;
  for (const key of ['nodes', 'edges', 'viewport']) assert.deepEqual(loaded[key], graph[key]);
  pass(step, 'API round-trip preserves settings and edges; not a browser reload test');

  step = '3 Activate';
  const wsUrl = new URL('/ws', base);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(wsUrl, { handshakeTimeout: 10_000 });
  socket.on('message', raw => {
    try { messages.push(JSON.parse(raw.toString())); } catch { /* non-JSON is not evidence */ }
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'subscribe', channels: [`telemetry:${deviceId}`, `graph:${graphId}`] }));
  await until(() => messages.some(m => m.type === 'subscribed'), 'WebSocket subscription');
  await api(`/api/graphs/${graphId}/compile`, { method: 'POST' });
  active = true;
  await until(async () => (await api('/api/graphs/active')).data.some(g => g.graphId === graphId), 'active graph');
  pass(step);

  step = '4 Anomaly ingestion';
  // Five normal readings followed by five spikes deterministically cross MA(5)>80.
  // Four outbound actions stay below the default per-graph rate budget.
  const batch = readings([45, 45, 45, 45, 45, 99, 99, 99, 99, 99]);
  assert.equal((await api('/api/telemetry/batch', { method: 'POST', body: JSON.stringify(batch) })).accepted, batch.length);
  pass(step, `${batch.length} deterministic simulator-style readings accepted`);

  step = '5 Alerts, deliveries and live events';
  await until(async () => {
    const a = await alerts();
    const d = await deliveries();
    if (d.some(log => log.status === 'failed')) throw new Error('Delivery failed; inspect delivery logs and mock/provider configuration');
    return a.length === 4 && d.length === 4 && d.every(log => log.status === 'success')
      && ['sms', 'webhook'].every(channel => d.some(log => log.channel === channel));
  }, 'four successful alerts/deliveries from both branches');
  const inbox = (await api('/api/mock/webhook-receiver')).data;
  assert.ok(inbox.some(item => item.body.device === deviceId), 'mock receiver must contain this run');
  await until(() => ['telemetry', 'node_activity', 'edge_activity', 'alert', 'delivery'].every(type => messages.some(m => m.type === type)), 'live telemetry/activity/alert/delivery events');
  pass(step, 'both channels succeeded and WebSocket evidence arrived; visual glow/chart still need browser review');

  step = '6 Deactivate';
  await api(`/api/graphs/${graphId}/deactivate`, { method: 'POST' });
  active = false;
  assert.ok(!(await api('/api/graphs/active')).data.some(g => g.graphId === graphId));
  const beforeAlerts = (await alerts()).map(a => a._id).sort();
  const beforeDeliveries = (await deliveries()).map(d => d._id).sort();
  const afterBatch = readings([99, 99, 99, 99, 99]);
  assert.equal((await api('/api/telemetry/batch', { method: 'POST', body: JSON.stringify(afterBatch) })).accepted, afterBatch.length);
  // Check throughout an observation window, rather than comparing client/server clocks.
  for (let i = 0; i < 8; i++) {
    await sleep(250);
    assert.deepEqual((await alerts()).map(a => a._id).sort(), beforeAlerts);
    assert.deepEqual((await deliveries()).map(d => d._id).sort(), beforeDeliveries);
  }
  pass(step, 'no new alerts or deliveries during two-second observation');
} catch (error) {
  failed = true;
  console.error(`FAIL ${step} — ${error.message}`);
} finally {
  socket?.terminate();
  if (graphId) {
    try {
      if (active) await api(`/api/graphs/${graphId}/deactivate`, { method: 'POST' });
      await api(`/api/graphs/${graphId}`, { method: 'DELETE' });
    } catch (error) {
      failed = true;
      console.error(`FAIL cleanup — ${error.message}; inspect graph ${graphId}`);
    }
  }
  for (const name of ['3 Activate', '4 Anomaly ingestion', '5 Alerts, deliveries and live events', '6 Deactivate']) {
    if (!completed.has(name) && name !== step) console.error(`FAIL ${name} — blocked by earlier failure`);
  }
}
console.log('Browser save/reload and actual server restart are separate manual gates. Test telemetry/audit records remain in the disposable database.');
process.exitCode = failed ? 1 : 0;
