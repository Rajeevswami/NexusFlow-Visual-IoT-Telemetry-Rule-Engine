import { Graph } from '../models/Graph.js';
import { Telemetry } from '../models/Telemetry.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getTemplates } from '../data/templates.js';
import { activeGraphManager } from './activeGraphManager.js';
import { telemetryBus } from './telemetryBus.js';
import { resolveWebhookUrl } from '../integrations/urlSafety.js';
import { httpError } from '../utils/httpError.js';

let current = null;
let starting = null;
let tick = 0;
let writing = false;
const TEMPERATURES = [52, 54, 51, 53, 55, 96, 98, 97, 99, 96, 55, 52];

async function persistAndPublish() {
  if (!current || writing) return;
  writing = true;
  const state = current;
  const index = tick++ % TEMPERATURES.length;
  const timestamp = new Date();
  const readings = [
    ['temperature', TEMPERATURES[index], '°C'],
    ['vibration', index >= 5 && index <= 9 ? 6.2 : 1.4, 'mm/s'],
    ['pressure', 4.2 + (index % 3) * 0.2, 'bar'],
  ].map(([sensorType, value, unit]) => ({ timestamp, metadata: { deviceId: 'turbine-001', sensorType, location: 'Demo Lab' }, value, unit }));
  try {
    const inserted = await Telemetry.insertMany(readings, { ordered: false, lean: true });
    state.accepted += inserted.length;
    if (current === state) telemetryBus.ingest(inserted);
  } catch (error) {
    state.errors += 1;
    logger.error({ err: error }, 'Demo telemetry persistence failed');
  } finally { writing = false; }
}

export function demoStatus() {
  if (!current) return { running: false, accepted: 0, errors: 0 };
  const { timer, endTimer, ...publicState } = current;
  return publicState;
}

export async function startDemo({ durationSeconds = 120 } = {}) {
  if (!env.demoEnabled) throw httpError(403, 'Demo mode is disabled. Set DEMO_ENABLED=true to enable it.');
  if (current) return { ...demoStatus(), graph: await Graph.findById(current.graphId).lean() };
  if (starting) return starting;
  starting = (async () => {
    if (!env.mockReceiverEnabled) throw httpError(409, 'Enable MOCK_RECEIVER_ENABLED=true for the local demo receiver.');
    // No SSRF bypass: the operator must explicitly opt in to the local mock destination.
    try { const resolved = await resolveWebhookUrl(env.demoWebhookUrl); resolved.httpAgent.destroy(); resolved.httpsAgent.destroy(); }
    catch (error) { throw httpError(409, `${error.message} For the local demo set ALLOW_PRIVATE_WEBHOOKS=true and DEMO_WEBHOOK_URL to the server's mock receiver.`); }
    const template = getTemplates()[0];
    const graph = await Graph.findOneAndUpdate({ templateKey: template.key }, { $set: template.graph }, { upsert: true, new: true, runValidators: true }).lean();
    if (!graph) throw httpError(500, 'The demo template could not be prepared.');
    const graphId = String(graph._id);
    await activeGraphManager.activate(graphId);
    const now = Date.now();
    current = { running: true, graphId, accepted: 0, errors: 0, startedAt: new Date(now).toISOString(),
      endsAt: new Date(now + durationSeconds * 1000).toISOString(), intervalMs: 500,
      activityEnabled: env.nodeActivityEnabled, webhookUrl: env.demoWebhookUrl, timer: null, endTimer: null };
    current.timer = setInterval(() => { void persistAndPublish(); }, 500);
    current.endTimer = setTimeout(() => { void stopDemo(); }, durationSeconds * 1000);
    current.timer.unref(); current.endTimer.unref();
    logger.info({ graphId, durationSeconds }, 'Demo simulator started');
    return { ...demoStatus(), graph };
  })();
  try { return await starting; } finally { starting = null; }
}

export async function stopDemo() {
  // A stop that arrives while the demo is still starting must not leave the interval
  // running: wait for the start to settle, then stop whatever it produced.
  if (starting) await starting.catch(() => {});
  if (!current) return { running: false };
  const state = current;
  current = null;
  clearInterval(state.timer); clearTimeout(state.endTimer);
  activeGraphManager.deactivate(state.graphId);
  // Allow an already-started insert to finish before the database disconnects.
  while (writing) await new Promise((resolve) => setTimeout(resolve, 20));
  logger.info({ graphId: state.graphId, accepted: state.accepted }, 'Demo simulator stopped');
  return { running: false, graphId: state.graphId, accepted: state.accepted, errors: state.errors };
}
