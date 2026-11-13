import { registerNode } from '../nodeRegistry.js';
import { dispatchAction } from '../../services/deliveryService.js';
import { buildActionRequest } from '../../integrations/actionRequests.js';
import { cooldownErrors } from './template.js';

export function createEmailAction(config, context) {
  return async (event) => {
    const { target, request } = buildActionRequest('email', config, event);
    const alert = { graphId: context.graphId, nodeId: context.nodeId, type: 'email', deviceId: event?.deviceId ?? 'unknown',
      sensorType: event?.sensorType, value: event?.value, message: request.body, triggeredAt: new Date() };
    if (context.dryRun) return { ...alert, delivered: false, dryRun: true };
    return dispatchAction(alert, 'email', target, request);
  };
}
registerNode({
  type: 'email', category: 'action', label: 'Email',
  defaults: { to: 'operator@example.com', subject: 'NexusFlow alert: ${deviceId}', messageTemplate: 'ALERT {{deviceId}} {{sensorType}} = {{value}}{{unit}}', cooldownSeconds: 30 },
  validate(config) {
    const errors = [...cooldownErrors(config)];
    if (config.to !== undefined && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(config.to))) errors.push('to must be a valid email address.');
    for (const key of ['subject', 'messageTemplate']) {
      if (config[key] !== undefined && (typeof config[key] !== 'string' || config[key].length > (key === 'subject' ? 200 : 2000))) errors.push(`${key} is too long or is not a string.`);
    }
    return errors;
  },
  createAction: createEmailAction,
});
