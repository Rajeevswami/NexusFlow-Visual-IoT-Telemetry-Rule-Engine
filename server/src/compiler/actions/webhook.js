import axios from 'axios';
import { registerNode } from '../nodeRegistry.js';
import { recordAlert } from '../../services/alertService.js';
import { renderTemplate } from './template.js';

const METHODS = ['POST', 'PUT', 'PATCH'];
const TIMEOUT_MS = 3000;

/**
 * Outgoing HTTP call. Timeouts and failures are captured in the result instead of
 * being thrown, so a dead endpoint can never break the pipeline.
 */
export function createWebhookAction(config, context) {
  const rawUrl = String(config.url ?? '').trim();
  const method = METHODS.includes(String(config.method).toUpperCase()) ? String(config.method).toUpperCase() : 'POST';
  let url = null;
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
    url = parsed.toString();
  } catch {
    url = null;
  }

  return async (event) => {
    const payload = {
      deviceId: event?.deviceId,
      sensorType: event?.sensorType,
      value: event?.value,
      unit: event?.unit,
      timestamp: event?.timestamp ?? new Date().toISOString(),
      graphId: context.graphId ?? null,
      nodeId: context.nodeId ?? null,
    };
    const result = {
      nodeId: context.nodeId,
      type: 'webhook',
      deviceId: payload.deviceId ?? 'unknown',
      sensorType: payload.sensorType,
      value: payload.value,
      message: `${method} ${url ?? rawUrl}`,
      url: url ?? rawUrl,
      method,
      triggeredAt: new Date(),
      delivered: false,
      dryRun: Boolean(context.dryRun),
    };

    if (context.dryRun) return result;
    if (!url) {
      result.error = 'Invalid webhook URL.';
      console.error(`[webhook] invalid url "${rawUrl}"`);
      return result;
    }

    try {
      const response = await axios.request({ url, method, data: payload, timeout: TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } });
      result.status = response.status;
      result.delivered = true;
    } catch (error) {
      result.error = error.code === 'ECONNABORTED' ? `Request timed out after ${TIMEOUT_MS} ms.` : error.message;
      console.error(`[webhook ${method} ${url}] failed: ${result.error}`);
    }

    await recordAlert({
      graphId: context.graphId,
      nodeId: context.nodeId,
      type: 'webhook',
      deviceId: result.deviceId,
      sensorType: result.sensorType,
      value: result.value,
      message: result.delivered ? `${method} ${url} -> ${result.status}` : `${method} ${url} failed: ${result.error}`,
      triggeredAt: result.triggeredAt,
    });
    return result;
  };
}

registerNode({
  type: 'webhook',
  category: 'action',
  label: 'Webhook',
  defaults: { url: 'https://example.com/hook', method: 'POST' },
  validate(config) {
    const errors = [];
    if (config.url !== undefined) {
      try {
        const parsed = new URL(String(config.url));
        if (!['http:', 'https:'].includes(parsed.protocol)) errors.push('url must use http or https.');
      } catch {
        errors.push('url must be an absolute http(s) URL.');
      }
    }
    if (config.method !== undefined && !METHODS.includes(String(config.method).toUpperCase())) {
      errors.push(`method must be one of ${METHODS.join(', ')}.`);
    }
    return errors;
  },
  createAction: createWebhookAction,
});
