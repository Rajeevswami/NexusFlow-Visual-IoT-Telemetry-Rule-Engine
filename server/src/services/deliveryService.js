import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { Alert } from '../models/Alert.js';
import { DeliveryLog, deliveryDto } from '../models/DeliveryLog.js';
import { deliverWebhook, MAX_ATTEMPTS } from '../integrations/webhookService.js';
import { sendSms } from '../integrations/smsService.js';
import { sendEmail } from '../integrations/emailService.js';
import { DeliveryError } from '../integrations/urlSafety.js';
import { recordAlert } from './alertService.js';
import { BoundedQueue, GraphRateLimiter } from './outboundQueue.js';
import { broadcastDelivery } from './websocket.js';
import { httpError } from '../utils/httpError.js';
import { safeError, safeTarget } from '../utils/sanitize.js';

export const outboundQueue = new BoundedQueue({ concurrency: env.outboundConcurrency, limit: env.outboundQueueLimit });
export const outboundRateLimiter = new GraphRateLimiter(env.outboundRatePerMinute);
const jobs = new Map();
const active = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The same retry policy for provider-agnostic SMS/email; webhook retries HTTP itself. */
export async function sendWithRetry(send, { retryBaseMs = env.outboundRetryBaseMs } = {}) {
  let attempts = 0;
  let responseCode = null;
  let error = null;
  while (attempts < MAX_ATTEMPTS) {
    attempts += 1;
    try {
      const result = await send();
      return { status: 'success', attempts, responseCode: result.responseCode ?? 202, error: null };
    } catch (caught) {
      responseCode = caught.responseCode ?? null;
      error = safeError(caught);
      if (!caught.retryable || attempts >= MAX_ATTEMPTS) break;
      await sleep(retryBaseMs * 2 ** (attempts - 1));
    }
  }
  return { status: 'failed', attempts, responseCode, error };
}

async function updateAlertStatus(alertId) {
  if (!alertId) return;
  try {
    const logs = await DeliveryLog.find({ alertId }).select('status').lean();
    const status = logs.some((item) => item.status === 'pending') ? 'pending'
      : logs.some((item) => item.status === 'failed') ? 'failed' : 'success';
    await Alert.updateOne({ _id: alertId }, { $set: { deliveryStatus: status } });
  } catch (error) { logger.error({ err: error }, 'Could not update alert delivery summary'); }
}

async function finalize(id, result, previousAttempts = 0) {
  const job = jobs.get(id);
  try {
    const updated = await DeliveryLog.findByIdAndUpdate(id, {
      $set: { status: result.status, attempts: previousAttempts + result.attempts, responseCode: result.responseCode ?? null,
        error: result.error ?? null, completedAt: new Date() },
    }, { new: true }).lean();
    if (!updated) return result;
    await updateAlertStatus(updated.alertId);
    const data = deliveryDto(updated);
    broadcastDelivery(data);
    logger.info({ deliveryId: id, channel: data.channel, target: safeTarget(data.channel, job?.request?.url ?? updated.target), status: data.status, attempts: data.attempts }, 'Delivery completed');
    return data;
  } catch (error) {
    logger.error({ err: error, deliveryId: id }, 'Could not finalize delivery audit');
    return result;
  }
}

async function executeJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  active.add(id);
  let result;
  try {
    const { channel, request, previousAttempts } = job;
    if (channel === 'webhook') result = await deliverWebhook(request, { signal: job.controller.signal });
    else {
      result = await sendWithRetry(() => channel === 'sms'
        ? sendSms({ to: request.to, body: request.body, signal: job.controller.signal })
        : sendEmail({ to: request.to, subject: request.subject, body: request.body, signal: job.controller.signal }));
    }
  } catch (error) {
    result = { status: 'failed', attempts: 1, responseCode: null, error: safeError(error) };
  }
  const data = await finalize(id, result, job.previousAttempts);
  active.delete(id);
  jobs.delete(id);
  return data;
}

