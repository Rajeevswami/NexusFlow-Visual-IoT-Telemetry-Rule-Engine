import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const base = process.env.E2E_URL ?? 'http://localhost:5000';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = async (route, init = {}) => {
  const response = await fetch(new URL(route, base), { ...init, headers: { 'content-type': 'application/json', ...(process.env.INGEST_API_KEY ? { 'x-api-key': process.env.INGEST_API_KEY } : {}), ...init.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${body.error?.message ?? response.statusText}`);
  return body;
};
const report = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed = true; };
let failed = false;
let graphId;
try {
  const sample = JSON.parse(readFileSync(path.join(root, 'server/samples/turbine-graph.json'), 'utf8'));
  sample.nodes.push({ id: 'webhook-demo', type: 'webhook', position: { x: 1200, y: 120 }, data: { label: 'Webhook', config: { url: process.env.DEMO_WEBHOOK_URL ?? `${base}/api/mock/webhook-receiver`, method: 'POST' } } });
  sample.edges.push({ id: 'edge-webhook', source: 'threshold-1', target: 'webhook-demo' });
  const saved = await api('/api/graphs', { method: 'POST', body: JSON.stringify(sample) });
  graphId = saved.data._id;
  const activated = await api(`/api/graphs/${graphId}/compile`, { method: 'POST' });
  report('3 Activate graph', Boolean(activated.data));
  const start = new Date();
  const readings = Array.from({ length: 18 }, (_, i) => ({ timestamp: new Date(start.getTime() + i).toISOString(), metadata: { deviceId: 'turbine-001', sensorType: 'temperature' }, value: i < 3 ? 45 : 99, unit: 'C' }));
  await api('/api/telemetry/batch', { method: 'POST', body: JSON.stringify(readings) });
  await sleep(1200);
  const alerts = (await api(`/api/alerts?deviceId=turbine-001&limit=500`)).data ?? [];
  const ownAlerts = alerts.filter(a => String(a.graphId) === String(graphId) && new Date(a.triggeredAt) >= start);
  const deliveries = (await api(`/api/deliveries?graphId=${graphId}&limit=500`)).data ?? [];
  report('4 Simulator anomaly spikes ingested', true, `${readings.length} readings`);
  report('5 Alerts and delivery evidence', ownAlerts.length > 0 && deliveries.length > 0, `${ownAlerts.length} alerts, ${deliveries.length} delivery records; delivery is asynchronous`);
  await api(`/api/graphs/${graphId}/deactivate`, { method: 'POST' });
  const after = new Date();
  await api('/api/telemetry/batch', { method: 'POST', body: JSON.stringify(readings.map((r, i) => ({ ...r, timestamp: new Date(after.getTime() + i).toISOString(), value: 99 }))) });
  await sleep(600);
  const finalAlerts = (await api(`/api/alerts?deviceId=turbine-001&limit=500`)).data ?? [];
  const newCount = finalAlerts.filter(a => String(a.graphId) === String(graphId) && new Date(a.triggeredAt) >= after).length;
  report('6 Deactivate stops further alerts', newCount === 0, `${newCount} post-deactivation alerts`);
} catch (error) {
  report('API end-to-end run', false, error.message);
} finally {
  if (graphId) { try { await api(`/api/graphs/${graphId}/deactivate`, { method: 'POST' }); } catch { /* best-effort cleanup */ } }
}
process.exitCode = failed ? 1 : 0;
