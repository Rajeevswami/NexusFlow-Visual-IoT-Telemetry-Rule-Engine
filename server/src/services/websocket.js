import { WebSocket, WebSocketServer } from 'ws';
import { Telemetry } from '../models/Telemetry.js';
import { readingSchema } from '../validation/telemetry.js';
import { telemetryBus } from './telemetryBus.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { secretEquals } from '../utils/sanitize.js';
import { extractInsertedDocs } from '../utils/mongoErrors.js';

/**
 * WebSocket layer: ingestion + channel-based fan-out on `/ws`.
 *
 * Client -> server messages
 *   { type: "subscribe",   channels: ["telemetry:turbine-001", "alerts", "graph:<id>"] }
 *   { type: "unsubscribe", channels: [...] }
 *   { type: "telemetry",   data: { timestamp, metadata, value, unit } }   // same pipeline as HTTP
 *   { type: "ping" }
 *
 * Server -> client messages
 *   { type: "connected" | "subscribed" | "unsubscribed" | "ack" | "pong" | "error", ... }
 *   { type: "telemetry",     data }   // channel `telemetry:<deviceId>` (or `telemetry` for all)
 *   { type: "alert",         data }   // channels `alerts` and `graph:<graphId>`
 *   { type: "node_activity", data }   // channel  `graph:<graphId>`
 *   { type: "edge_activity", data }   // channel  `graph:<graphId>`, ≤10 Hz/edge
 *   { type: "delivery",      data }   // channels `alerts` and `graph:<graphId>`
 *   { type: "graph_status",  data }   // channel  `graph:<graphId>`
 *
 * Delivery is never a blanket broadcast: the server keeps `channel -> Set<socket>` and
 * only writes to sockets that asked for the channel. A socket that buffers more than
 * 1 MB is skipped (slow consumer protection) and dead sockets are reaped by the
 * 30 s ping/pong heartbeat.
 *
 * Backpressure: devices faster than ~20 msg/s are sampled to 10 msg/s on the broadcast
 * path only (latest-wins buffer flushed every 100 ms — the same semantics as RxJS
 * `sampleTime(100)`). Saving and rule evaluation always see every reading.
 */

let socketServer = null;
let busSubscription = null;
const maxBufferedBytes = 1024 * 1024;

/** @type {Map<string, Set<import('ws').WebSocket>>} channel -> subscribers */
const channels = new Map();
/** @type {Map<string, { lastSent: number, pending: object|null, timer: NodeJS.Timeout|null }>} */
const deviceFlushers = new Map();
/** @type {Map<string, number>} "graphId:nodeId" -> epoch ms of last activity broadcast */
const activitySentAt = new Map();
/** @type {Map<string, NodeJS.Timeout>} pending trailing activity flushes */
const activityTimers = new Map();
const edgeSentAt = new Map();
const edgeTimers = new Map();
const EDGE_ACTIVITY_WINDOW_MS = 100; // ≤10 events/second/edge, latest value wins
// Throttle bookkeeping is keyed by graph+node/edge, so it grows with the number of
// graphs the server has ever seen. Both maps are capped, and every entry of a graph is
// dropped as soon as that graph stops running (see forgetGraphActivity).
const ACTIVITY_KEY_LIMIT = 8192;
const ACTIVITY_KEY_MAX_AGE_MS = 60_000;

const CHANNEL_PATTERN = /^(alerts|telemetry|telemetry:[\w.:-]{1,120}|graph:[\w-]{1,120})$/;
const ACTIVITY_WINDOW_MS = 300;
const THROTTLE_WINDOW_MS = 50; // >20 msg/s triggers sampling
const SAMPLE_MS = 100;

/* ------------------------------------------------------------------ sending */

function sendTo(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > maxBufferedBytes) return false;
  socket.send(payload, (error) => {
    if (error) logger.error({ err: error }, 'WebSocket send failed:');
  });
  return true;
}

