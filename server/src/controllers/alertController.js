import { Alert } from '../models/Alert.js';

/**
 * GET /api/alerts — recent alerts raised by action nodes, newest first.
 * Filters: graphId, deviceId, limit (all optional).
 */
export async function listAlertsHandler(req, res) {
  const { graphId, deviceId, from, to, limit } = res.locals.validated.query;
  const filter = {};
  if (graphId) filter.graphId = graphId;
  if (deviceId) filter.deviceId = deviceId;
  if (from || to) filter.triggeredAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const data = await Alert.find(filter).sort({ triggeredAt: -1 }).limit(limit).lean();
  res.json({ data });
}