function enqueueDelivery(document) {
  const id = String(document._id);
  if (outboundQueue.stopping || outboundQueue.size >= outboundQueue.limit) {
    return Promise.resolve(finalize(id, { status: 'failed', attempts: 0, error: outboundQueue.stopping ? 'Server is shutting down.' : 'Delivery queue is full.' }));
  }
  if (!outboundRateLimiter.take(document.graphId ? String(document.graphId) : `manual:${document.nodeId}`)) {
    return Promise.resolve(finalize(id, { status: 'failed', attempts: 0, error: `Graph outbound rate limit exceeded (${env.outboundRatePerMinute}/minute).` }));
  }
  const request = document.request;
  jobs.set(id, { request, channel: document.channel, previousAttempts: document.attempts ?? 0, controller: new AbortController() });
  const promise = outboundQueue.enqueue(() => executeJob(id)).catch((error) => {
    if (jobs.has(id) && !active.has(id)) return finalize(id, { status: 'failed', attempts: 0, error: safeError(error) }, document.attempts ?? 0);
    return null;
  });
  return promise;
}

/**
 * Extend the existing action handlers without changing the compiler/cooldown.
 * Persist the audit BEFORE network I/O, then return immediately: a slow external
 * service cannot block ingestion or another graph branch. `delivered` means the
 * provider accepted the message; the initial action result is explicitly pending.
 */
export async function dispatchAction(alert, channel, target, request) {
  const saved = await recordAlert(alert);
  if (!saved) throw new DeliveryError('Alert persistence unavailable; outbound delivery was not sent.');
  const alertId = String(saved._id);
  let log;
  try { log = await DeliveryLog.create({ alertId, graphId: alert.graphId || undefined, nodeId: alert.nodeId, channel, target, request }); }
  catch (error) { logger.error({ err: error }, 'Delivery audit creation failed'); throw new DeliveryError('Delivery audit unavailable; outbound delivery was not sent.'); }
  await Alert.updateOne({ _id: alertId }, { $addToSet: { deliveryIds: log._id }, $set: { deliveryStatus: 'pending' } });
  void enqueueDelivery(log.toObject());
  return { ...alert, alertId, deliveryIds: [String(log._id)], deliveryStatus: 'pending', deliveryId: String(log._id), delivered: false, pending: true };
}

/** Unsaved action-node test: real delivery + audit, but not a production graph alert. */
export async function testAction({ type, config, event }) {
  const { buildActionRequest } = await import('../integrations/actionRequests.js');
  const { channel, target, request } = buildActionRequest(type, config, event);
  let log;
  try { log = await DeliveryLog.create({ nodeId: event.nodeId ?? 'node-test', channel, target, request }); }
  catch { throw httpError(503, 'Delivery audit unavailable. Try again when MongoDB is connected.'); }
  const result = await enqueueDelivery(log.toObject());
  return result ?? deliveryDto(log);
}

export async function retryDelivery(id) {
  const existing = await DeliveryLog.findById(id).select('+request').lean();
  if (!existing) throw httpError(404, 'Delivery not found.');
  if (existing.status !== 'failed') throw httpError(409, 'Only failed deliveries can be retried.');
  if (!existing.request) throw httpError(409, 'This delivery has no retry snapshot.');
  // Atomic claim prevents two clicks from sending the same failed delivery twice.
  const claimed = await DeliveryLog.findOneAndUpdate({ _id: id, status: 'failed' }, {
    $set: { status: 'pending', error: null, completedAt: null, responseCode: null },
  }, { new: true }).select('+request').lean();
  if (!claimed) throw httpError(409, 'Delivery is already being retried.');
  await updateAlertStatus(claimed.alertId);
  broadcastDelivery(deliveryDto(claimed));
  void enqueueDelivery(claimed);
  return deliveryDto(claimed);
}

/** Abort in-flight HTTP, fail queued audits, then wait for workers to settle. */
export async function shutdownDeliveries() {
  outboundQueue.clear();
  for (const [id, job] of jobs) {
    if (active.has(id)) job.controller.abort();
    else {
      jobs.delete(id);
      await finalize(id, { status: 'failed', attempts: 0, error: 'Delivery cancelled during shutdown.' }, job.previousAttempts);
    }
  }
  await outboundQueue.onIdle();
  jobs.clear();
  outboundRateLimiter.clear();
}
