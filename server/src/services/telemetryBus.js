import { Subject } from 'rxjs';

/**
 * Central in-memory telemetry event bus (RxJS hot Subject).
 *
 * Every reading that enters NexusFlow — HTTP single, HTTP batch or WebSocket — is pushed
 * into this one Subject. Subscribers (ruleExecutor, the WebSocket broadcaster) attach
 * once at boot and stay attached; nothing about a reading's journey loops over graphs
 * or re-creates subscriptions.
 *
 * The bus also owns the engine counters surfaced by `GET /api/engine/status`, because
 * every message passes through here exactly once.
 */

/** @type {import('rxjs').Subject<object>} */
const subject = new Subject();

/** Rolling 100 ms slots used to derive a smooth messages-per-second figure. */
const slots = new Map();
let messagesProcessed = 0;
let alertsFired = 0;

const SLOT_MS = 100;
const SLOTS_TO_KEEP = 20; // 2 s of history is enough for a 1 s rolling window

function recordMessage() {
  messagesProcessed += 1;
  const slot = Math.floor(Date.now() / SLOT_MS);
  slots.set(slot, (slots.get(slot) ?? 0) + 1);
  if (slots.size > SLOTS_TO_KEEP) {
    const cutoff = slot - SLOTS_TO_KEEP;
    for (const key of slots.keys()) if (key < cutoff) slots.delete(key);
  }
}

/** Readings seen in the last ~1000 ms. */
function messagesPerSecond() {
  const cutoff = Math.floor(Date.now() / SLOT_MS) - Math.round(1000 / SLOT_MS) + 1;
  let total = 0;
  for (const [slot, count] of slots) if (slot >= cutoff) total += count;
  return total;
}

export const telemetryBus = {
  /** Observable view — subscribers never push into the bus. */
  stream$: subject.asObservable(),

  /**
   * Push a single reading into the bus. Synchronous and non-blocking: subscribers run
   * inline (RxJS Subject semantics) and must therefore never throw.
   *
   * @param {object} reading persisted telemetry document (or a WS-ingested reading)
   */
  next(reading) {
    if (!reading || typeof reading !== 'object') return;
    recordMessage();
    subject.next(reading);
  },

  /**
   * Push a batch of readings (used by the HTTP and WebSocket ingestion paths).
   * @param {object[]} readings
   * @returns {number} how many readings were published
   */
  ingest(readings) {
    if (!Array.isArray(readings) || readings.length === 0) return 0;
    for (const reading of readings) this.next(reading);
    return readings.length;
  },

  /**
   * Subscribe to every reading. Returns an RxJS Subscription — callers must
   * unsubscribe on shutdown so the process can exit cleanly.
   * @param {(reading: object) => void} handler
   * @returns {import('rxjs').Subscription}
   */
  subscribe(handler) {
    return subject.subscribe({ next: handler, error: () => {}, complete: () => {} });
  },

  /** Called by the alert pipeline whenever an action node actually fires. */
  recordAlertFired() {
    alertsFired += 1;
  },

  /** Snapshot for `GET /api/engine/status`. */
  stats() {
    return {
      messagesProcessed,
      messagesPerSecond: messagesPerSecond(),
      alertsFired,
    };
  },

  /** Test helper: zero the counters between suites. */
  resetStats() {
    messagesProcessed = 0;
    alertsFired = 0;
    slots.clear();
  },
};

export default telemetryBus;