function sendJson(socket, type, data) {
  try { sendTo(socket, JSON.stringify({ type, data })); } catch { /* socket gone */ }
}

/**
 * Fan one message out to the subscribers of every listed channel. A socket that is
 * subscribed to several of the channels receives the message exactly once.
 */
function publishToChannels(channelNames, type, data) {
  const targets = new Set();
  for (const name of channelNames) {
    const subscribers = channels.get(name);
    if (subscribers) for (const socket of subscribers) targets.add(socket);
  }
  if (targets.size === 0) return 0;
  let payload;
  try { payload = JSON.stringify({ type, data }); } catch (error) {
    logger.error({ err: error }, `WebSocket serialisation failed for ${type}`);
    return 0;
  }
  let delivered = 0;
  for (const socket of targets) if (sendTo(socket, payload)) delivered += 1;
  return delivered;
}

/** Fan one message out to every subscriber of a single channel. */
function publishToChannel(channel, type, data) {
  return publishToChannels([channel], type, data);
}

/* ------------------------------------------------- telemetry (throttled fan-out) */

function sendTelemetry(deviceId, reading) {
  // Device channel + catch-all channel, deduplicated per socket.
  publishToChannels([`telemetry:${deviceId}`, 'telemetry'], 'telemetry', reading);
}

/**
 * Adaptive per-device throttle: pass through while the device is under ~20 msg/s,
 * sample at 10 Hz (latest wins) when it is over.
 */
function pushTelemetry(deviceId, reading) {
  let flusher = deviceFlushers.get(deviceId);
  if (!flusher) {
    // Long-running servers can see many device ids: drop flushers idle for >10 s
    // so the map cannot grow without bound (the throttle re-arms on next use).
    if (deviceFlushers.size > 512) {
      const cutoff = Date.now() - 10_000;
      for (const [key, entry] of deviceFlushers) {
        if (entry.lastSent < cutoff && !entry.pending && !entry.timer) deviceFlushers.delete(key);
      }
    }
    flusher = { lastSent: 0, pending: null, timer: null };
    deviceFlushers.set(deviceId, flusher);
  }
  const now = Date.now();
  if (now - flusher.lastSent >= THROTTLE_WINDOW_MS) {
    flusher.lastSent = now;
    sendTelemetry(deviceId, reading);
    return;
  }
  flusher.pending = reading; // latest wins
  if (!flusher.timer) {
    flusher.timer = setTimeout(() => {
      flusher.timer = null;
      if (flusher.pending) {
        const latest = flusher.pending;
        flusher.pending = null;
        flusher.lastSent = Date.now();
        sendTelemetry(deviceId, latest);
      }
    }, SAMPLE_MS);
    flusher.timer.unref?.();
  }
}

/** Push freshly ingested telemetry into the channel layer (used by the bus and tests). */
export function broadcastTelemetry(reading) {
  const deviceId = reading?.metadata?.deviceId;
  if (!deviceId || channels.size === 0) return;
  pushTelemetry(deviceId, reading);
}

/* ------------------------------------------------------ alerts / activity / status */

function severityOf(alert) {
  if (alert.severity) return alert.severity;
  if (alert.type === 'smsAlert') return 'critical';
  if (alert.type === 'webhook') return 'warning';
  return 'info';
}

/** Push an alert raised by a compiled pipeline to `alerts` + `graph:<id>` subscribers. */
export function broadcastAlert(alert) {
  const data = {
    graphId: alert.graphId ?? null,
    nodeId: alert.nodeId,
    deviceId: alert.deviceId ?? 'unknown',
    sensorType: alert.sensorType,
    value: alert.value,
    message: alert.message,
    severity: severityOf(alert),
    triggeredAt: alert.triggeredAt ?? new Date(),
    alertId: alert.alertId ?? null,
    deliveryIds: alert.deliveryIds ?? [],
    deliveryStatus: alert.deliveryStatus ?? null,
  };
  const targets = ['alerts'];
  if (data.graphId) targets.push(`graph:${data.graphId}`);
  publishToChannels(targets, 'alert', data);
}

