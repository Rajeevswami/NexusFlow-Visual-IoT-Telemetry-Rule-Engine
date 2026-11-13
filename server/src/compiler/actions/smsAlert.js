import { registerNode } from '../nodeRegistry.js';
import { dispatchAction } from '../../services/deliveryService.js';
import { buildActionRequest } from '../../integrations/actionRequests.js';
import { maskPhone } from '../../utils/sanitize.js';
import { cooldownErrors, renderTemplate } from './template.js';

const DEFAULT_TEMPLATE = 'ALERT ${deviceId} ${sensorType} = ${value}${unit}';

/** Provider selection, retries and delivery audits are owned by the integration layer. */
export function createSmsAction(config, context) {
  return async (event) => {
    const { target, request } = buildActionRequest('smsAlert', { ...config, messageTemplate: config.messageTemplate || DEFAULT_TEMPLATE }, event);
    const alert = {
      graphId: context.graphId, nodeId: context.nodeId, type: 'smsAlert',
      deviceId: event?.deviceId ?? 'unknown', sensorType: event?.sensorType, value: event?.value,
      message: request.body, triggeredAt: new Date(),
    };
    const result = { ...alert, to: maskPhone(target), delivered: false, dryRun: Boolean(context.dryRun) };
    if (context.dryRun) return result;
    return dispatchAction(alert, 'sms', target, request);
  };
}

registerNode({
  type: 'smsAlert', category: 'action', label: 'SMS Alert',
  defaults: { phone: '+10000000000', messageTemplate: DEFAULT_TEMPLATE, cooldownSeconds: 0 },
  validate(config) {
    const errors = [];
    if (config.phone !== undefined) {
      const phone = String(config.phone).trim();
      if (phone === '' || !/^\+?[0-9 ()-]{6,20}$/.test(phone)) errors.push('phone must be 6-20 digits (optional leading +).');
    }
    if (config.messageTemplate !== undefined && (typeof config.messageTemplate !== 'string' || config.messageTemplate.length > 240)) errors.push('messageTemplate must be a string of 240 characters or fewer.');
    return [...errors, ...cooldownErrors(config)];
  },
  createAction: createSmsAction,
});
