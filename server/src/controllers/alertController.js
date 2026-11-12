import { Alert } from '../models/Alert.js';

/**
 * GET /api/alerts — recent alerts raised by action nodes, newest first.
 * Filters: graphId, deviceId, limit (all optional).
 */
export async function listAlertsHandler(req, res) {
  const { graphId, deviceId, limit } = res.locals.validated.query;
  const filter = {};
  if (graphId) filter.graphId = graphId;
  if (deviceId) filter.deviceId = deviceId;
  const data = await Alert.find(filter).sort({ triggeredAt: -1 }).limit(limit).lean();
  res.json({ data });
}
