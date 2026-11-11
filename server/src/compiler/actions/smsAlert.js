import { registerNode } from '../nodeRegistry.js';
import { recordAlert } from '../../services/alertService.js';
import { renderTemplate } from './template.js';

const DEFAULT_TEMPLATE = 'ALERT ${deviceId} ${sensorType} = ${value}${unit}';

/**
 * Mock SMS gateway: logs the message and stores it in the `alerts` collection.
 * Swapping this for Twilio/MSG91 later only requires replacing this handler.
 */
export function createSmsAction(config, context) {
  const phone = String(config.phone ?? '').trim() || '+10000000000';
  const template = config.messageTemplate || DEFAULT_TEMPLATE;

  return async (event) => {
    const message = renderTemplate(template, event);
    const result = {
      nodeId: context.nodeId,
      type: 'smsAlert',
      deviceId: event?.deviceId ?? 'unknown',
      sensorType: event?.sensorType,
      value: event?.value,
      message,
      to: phone,
      triggeredAt: new Date(),
      delivered: false,
      dryRun: Boolean(context.dryRun),
    };

    // Dry runs never contact the provider and never touch the database.
    if (context.dryRun) return result;

    console.info(`[sms -> ${phone}] ${message}`);
    const saved = await recordAlert({
      graphId: context.graphId,
      nodeId: context.nodeId,
      type: 'smsAlert',
      deviceId: result.deviceId,
      sensorType: result.sensorType,
      value: result.value,
      message,
      triggeredAt: result.triggeredAt,
    });
    result.alertId = saved?._id?.toString();
    result.delivered = Boolean(saved);
    return result;
  };
}

registerNode({
  type: 'smsAlert',
  category: 'action',
  label: 'SMS Alert',
  defaults: { phone: '+10000000000', messageTemplate: DEFAULT_TEMPLATE },
  validate(config) {
    const errors = [];
    if (config.phone !== undefined) {
      const phone = String(config.phone).trim();
      if (phone === '' || !/^\+?[0-9 ()-]{6,20}$/.test(phone)) errors.push('phone must be 6-20 digits (optional leading +).');
    }
    if (config.messageTemplate !== undefined && String(config.messageTemplate).length > 240) {
      errors.push('messageTemplate must be 240 characters or fewer.');
    }
    return errors;
  },
  createAction: createSmsAction,
});
