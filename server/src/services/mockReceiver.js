import { randomUUID } from 'node:crypto';
import { safeHeaders } from '../utils/sanitize.js';

const received = [];
/** Bounded, in-memory demo inbox. Payloads disappear on restart by design. */
export function receiveWebhook(body, headers = {}) {
  const item = { id: randomUUID(), receivedAt: new Date().toISOString(), headers: safeHeaders(headers), body };
  received.unshift(item);
  if (received.length > 100) received.length = 100;
  return { id: item.id, received: true };
}
export function listReceived(limit = 50) { return received.slice(0, Math.min(100, Math.max(1, limit))); }
export function clearReceived() { received.length = 0; }