/**
 * Push node activity (used by Day 4's glowing wires) to `graph:<id>` subscribers.
 * Leading + trailing throttle: at most one message per graph+node per 300 ms, and the
 * latest value of a burst is still delivered when the window closes.
 */
export function broadcastNodeActivity(activity) {
  const graphId = activity?.graphId;
  if (!graphId || channels.size === 0) return;
  const nodeId = activity.nodeId ?? 'unknown';
  const key = `${graphId}:${nodeId}`;
  const data = { graphId, nodeId, value: activity.value, timestamp: activity.timestamp ?? new Date(),
    tone: activity.tone ?? 'data', label: activity.label ?? 'value', unit: activity.unit ?? '' };
  const now = Date.now();
  const last = activitySentAt.get(key) ?? 0;
  if (now - last >= ACTIVITY_WINDOW_MS) {
    activitySentAt.set(key, now);
    boundKeyMap(activitySentAt, activityTimers, now);
    publishToChannel(`graph:${graphId}`, 'node_activity', data);
    return;
  }
  activitySentAt.set(key, last); // window still open
  if (activityTimers.has(key)) return;
  const timer = setTimeout(() => {
    activityTimers.delete(key);
    activitySentAt.set(key, Date.now());
    publishToChannel(`graph:${graphId}`, 'node_activity', data);
  }, ACTIVITY_WINDOW_MS - (now - last));
  timer.unref?.();
  activityTimers.set(key, timer);
}

/**
 * Independent leading/trailing edge throttle; node protocol stays backward compatible.
 */
export function broadcastEdgeActivity(activity) {
  const { graphId, edgeId } = activity ?? {};
  if (!graphId || !edgeId || !channels.has(`graph:${graphId}`)) return;
  const key = `${graphId}:${edgeId}`;
  const data = { graphId, edgeId, timestamp: activity.timestamp ?? new Date(), tone: activity.tone ?? 'data' };
  const now = Date.now();
  const last = edgeSentAt.get(key) ?? 0;
  if (now - last >= EDGE_ACTIVITY_WINDOW_MS) {
    edgeSentAt.set(key, now);
    boundKeyMap(edgeSentAt, edgeTimers, now);
    publishToChannel(`graph:${graphId}`, 'edge_activity', data);
    return;
  }
  if (edgeTimers.has(key)) { edgeTimers.get(key).data = data; return; }
  const entry = { data, timer: null };
  entry.timer = setTimeout(() => {
    edgeTimers.delete(key);
    edgeSentAt.set(key, Date.now());
    publishToChannel(`graph:${graphId}`, 'edge_activity', entry.data);
  }, EDGE_ACTIVITY_WINDOW_MS - (now - last));
  entry.timer.unref?.();
  edgeTimers.set(key, entry);
  boundKeyMap(edgeSentAt, edgeTimers, now);
}

/**
 * Cap a "graphId:nodeId" -> timestamp map. Stale entries go first; if the map is still
 * too large (a very wide burst inside the age window) the oldest key is dropped so a
 * long-lived server cannot grow without bound.
 */
function boundKeyMap(sentAt, timers, now) {
  if (sentAt.size <= ACTIVITY_KEY_LIMIT) return;
  for (const [key, time] of sentAt) {
    if (now - time > ACTIVITY_KEY_MAX_AGE_MS && !timers.has(key)) sentAt.delete(key);
  }
  if (sentAt.size > ACTIVITY_KEY_LIMIT) sentAt.delete(sentAt.keys().next().value);
}

/**
 * Drop every throttle entry that belongs to one graph. Called when a graph is
 * deactivated (or deleted): its nodes can never emit again, so keeping the keys would
 * leak memory for the lifetime of the process.
 */
