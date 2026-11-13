import { registerNode } from '../nodeRegistry.js';
import { dispatchAction } from '../../services/deliveryService.js';
import { buildActionRequest } from '../../integrations/actionRequests.js';
import { validateWebhookConfig } from '../../integrations/webhookService.js';
import { safeUrl } from '../../utils/sanitize.js';
import { cooldownErrors, renderTemplate } from './template.js';

/** Day-4 adapter: the registry/cooldown contract is unchanged; I/O lives in integrations/. */
export function createWebhookAction(config, context) {
  return async (event) => {
    const { target, request } = buildActionRequest('webhook', config, event);
    const alert = {
      graphId: context.graphId, nodeId: context.nodeId, type: 'webhook',
      deviceId: event?.deviceId ?? 'unknown', sensorType: event?.sensorType, value: event?.value,
      message: renderTemplate(config.messageTemplate, event), triggeredAt: new Date(),
    };
    const result = { ...alert, url: safeUrl(target), method: request.method, delivered: false, dryRun: Boolean(context.dryRun) };
    if (context.dryRun) return result;
    return dispatchAction(alert, 'webhook', target, request);
  };
}

registerNode({
  type: 'webhook', category: 'action', label: 'Webhook',
  defaults: { url: 'https://example.com/hook', method: 'POST', headers: {}, bodyTemplate: '', cooldownSeconds: 0 },
  validate(config) { return [...validateWebhookConfig(config), ...cooldownErrors(config)]; },
  createAction: createWebhookAction,
});
