import { renderTemplate } from '../compiler/actions/template.js';
import { buildWebhookRequest } from './webhookService.js';
import { DeliveryError } from './urlSafety.js';

/** One request builder for live actions and the unsaved-node test endpoint. */
export function buildActionRequest(type, config, event) {
  const message = renderTemplate(config.messageTemplate || config.template, event);
  const enriched = { ...event, message };
  if (type === 'webhook') return { channel: 'webhook', target: config.url, request: buildWebhookRequest(config, enriched) };
  if (type === 'smsAlert') {
    const to = String(config.phone ?? '').replace(/[ ()-]/g, '');
    return { channel: 'sms', target: to, request: { to, body: message } };
  }
  if (type === 'email') {
    const to = String(config.to ?? '').trim();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new DeliveryError('A valid email recipient is required.');
    return { channel: 'email', target: to, request: { to, subject: renderTemplate(config.subject || 'NexusFlow alert: ${deviceId}', event).slice(0, 200), body: message } };
  }
  throw new DeliveryError('This node is not an outbound action.');
}