function forgetGraphActivity(graphId) {
  if (!graphId) return;
  const prefix = `${graphId}:`;
  for (const key of [...activitySentAt.keys()]) if (key.startsWith(prefix)) activitySentAt.delete(key);
  for (const [key, timer] of [...activityTimers]) {
    if (key.startsWith(prefix)) { clearTimeout(timer); activityTimers.delete(key); }
  }
  for (const key of [...edgeSentAt.keys()]) if (key.startsWith(prefix)) edgeSentAt.delete(key);
  for (const [key, entry] of [...edgeTimers]) {
    if (key.startsWith(prefix)) { clearTimeout(entry.timer); edgeTimers.delete(key); }
  }
}

/** Test/ops helper: forget every throttle entry (used by the shutdown path). */
export function forgetAllActivity() {
  for (const timer of activityTimers.values()) clearTimeout(timer);
  activityTimers.clear();
  activitySentAt.clear();
  for (const entry of edgeTimers.values()) clearTimeout(entry.timer);
  edgeTimers.clear();
  edgeSentAt.clear();
}

/** Final provider result; target is already masked by deliveryDto. */
export function broadcastDelivery(delivery) {
  const targets = ['alerts'];
  if (delivery.graphId) targets.push(`graph:${delivery.graphId}`);
  publishToChannels(targets, 'delivery', delivery);
}

/** Announce activation / deactivation / error of a pipeline to `graph:<id>` subscribers. */
export function broadcastGraphStatus(graphId, status) {
  if (!graphId) return;
  // A graph that is no longer running can never emit activity again: release its
  // throttle bookkeeping instead of keeping the keys for the life of the process.
  if (status === 'inactive') forgetGraphActivity(graphId);
  publishToChannel(`graph:${graphId}`, 'graph_status', { graphId, status });
}

/* --------------------------------------------------------- subscription protocol */

function normaliseChannels(raw) {
  if (!Array.isArray(raw)) return null;
  const list = raw.filter((channel) => typeof channel === 'string' && CHANNEL_PATTERN.test(channel));
  return [...new Set(list)].slice(0, 100);
}

function handleSubscribe(socket, raw) {
  const requested = normaliseChannels(raw);
  if (!requested || requested.length === 0) {
    return sendJson(socket, 'error', { message: 'subscribe expects a non-empty "channels" array.' });
  }
  for (const channel of requested) {
    let set = channels.get(channel);
    if (!set) { set = new Set(); channels.set(channel, set); }
    set.add(socket);
    socket.channels.add(channel);
  }
  return sendJson(socket, 'subscribed', { channels: requested });
}

function handleUnsubscribe(socket, raw) {
  const requested = normaliseChannels(raw);
  if (!requested || requested.length === 0) {
    return sendJson(socket, 'error', { message: 'unsubscribe expects a non-empty "channels" array.' });
  }
  for (const channel of requested) {
    const set = channels.get(channel);
    if (set) {
      set.delete(socket);
      if (set.size === 0) channels.delete(channel);
    }
    socket.channels.delete(channel);
  }
  return sendJson(socket, 'unsubscribed', { channels: requested });
}

/**
 * WS ingestion: identical validation + persistence + rule evaluation as HTTP,
 * only the transport differs. The ack goes out first; MongoDB and the rule engine
 * run after the response is flushed.
 */
function handleTelemetry(socket, data) {
  if (!socket.canIngest) return sendJson(socket, 'error', { code: 'UNAUTHORIZED', message: 'WS ingestion requires the x-api-key handshake header.' });
  const now = Date.now();
  if (now - socket.ingestWindowStart >= 60_000) { socket.ingestWindowStart = now; socket.ingestCount = 0; }
  if (++socket.ingestCount > env.ingestRateLimit) return sendJson(socket, 'error', { code: 'RATE_LIMITED', message: 'WebSocket ingestion rate limit exceeded.' });
  const parsed = readingSchema.safeParse(data);
  if (!parsed.success) {
    return sendJson(socket, 'error', {
      message: 'Invalid telemetry payload.',
      details: parsed.error.issues.map(({ path, message }) => ({ path: path.join('.'), message })),
    });
  }
  const reading = parsed.data;
  sendJson(socket, 'ack', { accepted: 1, timestamp: reading.timestamp.toISOString() });
  setImmediate(async () => {
    // Same durability contract as HTTP: only readings that are actually stored are
    // fanned out, so the rule engine never evaluates data that is not in the database.
    let inserted = [reading];
    try {
      inserted = await Telemetry.insertMany([reading], { ordered: false, lean: true });
    } catch (error) {
      const partial = extractInsertedDocs(error);
      if (partial.length === 0) {
        logger.error({ err: error }, 'WebSocket telemetry persist failed');
        return;
      }
      inserted = partial;
    }
    try {
      telemetryBus.ingest(inserted);
    } catch (error) {
      logger.error({ err: error }, `WebSocket telemetry fan-out failed`);
    }
  });
  return undefined;
}

