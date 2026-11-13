import logger from '../config/logger.js';
import { Telemetry } from '../models/Telemetry.js';
import { telemetryBus } from '../services/telemetryBus.js';

/**
 * Persist the readings, respond 202 immediately, then fan out.
 *
 * Hot path contract: the HTTP response never waits for rule evaluation or WebSocket
 * delivery. `insertMany` runs first so the 202 is honest about durability; everything
 * else (telemetryBus -> ruleExecutor -> RxJS pipelines, channel broadcast) happens on
 * the next tick after the response is flushed.
 */
async function insertAndAccept(readings, res) {
  // Zod has already validated/cast the complete payload. lean avoids a second
  // Mongoose hydration/validation pass on this high-throughput path.
  const inserted = await Telemetry.insertMany(readings, { ordered: false, lean: true });
  res.status(202).json({ accepted: inserted.length });
  setImmediate(() => {
    try { telemetryBus.ingest(inserted); }
    catch (error) { logger.error({ err: error }, 'Telemetry fan-out failed:'); }
  });
}

export async function ingestReading(req, res) {
  await insertAndAccept([res.locals.validated.body], res);
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

/**
 * GET /api/telemetry/stats?deviceId=&window=5m
 * Per-minute buckets (avg / min / max / count) via a MongoDB aggregation pipeline.
 * The first stage always matches on `timestamp`, which time-series collections require.
 */
export async function getTelemetryStats(req, res) {
  const { deviceId, windowMs } = res.locals.validated.query;
  const since = new Date(Date.now() - windowMs);
  const match = { timestamp: { $gte: since } };
  if (deviceId) match['metadata.deviceId'] = deviceId;

  const buckets = await Telemetry.aggregate([
    { $match: match },
    {
      $group: {
        _id: { minute: { $dateTrunc: { date: '$timestamp', unit: 'minute' } } },
        avg: { $avg: '$value' },
        min: { $min: '$value' },
        max: { $max: '$value' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.minute': 1 } },
    {
      $project: {
        _id: 0,
        minute: '$_id.minute',
        avg: { $round: ['$avg', 3] },
        min: 1,
        max: 1,
        count: 1,
      },
    },
  ]).allowDiskUse(true);

  res.json({
    data: {
      deviceId: deviceId ?? null,
      since,
      window: `${Math.round(windowMs / 60_000)}m`,
      buckets,
    },
  });
}
