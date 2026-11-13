import axios from 'axios';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { safeError, safeUrl } from '../utils/sanitize.js';
import { DeliveryError, resolveWebhookUrl, validateHeaderObject } from './urlSafety.js';
import { renderJsonTemplate } from './template.js';

export const WEBHOOK_METHODS = ['GET', 'POST', 'PUT', 'PATCH']; // PATCH retained for Day-2 graphs.
export const WEBHOOK_TIMEOUT_MS = 5000;
export const MAX_ATTEMPTS = 3;
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new DeliveryError('Delivery cancelled.'));
  const onAbort = () => { clearTimeout(timer); reject(new DeliveryError('Delivery cancelled.')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});

export function validateWebhookConfig(config) {
  const errors = [];
  try {
    const url = new URL(config.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) errors.push('url must be an absolute http(s) URL without embedded credentials.');
    if (String(config.url).length > 2048) errors.push('url must be at most 2048 characters.');
  } catch { errors.push('url must be an absolute http(s) URL.'); }
  if (config.method !== undefined && !WEBHOOK_METHODS.includes(String(config.method).toUpperCase())) errors.push(`method must be one of ${WEBHOOK_METHODS.join(', ')}.`);
  try { validateHeaderObject(config.headers); } catch (error) { errors.push(error.message); }
  try { renderJsonTemplate(config.bodyTemplate, { deviceId: 'test-device', sensorType: 'temperature', value: 82.4, unit: '°C', timestamp: new Date(), message: 'Test alert' }); }
  catch (error) { errors.push(error.message); }
  return errors;
}

export function buildWebhookRequest(config, event) {
  validateHeaderObject(config.headers);
  const method = String(config.method ?? 'POST').toUpperCase();
  if (!WEBHOOK_METHODS.includes(method)) throw new DeliveryError('Unsupported webhook method.');
  const body = renderJsonTemplate(config.bodyTemplate, event);
  return { url: String(config.url ?? '').trim(), method, headers: { 'Content-Type': 'application/json', ...config.headers }, body };
}

/**
 * At most THREE total attempts. Network errors/timeouts and 5xx retry after 250/500 ms
 * by default. 4xx and redirects do not retry. DNS is validated and pinned on EVERY attempt.
 * The returned result is safe to broadcast; the request snapshot is kept private.
 */
export async function deliverWebhook(request, { signal, retryBaseMs = env.outboundRetryBaseMs, resolveUrl = resolveWebhookUrl } = {}) {
  let attempts = 0;
  let responseCode = null;
  let error = null;
  while (attempts < MAX_ATTEMPTS) {
    if (signal?.aborted) return { status: 'failed', attempts, responseCode, error: 'Delivery cancelled.' };
    attempts += 1;
    let agents;
    try {
      const resolved = await resolveUrl(request.url);
      agents = resolved;
      const response = await axios.request({
        url: resolved.url,
        method: request.method,
        headers: request.headers,
        ...(request.method === 'GET' ? {} : { data: request.body }),
        timeout: WEBHOOK_TIMEOUT_MS,
        httpAgent: resolved.httpAgent,
        httpsAgent: resolved.httpsAgent,
        proxy: false,
        maxRedirects: 0,
        maxContentLength: 64 * 1024,
        maxBodyLength: 64 * 1024,
        transitional: { clarifyTimeoutError: true },
        validateStatus: () => true,
        signal,
      });
      responseCode = response.status;
      if (response.status >= 200 && response.status < 300) return { status: 'success', attempts, responseCode, error: null };
      error = `Webhook returned HTTP ${response.status}.`;
      if (response.status < 500) return { status: 'failed', attempts, responseCode, error };
    } catch (caught) {
      error = caught instanceof DeliveryError ? caught.message : safeError(caught);
      if (caught instanceof DeliveryError && !caught.retryable) return { status: 'failed', attempts, responseCode: null, error };
      if (signal?.aborted || caught.code === 'ERR_CANCELED') return { status: 'failed', attempts, responseCode, error: 'Delivery cancelled.' };
    } finally {
      agents?.httpAgent?.destroy();
      agents?.httpsAgent?.destroy();
    }
    logger.warn({ channel: 'webhook', target: safeUrl(request.url), attempts, responseCode }, 'Outbound webhook attempt failed');
    if (attempts < MAX_ATTEMPTS) {
      try { await sleep(retryBaseMs * 2 ** (attempts - 1), signal); }
      catch { return { status: 'failed', attempts, responseCode, error: 'Delivery cancelled.' }; }
    }
  }
  return { status: 'failed', attempts, responseCode, error };
}