/** Incoming client message. Malformed input must never crash the server. */
function handleMessage(socket, raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return sendJson(socket, 'error', { message: 'Invalid JSON.' });
  }
  if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') {
    return sendJson(socket, 'error', { message: 'Message must be an object with a string "type".' });
  }
  try {
    switch (message.type) {
      case 'subscribe': return handleSubscribe(socket, message.channels);
      case 'unsubscribe': return handleUnsubscribe(socket, message.channels);
      case 'telemetry': return handleTelemetry(socket, message.data);
      case 'ping': return sendJson(socket, 'pong', { t: Date.now() });
      default: return sendJson(socket, 'error', { message: `Unknown message type "${message.type}".` });
    }
  } catch (error) {
    logger.error({ err: error }, `WebSocket message handling failed`);
    return sendJson(socket, 'error', { message: 'Message could not be processed.' });
  }
}

function detachSocket(socket) {
  for (const channel of socket.channels ?? []) {
    const set = channels.get(channel);
    if (set) {
      set.delete(socket);
      if (set.size === 0) channels.delete(channel);
    }
  }
  socket.channels?.clear();
}

/* ------------------------------------------------------------------- lifecycle */

/**
 * Attach the channel-aware WebSocket server to an HTTP server on `/ws`.
 * @param {import('node:http').Server} httpServer
 * @returns {WebSocketServer}
 */
export function attachWebSocketServer(httpServer) {
  socketServer = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 64 * 1024 });

  socketServer.on('connection', (socket, request) => {
    socket.isAlive = true;
    socket.channels = new Set();
    // Read-only dashboard subscriptions stay public; ingestion needs the optional key.
    socket.canIngest = !env.ingestApiKey || secretEquals(request.headers['x-api-key'], env.ingestApiKey);
    socket.ingestWindowStart = Date.now();
    socket.ingestCount = 0;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('error', (error) => logger.error({ err: error }, 'WebSocket error:'));
    socket.on('message', (raw) => handleMessage(socket, raw));
    socket.on('close', () => detachSocket(socket));
    sendJson(socket, 'connected', { message: 'Connected to NexusFlow', channels: ['telemetry', 'telemetry:<deviceId>', 'alerts', 'graph:<graphId>'] });
  });
  socketServer.on('error', (error) => logger.error({ err: error }, 'WebSocket server error:'));

  // Every bus reading fans out to subscribed channels only.
  busSubscription = telemetryBus.subscribe((reading) => broadcastTelemetry(reading));

  // Remove broken connections; unref prevents this timer from keeping Node alive.
  const heartbeat = setInterval(() => {
    for (const socket of socketServer.clients) {
      if (!socket.isAlive) socket.terminate();
      else { socket.isAlive = false; socket.ping(); }
    }
  }, 30_000);
  heartbeat.unref();

  socketServer.on('close', () => {
    clearInterval(heartbeat);
    busSubscription?.unsubscribe();
    busSubscription = null;
    for (const flusher of deviceFlushers.values()) if (flusher.timer) clearTimeout(flusher.timer);
    deviceFlushers.clear();
    forgetAllActivity();
    channels.clear();
    socketServer = null;
  });

  return socketServer;
}
