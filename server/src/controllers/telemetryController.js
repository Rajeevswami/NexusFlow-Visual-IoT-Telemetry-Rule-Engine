import { Telemetry } from '../models/Telemetry.js';
import { broadcastTelemetry } from '../services/websocket.js';
import { activeGraphManager } from '../services/activeGraphManager.js';

async function insertAndAccept(readings, res, single = false) {
  // Zod has already validated/cast the complete payload. lean avoids a second
  // Mongoose hydration/validation pass on this high-throughput path.
  const inserted = await Telemetry.insertMany(readings, { ordered: false, lean: true });
  res.status(202).json({ accepted: inserted.length });
  // Fan-out is best-effort and must never delay or fail the HTTP response:
  // (1) push the readings to the browser, (2) feed every active RxJS pipeline.
  setImmediate(() => {
    try { broadcastTelemetry(single ? inserted[0] : inserted); }
    catch (error) { console.error('WebSocket broadcast failed:', error.message); }
    try { activeGraphManager.publish(inserted); }
    catch (error) { console.error('Failed to publish readings to active graphs:', error.message); }
  });
}

export async function ingestReading(req, res) {
  await insertAndAccept([res.locals.validated.body], res, true);
}

export async function ingestBatch(req, res) {
  await insertAndAccept(res.locals.validated.body, res);
}

export async function getReadings(req, res) {
  const { deviceId, from, to, limit } = res.locals.validated.query;
  const filter = {};
  if (deviceId) filter['metadata.deviceId'] = deviceId;
  if (from || to) {
    filter.timestamp = {};
    if (from) filter.timestamp.$gte = from;
    if (to) filter.timestamp.$lte = to;
  }
  const data = await Telemetry.find(filter).sort({ timestamp: -1 }).limit(limit).lean();
  res.json({ data });
}
