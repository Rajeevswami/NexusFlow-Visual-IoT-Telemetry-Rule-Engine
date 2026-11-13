import { DeliveryLog, deliveryDto } from '../models/DeliveryLog.js';
import { retryDelivery, testAction } from '../services/deliveryService.js';
import { getNode, resolveConfig } from '../compiler/nodeRegistry.js';
import '../compiler/actions/index.js';
import { httpError } from '../utils/httpError.js';

export async function listDeliveries(req, res) {
  const { graphId, status, limit } = res.locals.validated.query;
  const filter = {};
  if (graphId) filter.graphId = graphId;
  if (status) filter.status = status;
  const logs = await DeliveryLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ data: logs.map(deliveryDto) });
}
export async function retryDeliveryHandler(req, res) {
  res.status(202).json({ data: await retryDelivery(res.locals.validated.params.id) });
}
export async function testNodeHandler(req, res) {
  const { type, config, event } = res.locals.validated.body;
  const definition = getNode(type);
  const resolved = resolveConfig(type, config);
  const errors = definition.validate(resolved);
  if (errors.length) throw httpError(400, 'Node configuration is invalid.', { details: errors.map((message) => ({ message })) });
  const sample = { ...event, timestamp: event.timestamp ? new Date(event.timestamp) : new Date(), message: 'NexusFlow test alert' };
  const result = await testAction({ type, config: resolved, event: sample });
  res.json({ data: result });
}
