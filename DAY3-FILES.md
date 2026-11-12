# Day 3 — new and modified files

Complete source of every file that was **added** or **modified** on Day 3 (live execution).
Files that were not touched are unchanged from [`CODE.md`](CODE.md) /
[`DAY2-FILES.md`](DAY2-FILES.md). `README.md` was also updated with the
**"Live execution flow (Day 3)"** section (ASCII diagram, channel protocol, new endpoints,
verification steps) — only the appended `Day 3` styling section of
`client/src/index.css` is reproduced at the end of this file.

Summary of the changes:

* **Backend** — a central `telemetryBus` (hot RxJS Subject + engine counters), the
  `ruleExecutor` (O(1) `deviceId:sensorType` routing, per-graph `catchError` isolation,
  automatic registration from `ActiveGraphManager`), a channel-subscription WebSocket protocol
  with per-device broadcast throttling and WS ingestion, per-node activity taps (optional) and a
  per-device alert cooldown in the stream compiler, plus the `/api/alerts`,
  `/api/telemetry/stats` and `/api/engine/status` endpoints.
* **Frontend** — a shared `WebSocketProvider` (auto-reconnect, channel helpers) with a
  one-line `useChannel` hook, the live **Dashboard** (buffered rolling Recharts line with
  threshold reference line, stat cards, alert feed with toasts, engine status panel),
  `Editor | Dashboard` routing, and Activate / Deactivate / Send-test-data controls with a live
  status badge in the editor toolbar.
* **Tests** — `ruleExecutor` routing/isolation, activity taps + cooldown, and the WebSocket
  channel protocol (subscribe / unsubscribe / ingestion / throttling).

## New files
### `server/src/services/telemetryBus.js`

```js
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
```
### `server/src/services/ruleExecutor.js`

```js
import { Subject, catchError } from 'rxjs';
import { telemetryBus } from './telemetryBus.js';

/**
 * Rule execution engine.
 *
 * Subscribes to the telemetry bus once and routes every reading to the Source
 * Subject(s) of the graphs that care about it. Routing is O(1) for the common case:
 * an exact `deviceId:sensorType` Map lookup — never a loop over all active graphs.
 * Graphs with wildcard sources (`*`) live in a tiny side list that is only scanned
 * when it is non-empty.
 *
 * Isolation: each graph gets its own RxJS Subject + subscription wrapped in
 * `catchError`, so a broken pipeline logs, resubscribes and keeps running while the
 * rest of the engine is unaffected.
 */

const WILDCARD = '*';

class RuleExecutor {
  /** @type {Map<string, Route>} graphId -> route (subject, subscription, sources) */
  #routes = new Map();
  /** @type {Map<string, Set<Route>>} "deviceId:sensorType" -> routes with an exact source */
  #exact = new Map();
  /** @type {{ route: Route, deviceId: string, sensorType: string }[]} wildcard sources only */
  #wildcards = [];
  /** @type {import('rxjs').Subscription | null} bus subscription */
  #subscription = null;
  #routed = 0;
  #errors = 0;

  /** Attach to the telemetry bus (idempotent). */
  start() {
    if (this.#subscription) return;
    this.#subscription = telemetryBus.subscribe((reading) => {
      try {
        this.route(reading);
      } catch (error) {
        this.#errors += 1;
        console.error(`[ruleExecutor] failed to route a reading: ${error.message}`);
      }
    });
  }

  /** Detach from the bus and dispose every graph route. */
  stop() {
    this.#subscription?.unsubscribe();
    this.#subscription = null;
    for (const graphId of [...this.#routes.keys()]) this.unregister(graphId);
  }

  /**
   * Register a compiled graph so its pipeline receives matching readings.
   * Called automatically by ActiveGraphManager on activation (and re-activation).
   *
   * @param {{ graphId: string, sources: { deviceId?: string, sensorType?: string }[],
   *           publish: (reading: object) => number }} entry compiled pipeline handle
   */
  register({ graphId, sources = [], publish }) {
    if (!graphId || typeof publish !== 'function') throw new Error('ruleExecutor.register requires graphId and publish().');
    this.unregister(graphId);

    const subject = new Subject();
    // catchError keeps the route alive after a failure: `caught` resubscribes upstream.
    const subscription = subject.pipe(
      catchError((error, caught) => {
        this.#errors += 1;
        console.error(`[ruleExecutor] graph ${graphId} failed, resubscribing: ${error.message}`);
        return caught;
      }),
    ).subscribe({
      next: (reading) => {
        try {
          publish(reading);
          this.#routed += 1;
        } catch (error) {
          this.#errors += 1;
          console.error(`[ruleExecutor] graph ${graphId} publish failed: ${error.message}`);
        }
      },
      error: (error) => {
        this.#errors += 1;
        console.error(`[ruleExecutor] graph ${graphId} subscription error: ${error.message}`);
      },
    });

    /** @type {Route} */
    const route = { graphId, subject, subscription, sources: [] };
    for (const source of sources) {
      const deviceId = source?.deviceId || WILDCARD;
      const sensorType = source?.sensorType || WILDCARD;
      route.sources.push({ deviceId, sensorType });
      if (deviceId === WILDCARD || sensorType === WILDCARD) {
        this.#wildcards.push({ route, deviceId, sensorType });
      } else {
        const key = `${deviceId}:${sensorType}`;
        let set = this.#exact.get(key);
        if (!set) { set = new Set(); this.#exact.set(key, set); }
        set.add(route);
      }
    }
    this.#routes.set(graphId, route);
    this.start();
    return route;
  }

  /**
   * Remove a graph: its subscription is disposed and it stops receiving data.
   * @param {string} graphId
   * @returns {boolean} true when a route existed
   */
  unregister(graphId) {
    const route = this.#routes.get(graphId);
    if (!route) return false;
    route.subscription.unsubscribe();
    route.subject.complete();
    for (const source of route.sources) {
      if (source.deviceId === WILDCARD || source.sensorType === WILDCARD) {
        this.#wildcards = this.#wildcards.filter((entry) => entry.route !== route);
      } else {
        const key = `${source.deviceId}:${source.sensorType}`;
        const set = this.#exact.get(key);
        if (set) {
          set.delete(route);
          if (set.size === 0) this.#exact.delete(key);
        }
      }
    }
    this.#routes.delete(graphId);
    return true;
  }

  /**
   * Deliver one reading to every matching graph.
   * Never throws: a malformed reading is simply ignored.
   *
   * @param {object} reading `{ metadata: { deviceId, sensorType }, value, ... }`
   * @returns {number} how many graphs received it
   */
  route(reading) {
    const deviceId = reading?.metadata?.deviceId;
    const sensorType = reading?.metadata?.sensorType;
    if (!deviceId || !sensorType) return 0;

    const matched = new Set();
    const exact = this.#exact.get(`${deviceId}:${sensorType}`);
    if (exact) for (const route of exact) matched.add(route);
    for (const entry of this.#wildcards) {
      if ((entry.deviceId === WILDCARD || entry.deviceId === deviceId)
        && (entry.sensorType === WILDCARD || entry.sensorType === sensorType)) {
        matched.add(entry.route);
      }
    }
    if (matched.size === 0) return 0;

    for (const route of matched) {
      if (route.subject.closed || route.subject.isStopped) continue;
      route.subject.next(reading);
    }
    return matched.size;
  }

  /** Snapshot for `GET /api/engine/status` and tests. */
  stats() {
    return {
      activeRoutes: this.#routes.size,
      exactKeys: this.#exact.size,
      wildcardSources: this.#wildcards.length,
      routedReadings: this.#routed,
      errors: this.#errors,
      started: this.#subscription !== null,
    };
  }

  /** Test helper: drop every route without touching the bus subscription. */
  clear() {
    for (const graphId of [...this.#routes.keys()]) this.unregister(graphId);
  }
}

/**
 * @typedef {{ graphId: string,
 *             subject: import('rxjs').Subject<object>,
 *             subscription: import('rxjs').Subscription,
 *             sources: { deviceId: string, sensorType: string }[] }} Route
 */

export const ruleExecutor = new RuleExecutor();
export default ruleExecutor;
```
### `server/src/controllers/alertController.js`

```js
import { Alert } from '../models/Alert.js';

/**
 * GET /api/alerts — recent alerts raised by action nodes, newest first.
 * Filters: graphId, deviceId, limit (all optional).
 */
export async function listAlertsHandler(req, res) {
  const { graphId, deviceId, limit } = res.locals.validated.query;
  const filter = {};
  if (graphId) filter.graphId = graphId;
  if (deviceId) filter.deviceId = deviceId;
  const data = await Alert.find(filter).sort({ triggeredAt: -1 }).limit(limit).lean();
  res.json({ data });
}
```
### `server/src/routes/alertRoutes.js`

```js
import { Router } from 'express';
import { listAlertsHandler } from '../controllers/alertController.js';
import { asyncHandler, validate } from '../middleware/validate.js';
import { alertQuerySchema } from '../validation/alert.js';

/** Mounted at /api/alerts */
const router = Router();
router.get('/', validate(alertQuerySchema, 'query'), asyncHandler(listAlertsHandler));
export default router;
```
### `server/src/routes/engineRoutes.js`

```js
import { Router } from 'express';
import { activeGraphManager } from '../services/activeGraphManager.js';
import { ruleExecutor } from '../services/ruleExecutor.js';
import { telemetryBus } from '../services/telemetryBus.js';

/** Mounted at /api/engine */
const router = Router();

/**
 * GET /api/engine/status
 * { activeGraphs, messagesProcessed, messagesPerSecond, alertsFired, ... }
 * Polled by the dashboard's EngineStatus panel every 5 s.
 */
router.get('/status', (req, res) => {
  const stats = telemetryBus.stats();
  const routing = ruleExecutor.stats();
  res.json({
    data: {
      activeGraphs: activeGraphManager.list().length,
      messagesProcessed: stats.messagesProcessed,
      messagesPerSecond: stats.messagesPerSecond,
      alertsFired: stats.alertsFired,
      routedReadings: routing.routedReadings,
      routingErrors: routing.errors,
      uptimeSeconds: Math.round(process.uptime()),
    },
  });
});

export default router;
```
### `server/src/validation/alert.js`

```js
import { z } from 'zod';

/**
 * GET /api/alerts?graphId=&deviceId=&limit=
 * All filters are optional; results come back newest first.
 */
export const alertQuerySchema = z.object({
  graphId: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid graph ID.').optional(),
  deviceId: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
}).strict();
```
### `server/scripts/engineCheck.js`

```js
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

/**
 * End-to-end engine check (Day 3 definition of done).
 *
 *   1. activates the sample turbine graph (Sensor -> MovingAverage(5) -> Threshold(>80) -> SMS),
 *   2. pushes a deterministic series of readings with anomaly spikes over HTTP or WebSocket,
 *   3. replays the same window logic locally to compute the EXPECTED alert count,
 *   4. reads back /api/alerts and prints fired vs expected (PASS/FAIL).
 *
 * Usage:  node scripts/engineCheck.js [--url http://localhost:5000] [--rounds 60]
 *          [--spike-every 7] [--transport http|ws] [--cooldown 0] [--keep]
 */

const { values } = parseArgs({ options: {
  url: { type: 'string', default: process.env.ENGINE_CHECK_URL ?? 'http://localhost:5000' },
  rounds: { type: 'string', default: '60' },
  'spike-every': { type: 'string', default: '7' },
  transport: { type: 'string', default: 'http' },
  cooldown: { type: 'string', default: '0' },
  keep: { type: 'boolean', default: false },
} });

const baseUrl = new URL(values.url);
const rounds = Number(values.rounds);
const spikeEvery = Number(values['spike-every']);
const cooldown = Number(values.cooldown);
const transport = String(values.transport).toLowerCase();
if (!Number.isInteger(rounds) || rounds < 10 || rounds > 1000) { console.error('--rounds must be 10..1000.'); process.exit(1); }
if (!Number.isInteger(spikeEvery) || spikeEvery < 2) { console.error('--spike-every must be >= 2.'); process.exit(1); }
if (!['http', 'ws'].includes(transport)) { console.error('--transport must be http or ws.'); process.exit(1); }

const api = (path, init) => fetch(new URL(path, baseUrl), { headers: { 'Content-Type': 'application/json' }, ...init });
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function json(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error?.message ?? 'request failed'}`);
  return body;
}

/* ------------------------------------------------------------------ 1. graph */
const sample = JSON.parse(readFileSync(fileURLToPath(new URL('../samples/turbine-graph.json', import.meta.url)), 'utf8'));

const health = await api('/api/health').then(json).catch((error) => { console.error(`Server unreachable at ${baseUrl}: ${error.message}`); process.exit(1); });
if (health.status !== 'ok') { console.error(`MongoDB is not connected (${health.database}). Start mongod first.`); process.exit(1); }

const graphs = (await json(await api('/api/graphs'))).data;
let graphId = graphs.find((graph) => graph.name === sample.name)?._id;
if (!graphId) {
  graphId = (await json(await api('/api/graphs', { method: 'POST', body: JSON.stringify(sample) }))).data._id;
  console.log(`Created graph "${sample.name}" (${graphId}).`);
} else {
  console.log(`Reusing saved graph "${sample.name}" (${graphId}).`);
}
if (cooldown > 0) sample.nodes.find((node) => node.type === 'smsAlert').data.config.cooldownSeconds = cooldown;

const activation = (await json(await api(`/api/graphs/${graphId}/compile`, { method: 'POST' }))).data;
console.log(`Activated: ${activation.nodeCount} nodes, source ${activation.sources[0].key}, subscriptions ${activation.subscriptions}.`);

/* ------------------------------------------------------- 2. deterministic series */
const DEVICE = 'turbine-001';
const SENSOR = 'temperature';
const runStart = new Date(Date.now() - 50);
const readings = [];
for (let i = 1; i <= rounds; i += 1) {
  const spike = i % spikeEvery === 0;
  const value = spike ? 95 + (i % 3) * 2 : 45 + (i % 5); // normals 45..49, spikes 95..99
  readings.push({
    timestamp: new Date(runStart.getTime() + i).toISOString(),
    metadata: { deviceId: DEVICE, sensorType: SENSOR, location: 'Engine check' },
    value: Math.round(value * 100) / 100,
    unit: '°C',
  });
}

/* ------------------------------------- 3. expected count (local replay of the rule)
   movingAverage(5) uses bufferCount(5, 1): it emits a (possibly partial) window on
   every reading, threshold passes when the window average is > 80. */
let expected = 0;
const window = [];
for (const reading of readings) {
  window.push(reading.value);
  if (window.length > 5) window.shift();
  const avg = window.reduce((sum, v) => sum + v, 0) / window.length;
  if (avg > 80) expected += 1;
}

/* ------------------------------------------------------------- 4. send readings */
let sent = 0;
if (transport === 'http') {
  const response = await json(await api('/api/telemetry/batch', { method: 'POST', body: JSON.stringify(readings) }));
  sent = response.accepted;
} else {
  const wsUrl = new URL('/ws', `${baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${baseUrl.host}`);
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let acked = 0;
  socket.on('message', (raw) => {
    try { if (JSON.parse(raw.toString()).type === 'ack') acked += 1; } catch { /* ignore */ }
  });
  for (const reading of readings) socket.send(JSON.stringify({ type: 'telemetry', data: reading }));
  while (acked < readings.length) await sleepMs(25);
  sent = acked;
  socket.close();
}
console.log(`Sent ${sent} readings over ${transport.toUpperCase()} at ${runStart.toISOString()} (spike every ${spikeEvery}).`);

// Give MongoDB writes + rule evaluation + alert persistence a moment to settle.
await sleepMs(900);

/* ---------------------------------------------------------- 5. count the alerts */
const alerts = (await json(await api(`/api/alerts?deviceId=${DEVICE}&limit=500`))).data;
const fired = alerts.filter((alert) => String(alert.graphId) === String(graphId) && new Date(alert.triggeredAt) >= runStart);
const status = (await json(await api('/api/engine/status'))).data;

/* ------------------------------------------------------------- 6. report + exit */
const pass = fired.length === expected;
console.log('');
console.log('---------------- NexusFlow engine check ----------------');
console.log(`  graph            : ${graphId} (cooldown ${cooldown}s)`);
console.log(`  readings sent    : ${sent}`);
console.log(`  alerts expected  : ${expected}`);
console.log(`  alerts fired     : ${fired.length}${fired.length ? `  (first: "${fired[fired.length - 1]?.message}")` : ''}`);
console.log(`  engine status    : ${status.activeGraphs} active graph(s), ${status.messagesProcessed} processed, ${status.alertsFired} alerts fired total`);
console.log(`  result           : ${pass ? 'PASS ✓' : 'FAIL ✗'}`);
console.log('--------------------------------------------------------');

if (!values.keep) {
  try { await api(`/api/graphs/${graphId}/deactivate`, { method: 'POST' }); console.log('Graph deactivated.'); }
  catch (error) { console.error(`Deactivate failed: ${error.message}`); }
}
process.exitCode = pass ? 0 : 1;
```
### `server/test/compiler/ruleExecutor.test.js`

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { telemetryBus } from '../../src/services/telemetryBus.js';
import { ruleExecutor } from '../../src/services/ruleExecutor.js';

/**
 * Rule executor: telemetryBus -> route -> compiled pipeline.
 * No database, no RxJS graph compilation — fake pipelines record what they receive.
 */

const reading = (deviceId, sensorType, value = 21) => ({
  metadata: { deviceId, sensorType, location: 'test' },
  value,
  unit: '°C',
  timestamp: new Date(),
});

/** Stand-in for a compiled pipeline: records every published reading. */
function fakeGraph(graphId, sources) {
  const received = [];
  return {
    graphId,
    sources,
    received,
    publish(item) { received.push(item); },
  };
}

beforeEach(() => {
  ruleExecutor.stop();
  telemetryBus.resetStats();
});
afterEach(() => {
  ruleExecutor.stop();
});

describe('ruleExecutor', () => {
  it('routes a reading only to the graph whose source matches deviceId + sensorType', () => {
    const alpha = fakeGraph('graph-alpha', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    const beta = fakeGraph('graph-beta', [{ deviceId: 'turbine-002', sensorType: 'temperature' }]);
    ruleExecutor.register(alpha);
    ruleExecutor.register(beta);

    const delivered = ruleExecutor.route(reading('turbine-001', 'temperature', 75));

    expect(delivered).toBe(1);
    expect(alpha.received).toHaveLength(1);
    expect(beta.received).toHaveLength(0);
    // A different sensor on the same device must not leak into the temperature graph.
    expect(ruleExecutor.route(reading('turbine-001', 'vibration', 3))).toBe(0);
    expect(alpha.received).toHaveLength(1);
  });

  it('supports multiple active graphs matching the same key simultaneously', () => {
    const one = fakeGraph('graph-1', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    const two = fakeGraph('graph-2', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    ruleExecutor.register(one);
    ruleExecutor.register(two);

    expect(ruleExecutor.route(reading('turbine-001', 'temperature'))).toBe(2);
    expect(one.received).toHaveLength(1);
    expect(two.received).toHaveLength(1);
  });

  it('matches wildcard sources without looping over every graph', () => {
    const anyDevice = fakeGraph('graph-any-device', [{ deviceId: '*', sensorType: 'temperature' }]);
    const anySensor = fakeGraph('graph-any-sensor', [{ deviceId: 'turbine-009', sensorType: '*' }]);
    const exact = fakeGraph('graph-exact', [{ deviceId: 'turbine-009', sensorType: 'temperature' }]);
    ruleExecutor.register(anyDevice);
    ruleExecutor.register(anySensor);
    ruleExecutor.register(exact);

    // turbine-009:temperature matches all three routes.
    expect(ruleExecutor.route(reading('turbine-009', 'temperature'))).toBe(3);
    // turbine-005:temperature matches only the device wildcard.
    expect(ruleExecutor.route(reading('turbine-005', 'temperature'))).toBe(1);
    // turbine-009:pressure matches only the sensor wildcard.
    expect(ruleExecutor.route(reading('turbine-009', 'pressure'))).toBe(1);

    expect(ruleExecutor.stats().wildcardSources).toBe(2);
    expect(ruleExecutor.stats().exactKeys).toBe(1);
  });

  it('stops delivering to a deactivated graph and keeps the others alive', () => {
    const staying = fakeGraph('graph-stay', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    const leaving = fakeGraph('graph-leave', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    ruleExecutor.register(staying);
    ruleExecutor.register(leaving);

    expect(ruleExecutor.route(reading('turbine-001', 'temperature'))).toBe(2);

    expect(ruleExecutor.unregister('graph-leave')).toBe(true);
    expect(ruleExecutor.unregister('graph-leave')).toBe(false); // idempotent

    expect(ruleExecutor.route(reading('turbine-001', 'temperature'))).toBe(1);
    expect(leaving.received).toHaveLength(1);
    expect(staying.received).toHaveLength(2);
    expect(ruleExecutor.stats().activeRoutes).toBe(1);
  });

  it('re-registering the same graphId replaces the old route instead of doubling delivery', () => {
    const first = fakeGraph('graph-dup', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    ruleExecutor.register(first);
    const second = fakeGraph('graph-dup', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    ruleExecutor.register(second);

    ruleExecutor.route(reading('turbine-001', 'temperature'));
    expect(first.received).toHaveLength(0);
    expect(second.received).toHaveLength(1);
    expect(ruleExecutor.stats().activeRoutes).toBe(1);
  });

  it('ignores malformed readings without throwing', () => {
    const graph = fakeGraph('graph-m', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    ruleExecutor.register(graph);

    expect(ruleExecutor.route(null)).toBe(0);
    expect(ruleExecutor.route({})).toBe(0);
    expect(ruleExecutor.route({ metadata: {} })).toBe(0);
    expect(ruleExecutor.route({ metadata: { deviceId: 'x' } })).toBe(0);
    expect(graph.received).toHaveLength(0);
  });

  it('isolates a crashing graph so the others keep receiving data', () => {
    const broken = {
      graphId: 'graph-broken',
      sources: [{ deviceId: 'turbine-001', sensorType: 'temperature' }],
      publish() { throw new Error('pipeline exploded'); },
    };
    const healthy = fakeGraph('graph-healthy', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    ruleExecutor.register(broken);
    ruleExecutor.register(healthy);

    // Telemetry bus delivery must not throw either.
    telemetryBus.ingest([reading('turbine-001', 'temperature')]);

    expect(healthy.received).toHaveLength(1);
    expect(ruleExecutor.stats().errors).toBeGreaterThan(0);
    consoleError.mockRestore();
  });

  it('tracks engine stats through the telemetry bus', () => {
    const graph = fakeGraph('graph-stats', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    ruleExecutor.register(graph);
    const routedBefore = ruleExecutor.stats().routedReadings;

    telemetryBus.ingest([
      reading('turbine-001', 'temperature'),
      reading('turbine-001', 'temperature'),
      reading('other-device', 'temperature'),
    ]);

    const bus = telemetryBus.stats();
    expect(bus.messagesProcessed).toBe(3);
    expect(bus.messagesPerSecond).toBeGreaterThanOrEqual(3);
    expect(ruleExecutor.stats().routedReadings - routedBefore).toBe(2);
    expect(graph.received).toHaveLength(2);
  });

  it('start() and stop() are idempotent and stop() disposes every route', () => {
    const graph = fakeGraph('graph-lifecycle', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    ruleExecutor.start();
    ruleExecutor.start();
    ruleExecutor.register(graph);
    expect(ruleExecutor.stats().started).toBe(true);

    ruleExecutor.stop();
    ruleExecutor.stop();
    expect(ruleExecutor.stats().started).toBe(false);
    expect(ruleExecutor.stats().activeRoutes).toBe(0);

    // After stop() the bus subscription is gone: ingest must not reach the graph.
    telemetryBus.ingest([reading('turbine-001', 'temperature')]);
    expect(graph.received).toHaveLength(0);
  });
});
```
### `server/test/compiler/activityCooldown.test.js`

```js
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileGraph } from '../../src/compiler/streamCompiler.js';

/**
 * Day 3 compiler features: optional per-node activity taps and the alert cooldown
 * that stops action nodes from spamming during a sustained spike.
 */

const sourceNode = (id = 'sensor-1', config = { deviceId: 'turbine-001', sensorType: 'temperature' }) => ({ id, type: 'sensor', position: { x: 0, y: 0 }, data: { config } });
const thresholdNode = (id = 'threshold-1', operator = '>', value = 80) => ({ id, type: 'threshold', position: { x: 0, y: 0 }, data: { config: { operator, value } } });
const logAction = (id = 'log-1', config = { label: 'test' }) => ({ id, type: 'log', position: { x: 0, y: 0 }, data: { config } });
const link = (source, target) => ({ id: `${source}->${target}`, source, target });

const overheatGraph = (actionConfig = { label: 'test' }) => ({
  nodes: [sourceNode(), thresholdNode(), logAction('log-1', actionConfig)],
  edges: [link('sensor-1', 'threshold-1'), link('threshold-1', 'log-1')],
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('compileGraph activity taps', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits { graphId, nodeId, value } per node when trackActivity is enabled', async () => {
    const activity = [];
    const compiled = compileGraph(overheatGraph(), {
      graphId: 'g-1',
      dryRun: true,
      trackActivity: true,
      onActivity: (event) => activity.push(event),
    });

    compiled.pushValues([95]);
    await settle();

    const nodeIds = activity.map((event) => event.nodeId);
    // The source, threshold and action nodes all report; the threshold blocks 50 but passes 95.
    expect(nodeIds).toContain('sensor-1');
    expect(nodeIds).toContain('threshold-1');
    expect(nodeIds).toContain('log-1');
    for (const event of activity) {
      expect(event.graphId).toBe('g-1');
      expect(typeof event.value).toBe('number');
      expect(event.timestamp).toBeInstanceOf(Date);
    }
    compiled.dispose();
  });

  it('does not call onActivity when trackActivity is off (production default)', async () => {
    const onActivity = vi.fn();
    const compiled = compileGraph(overheatGraph(), { graphId: 'g-1', dryRun: true, onActivity });
    compiled.pushValues([95, 96, 97]);
    await settle();
    expect(onActivity).not.toHaveBeenCalled();
    compiled.dispose();
  });

  it('a throwing activity listener never breaks the pipeline', async () => {
    const compiled = compileGraph(overheatGraph(), {
      graphId: 'g-1',
      dryRun: true,
      trackActivity: true,
      onActivity: () => { throw new Error('listener exploded'); },
    });
    compiled.pushValues([95]);
    await settle();
    // The alert still fired despite the failing listener.
    expect(compiled.getAlerts()).toHaveLength(1);
    compiled.dispose();
  });
});

describe('action cooldown', () => {
  it('fires once per cooldown window instead of on every reading', async () => {
    const compiled = compileGraph(overheatGraph({ label: 'test', cooldownSeconds: 30 }), { graphId: 'g-1', dryRun: true });

    compiled.pushValues([95, 96, 97, 98]); // all above the threshold
    await settle();
    expect(compiled.getAlerts()).toHaveLength(1); // first fires, the rest are suppressed

    compiled.dispose();
  });

  it('cooldown 0 (default) fires on every matching reading', async () => {
    const compiled = compileGraph(overheatGraph({ label: 'test' }), { graphId: 'g-1', dryRun: true });
    compiled.pushValues([95, 96, 97]);
    await settle();
    expect(compiled.getAlerts()).toHaveLength(3);
    compiled.dispose();
  });

  it('keys the cooldown per device so one device cannot silence another', async () => {
    const graph = {
      nodes: [
        // Wildcard source so readings from any device reach the pipeline.
        sourceNode('sensor-1', { deviceId: '*', sensorType: 'temperature' }),
        thresholdNode(),
        logAction('log-1', { label: 'test', cooldownSeconds: 60 }),
      ],
      edges: [link('sensor-1', 'threshold-1'), link('threshold-1', 'log-1')],
    };
    const compiled = compileGraph(graph, { graphId: 'g-1', dryRun: true });

    compiled.pushValues([
      { deviceId: 'turbine-001', value: 95 },
      { deviceId: 'turbine-001', value: 96 }, // suppressed (same device, inside window)
      { deviceId: 'turbine-002', value: 97 }, // different device: fires
    ]);
    await settle();

    const alerts = compiled.getAlerts();
    expect(alerts).toHaveLength(2);
    expect(alerts.map((alert) => alert.deviceId)).toEqual(['turbine-001', 'turbine-002']);
    compiled.dispose();
  });

  it('rejects an out-of-range cooldownSeconds during validation', () => {
    expect(() => compileGraph(overheatGraph({ label: 'test', cooldownSeconds: -1 }), { dryRun: true })).toThrow(/not valid/);
    expect(() => compileGraph(overheatGraph({ label: 'test', cooldownSeconds: 999_999 }), { dryRun: true })).toThrow(/not valid/);
  });
});
```
### `server/test/websocketChannels.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { Telemetry } from '../src/models/Telemetry.js';
import {
  attachWebSocketServer,
  broadcastAlert,
  broadcastGraphStatus,
  broadcastNodeActivity,
  broadcastTelemetry,
} from '../src/services/websocket.js';
import { telemetryBus } from '../src/services/telemetryBus.js';

/**
 * WebSocket channel protocol: subscribe / unsubscribe / telemetry ingestion.
 * No database — `Telemetry.insertMany` is stubbed so the WS ingestion path can be
 * exercised end to end (validate -> ack -> persist -> telemetryBus -> broadcast).
 */

const GRAPH_ID = '64b7f9c2e1a2b3c4d5e6f7a8';
const originalInsertMany = Telemetry.insertMany;

function startServer(t) {
  const server = http.createServer();
  const wss = attachWebSocketServer(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, wss, port: server.address().port }));
  }).then((ctx) => {
    t.after(async () => {
      for (const client of ctx.wss.clients) client.terminate();
      await new Promise((resolve) => ctx.wss.close(resolve));
      await new Promise((resolve) => ctx.server.close(resolve));
      Telemetry.insertMany = originalInsertMany;
    });
    return ctx;
  });
}

/** Open a client and collect every JSON message it receives. */
function openClient(port, t) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages = [];
  socket.on('message', (raw) => {
    try { messages.push(JSON.parse(raw.toString())); } catch { /* ignore malformed */ }
  });
  t.after(() => { try { socket.terminate(); } catch { /* already closed */ } });
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve({ socket, messages }));
    socket.once('error', reject);
  });
}

const send = (socket, message) => socket.send(JSON.stringify(message));

/** Poll until `predicate(messages)` is true or time out. */
async function waitFor(predicate, messages, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(messages)) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate(messages);
}

const sampleReading = (deviceId = 'turbine-001', value = 42.5) => ({
  timestamp: new Date().toISOString(),
  metadata: { deviceId, sensorType: 'temperature', location: 'Lab' },
  value,
  unit: '°C',
});

test('only subscribed channels receive messages', async (t) => {
  const { port } = await startServer(t);
  const alpha = await openClient(port, t); // wants turbine-001 telemetry
  const bravo = await openClient(port, t); // wants alerts
  const charlie = await openClient(port, t); // subscribes to nothing

  await waitFor((m) => m.some((msg) => msg.type === 'connected'), alpha.messages);
  send(alpha.socket, { type: 'subscribe', channels: ['telemetry:turbine-001'] });
  send(bravo.socket, { type: 'subscribe', channels: ['alerts'] });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'subscribed'), alpha.messages));
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'subscribed'), bravo.messages));

  broadcastTelemetry(sampleReading('turbine-001', 55));
  broadcastTelemetry(sampleReading('turbine-999', 77)); // nobody subscribed to this device
  broadcastAlert({ graphId: GRAPH_ID, nodeId: 'sms-1', deviceId: 'turbine-001', value: 99, message: 'overheat', triggeredAt: new Date() });

  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'telemetry' && msg.data.value === 55), alpha.messages), 'alpha gets its device telemetry');
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'alert'), bravo.messages), 'bravo gets alerts');

  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(alpha.messages.filter((m) => m.type === 'telemetry').length, 1, 'alpha must not receive other devices or alerts');
  assert.equal(bravo.messages.filter((m) => m.type === 'telemetry').length, 0, 'bravo must not receive telemetry');
  assert.equal(charlie.messages.filter((m) => m.type === 'telemetry' || m.type === 'alert').length, 0, 'unsubscribed client receives nothing');
});

test('unsubscribe stops delivery on that channel', async (t) => {
  const { port } = await startServer(t);
  const client = await openClient(port, t);
  await waitFor((m) => m.some((msg) => msg.type === 'connected'), client.messages);

  send(client.socket, { type: 'subscribe', channels: ['alerts', `graph:${GRAPH_ID}`] });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'subscribed'), client.messages));

  broadcastAlert({ graphId: GRAPH_ID, nodeId: 'sms-1', deviceId: 'turbine-001', value: 99, message: 'first', triggeredAt: new Date() });
  assert.ok(await waitFor((m) => m.filter((msg) => msg.type === 'alert').length === 1, client.messages));

  send(client.socket, { type: 'unsubscribe', channels: ['alerts'] });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'unsubscribed'), client.messages));

  // Still subscribed to `graph:<id>`: an alert for THIS graph keeps arriving on the
  // graph channel (deduplicated per socket), and node activity/status come through.
  broadcastAlert({ graphId: GRAPH_ID, nodeId: 'sms-1', deviceId: 'turbine-001', value: 98, message: 'second', triggeredAt: new Date() });
  broadcastNodeActivity({ graphId: GRAPH_ID, nodeId: 'threshold-1', value: 98, timestamp: new Date() });
  broadcastGraphStatus(GRAPH_ID, 'active');

  assert.ok(await waitFor((m) => m.filter((msg) => msg.type === 'alert').length === 2, client.messages), 'graph channel still delivers alerts');
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'node_activity'), client.messages), 'node_activity delivered');
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'graph_status' && msg.data.status === 'active'), client.messages));

  // An alert for a different graph reaches nobody here: `alerts` was left and the
  // other graph channel was never subscribed.
  broadcastAlert({ graphId: '64b7f9c2e1a2b3c4d5e6f7b9', nodeId: 'sms-1', deviceId: 'turbine-001', value: 97, message: 'other graph', triggeredAt: new Date() });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(client.messages.filter((msg) => msg.type === 'alert').length, 2, 'alerts from other graphs stay silent');
});

test('clients can push telemetry over WebSocket through the same pipeline', async (t) => {
  Telemetry.insertMany = async (docs) => docs; // no database in this suite
  const { port } = await startServer(t);
  const watcher = await openClient(port, t);
  await waitFor((m) => m.some((msg) => msg.type === 'connected'), watcher.messages);
  send(watcher.socket, { type: 'subscribe', channels: ['telemetry:turbine-007'] });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'subscribed'), watcher.messages));

  const ingester = await openClient(port, t);
  await waitFor((m) => m.some((msg) => msg.type === 'connected'), ingester.messages);

  send(ingester.socket, { type: 'telemetry', data: sampleReading('turbine-007', 61.5) });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'ack' && msg.data.accepted === 1), ingester.messages), 'ingestion is acked');
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'telemetry' && msg.data.value === 61.5), watcher.messages), 'ingested reading is broadcast');

  // The reading also went through the bus (rule engine input).
  assert.ok(telemetryBus.stats().messagesProcessed > 0);
});

test('malformed messages are rejected without crashing the server', async (t) => {
  const { port } = await startServer(t);
  const client = await openClient(port, t);
  await waitFor((m) => m.some((msg) => msg.type === 'connected'), client.messages);

  client.socket.send('this is not json');
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'error' && /Invalid JSON/.test(msg.data.message)), client.messages));

  send(client.socket, { type: 'subscribe', channels: [42, 'not a channel'] });
  assert.ok(await waitFor((m) => m.filter((msg) => msg.type === 'error').length >= 2, client.messages));

  send(client.socket, { type: 'telemetry', data: { value: 'hot' } });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'error' && /Invalid telemetry payload/.test(msg.data.message)), client.messages));

  send(client.socket, { type: 'nope' });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'error' && /Unknown message type/.test(msg.data.message)), client.messages));

  // Still alive and usable afterwards.
  send(client.socket, { type: 'ping' });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'pong'), client.messages), 'server survives malformed input');
});

test('throttles devices sending faster than ~20 msg/s on the broadcast path', async (t) => {
  const { port } = await startServer(t);
  const client = await openClient(port, t);
  await waitFor((m) => m.some((msg) => msg.type === 'connected'), client.messages);
  send(client.socket, { type: 'subscribe', channels: ['telemetry:turbine-fast'] });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'subscribed'), client.messages));

  // 60 readings in a tight loop: server-side evaluation sees all of them (the bus
  // counter proves it), but the client must receive far fewer thanks to sampling.
  for (let i = 0; i < 60; i += 1) broadcastTelemetry(sampleReading('turbine-fast', i));
  await new Promise((resolve) => setTimeout(resolve, 400));

  const delivered = client.messages.filter((msg) => msg.type === 'telemetry').length;
  assert.ok(delivered > 0, 'some telemetry must get through');
  assert.ok(delivered < 60, `hot device must be sampled, got ${delivered}/60`);
});
```
### `client/src/ws/WebSocketProvider.jsx`

```js
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * WebSocket context: one socket for the whole app, channel-based subscriptions,
 * exponential-backoff reconnect and defensive message parsing.
 *
 * Channel protocol (mirrors the server):
 *   telemetry:<deviceId>  device telemetry        (also the catch-all `telemetry`)
 *   alerts                every fired alert
 *   graph:<graphId>       alert + node_activity + graph_status for one graph
 *
 * `subscribe(channels, handler)` returns an unsubscribe function; channels are
 * (re-)sent to the server on every (re)connect, so a reconnect never leaks or drops
 * a subscription.
 */

const WebSocketContext = createContext(null);

function wsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/** Which channels carry a given server message. */
function channelsFor(message) {
  const { type, data } = message;
  if (type === 'telemetry') {
    const deviceId = data?.metadata?.deviceId;
    return deviceId ? [`telemetry:${deviceId}`, 'telemetry'] : ['telemetry'];
  }
  if (type === 'alert') return data?.graphId ? ['alerts', `graph:${data.graphId}`] : ['alerts'];
  if (type === 'node_activity' || type === 'graph_status') {
    return data?.graphId ? [`graph:${data.graphId}`] : [];
  }
  return []; // connected / subscribed / ack / pong / error — handled by the provider itself
}

export function WebSocketProvider({ children }) {
  const [status, setStatus] = useState('connecting');
  const socketRef = useRef(null);
  /** @type {React.MutableRefObject<Map<string, Set<(msg: object) => void>>>} */
  const channelsRef = useRef(new Map());
  const attemptsRef = useRef(0);
  const retryTimerRef = useRef(null);

  const send = useCallback((message) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    try { socket.send(JSON.stringify(message)); return true; }
    catch { return false; }
  }, []);

  /** Subscribe to one or more channels; returns the unsubscribe function. */
  const subscribe = useCallback((channels, handler) => {
    const list = (Array.isArray(channels) ? channels : [channels]).filter((c) => typeof c === 'string' && c);
    const added = [];
    for (const channel of list) {
      let handlers = channelsRef.current.get(channel);
      if (!handlers) { handlers = new Set(); channelsRef.current.set(channel, handlers); added.push(channel); }
      handlers.add(handler);
    }
    if (added.length) send({ type: 'subscribe', channels: added });
    return () => {
      const removed = [];
      for (const channel of list) {
        const handlers = channelsRef.current.get(channel);
        if (!handlers) continue;
        handlers.delete(handler);
        if (handlers.size === 0) { channelsRef.current.delete(channel); removed.push(channel); }
      }
      if (removed.length) send({ type: 'unsubscribe', channels: removed });
    };
  }, [send]);

  useEffect(() => {
    // Disposal is scoped to this effect run: React StrictMode (and real unmounts)
    // must never let a stale socket's onclose schedule a duplicate connection.
    let disposed = false;
    let socket = null;

    const scheduleRetry = () => {
      // Exponential backoff: 0.5s, 1s, 2s, ... capped at 30s.
      const delay = Math.min(500 * 2 ** attemptsRef.current, 30_000);
      attemptsRef.current += 1;
      retryTimerRef.current = setTimeout(connect, delay);
    };

    const dispatch = (message) => {
      const targets = channelsFor(message);
      for (const channel of targets) {
        const handlers = channelsRef.current.get(channel);
        if (!handlers) continue;
        for (const handler of handlers) {
          try { handler(message); }
          catch (error) { console.error('WebSocket handler failed:', error); }
        }
      }
    };

    function connect() {
      if (disposed) return;
      try { socket = new WebSocket(wsUrl()); }
      catch { scheduleRetry(); return; }
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) { try { socket.close(); } catch { /* noop */ } return; }
        attemptsRef.current = 0;
        setStatus('connected');
        const channels = [...channelsRef.current.keys()];
        if (channels.length) send({ type: 'subscribe', channels }); // re-subscribe after reconnect
      };
      socket.onmessage = (event) => {
        if (disposed) return;
        let message;
        try { message = JSON.parse(event.data); }
        catch { return; } // never crash on malformed frames
        if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
        if (message.type === 'connected') return;
        if (message.type === 'error') { console.warn('WebSocket server error:', message.data?.message); return; }
        dispatch(message);
      };
      socket.onerror = () => { try { socket.close(); } catch { /* already closed */ } };
      socket.onclose = () => {
        if (disposed) return;
        if (socketRef.current === socket) socketRef.current = null;
        setStatus('disconnected');
        scheduleRetry();
      };
    }

    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
      try { socket?.close(); } catch { /* already closed */ }
      if (socketRef.current === socket) socketRef.current = null;
      setStatus('disconnected');
    };
  }, [send]);

  const value = useMemo(() => ({
    status,
    subscribe,
    send,
    reconnectNow: () => {
      attemptsRef.current = 0;
      clearTimeout(retryTimerRef.current);
      try { socketRef.current?.close(); } catch { /* noop */ }
    },
  }), [status, subscribe, send]);

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

/** @returns {{ status: string, subscribe: Function, send: Function, reconnectNow: Function } | null} */
export function useWebSocket() {
  return useContext(WebSocketContext);
}
```
### `client/src/ws/useChannel.js`

```js
import { useEffect, useRef } from 'react';
import { useWebSocket } from './WebSocketProvider.jsx';

/**
 * One-line channel subscription:
 *
 *   useChannel('alerts', (message) => console.log(message.data));
 *
 * The socket subscription is created once per channel; the handler is kept in a ref
 * so callers may pass an inline closure without resubscribing. Unsubscribes on
 * unmount (no leaked handlers, no orphan channels on the server).
 *
 * @param {string | null} channel e.g. "telemetry:turbine-001", "alerts", "graph:<id>"
 * @param {(message: { type: string, data: any }) => void} handler
 */
export function useChannel(channel, handler) {
  const ws = useWebSocket();
  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; }, [handler]);

  useEffect(() => {
    if (!ws || !channel) return undefined;
    return ws.subscribe(channel, (message) => handlerRef.current?.(message));
  }, [ws, channel]);
}
```
### `client/src/hooks/useTelemetrySeries.js`

```js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChannel } from '../ws/useChannel.js';

/**
 * Buffered live series for charts and stat cards.
 *
 * Performance contract: incoming WebSocket messages are appended to a ref buffer and
 * flushed into React state at most once every `flushMs` (default 200 ms) via a
 * throttled timer — a device at 100 msg/s causes ~5 re-renders per second, not 100.
 * Everything else (stats, messages/sec) is derived with useMemo from the flushed
 * points, so no per-message computation touches the render path.
 *
 * @param {string | null} channel channel to follow (e.g. "telemetry:turbine-001")
 * @param {{ maxPoints?: number, flushMs?: number, sensorType?: string | null,
 *           valueFilter?: (reading: object) => boolean }} [options]
 * @returns {{ points: { t: number, v: number, unit: string }[], stats: object,
 *             messagesPerSecond: number, latest: object | null, pointCount: number }}
 */
export function useTelemetrySeries(channel, options = {}) {
  const { maxPoints = 60, flushMs = 200, sensorType = null, valueFilter = null } = options;
  const [points, setPoints] = useState([]);
  const [messagesPerSecond, setMessagesPerSecond] = useState(0);

  const bufferRef = useRef([]);       // pending points not yet in state
  const timesRef = useRef([]);        // receive timestamps for the mps figure
  const timerRef = useRef(null);      // pending flush timer (throttle)
  const lastFlushRef = useRef(0);
  const maxPointsRef = useRef(maxPoints);
  maxPointsRef.current = maxPoints;

  const flush = useCallback(() => {
    timerRef.current = null;
    lastFlushRef.current = performance.now();
    const pending = bufferRef.current;
    if (pending.length === 0) return;
    bufferRef.current = [];
    setPoints((current) => {
      const next = current.concat(pending);
      return next.length > maxPointsRef.current ? next.slice(next.length - maxPointsRef.current) : next;
    });
    // Messages-per-second over a rolling 1 s window (pruned on every flush).
    const now = Date.now();
    timesRef.current = timesRef.current.filter((t) => now - t <= 1000);
    setMessagesPerSecond(timesRef.current.length);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current !== null) return;
    const wait = Math.max(0, flushMs - (performance.now() - lastFlushRef.current));
    timerRef.current = setTimeout(flush, wait);
  }, [flush, flushMs]);

  useChannel(channel, useCallback((message) => {
    const readings = Array.isArray(message.data) ? message.data : [message.data];
    for (const reading of readings) {
      if (!reading || typeof reading.value !== 'number' || !Number.isFinite(reading.value)) continue;
      if (sensorType && reading.metadata?.sensorType !== sensorType) continue;
      if (valueFilter && !valueFilter(reading)) continue;
      bufferRef.current.push({
        t: reading.timestamp ? new Date(reading.timestamp).getTime() : Date.now(),
        v: reading.value,
        unit: reading.unit ?? '',
      });
      timesRef.current.push(Date.now());
    }
    if (bufferRef.current.length > maxPointsRef.current * 8) {
      bufferRef.current = bufferRef.current.slice(-maxPointsRef.current * 4);
    }
    scheduleFlush();
  }, [sensorType, valueFilter, scheduleFlush, maxPointsRef]));

  // Safety net: even a quiet stream is flushed within one window; timers are cleared
  // on unmount so nothing keeps the component alive.
  useEffect(() => {
    const interval = setInterval(scheduleFlush, flushMs);
    return () => {
      clearInterval(interval);
      clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [scheduleFlush, flushMs]);

  const stats = useMemo(() => {
    if (points.length === 0) return { latest: null, average: null, min: null, max: null };
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const p of points) {
      if (p.v < min) min = p.v;
      if (p.v > max) max = p.v;
      sum += p.v;
    }
    return {
      latest: points[points.length - 1],
      average: sum / points.length,
      min,
      max,
    };
  }, [points]);

  return { points, stats, messagesPerSecond, latest: stats.latest, pointCount: points.length };
}
```
### `client/src/pages/DashboardPage.jsx`

```js
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, X } from 'lucide-react';
import AlertFeed from '../components/dashboard/AlertFeed.jsx';
import EngineStatus from '../components/dashboard/EngineStatus.jsx';
import LiveLineChart from '../components/dashboard/LiveLineChart.jsx';
import StatCards from '../components/dashboard/StatCards.jsx';
import NavLinks from '../components/layout/NavLinks.jsx';
import { useTelemetrySeries } from '../hooks/useTelemetrySeries.js';
import { errorMessage, graphApi, telemetryApi } from '../services/api.js';
import { useWebSocket } from '../ws/WebSocketProvider.jsx';
import { useChannel } from '../ws/useChannel.js';

const MAX_ALERTS = 50;
const TOAST_MS = 6000;

/**
 * Live dashboard: device selector, rolling chart, stat cards, alert feed (with
 * toast) and the engine status panel. All live data arrives through channel
 * subscriptions on the shared WebSocket; heavy telemetry is buffered by
 * `useTelemetrySeries` so React never re-renders per message.
 */
export default function DashboardPage() {
  const ws = useWebSocket();
  const [devices, setDevices] = useState([]);
  const [device, setDevice] = useState('');
  const [sensorType, setSensorType] = useState('temperature');
  const [alerts, setAlerts] = useState([]);
  const [toast, setToast] = useState(null);
  const [threshold, setThreshold] = useState(null);
  const [loadError, setLoadError] = useState('');

  // ------------------------------------------------- device list (graphs + telemetry)
  useEffect(() => {
    let mounted = true;
    async function loadDevices() {
      const found = new Map(); // deviceId -> sensorTypes
      const add = (deviceId, sensorType) => {
        if (!deviceId || deviceId === '*') return;
        if (!found.has(deviceId)) found.set(deviceId, new Set());
        if (sensorType && sensorType !== '*') found.get(deviceId).add(sensorType);
      };
      try {
        const active = (await graphApi.active()).data.data;
        for (const entry of active) for (const source of entry.sources ?? []) add(source.deviceId, source.sensorType);
      } catch { /* backend offline: fall back to recent telemetry */ }
      try {
        const recent = (await telemetryApi.readings({ limit: 200 })).data.data;
        for (const reading of recent) add(reading.metadata?.deviceId, reading.metadata?.sensorType);
      } catch (error) { if (mounted) setLoadError(errorMessage(error)); }
      if (!mounted) return;
      const list = [...found.entries()].map(([deviceId, sensors]) => ({ deviceId, sensors: [...sensors].sort() }));
      setDevices(list);
      setDevice((current) => current || list[0]?.deviceId || '');
    }
    loadDevices();
    return () => { mounted = false; };
  }, []);

  // ------------------------------------------------- threshold from active rule graphs
  useEffect(() => {
    let mounted = true;
    let cancelled = false;
    async function loadThreshold() {
      setThreshold(null);
      if (!device) return;
      try {
        const active = (await graphApi.active()).data.data;
        for (const entry of active) {
          if (cancelled || !mounted) return;
          const graph = (await graphApi.get(entry.graphId)).data.data;
          const node = (graph.nodes ?? []).find((n) => n.type === 'threshold'
            && (n.data?.config?.deviceId ?? '*') === device
            && (n.data?.config?.sensorType ?? '*') === sensorType);
          if (node?.data?.config?.value !== undefined && !cancelled) {
            setThreshold({ operator: node.data.config.operator ?? '>', value: Number(node.data.config.value) });
            return;
          }
        }
      } catch { /* no active graphs or backend offline: chart runs without a line */ }
    }
    loadThreshold();
    return () => { mounted = false; cancelled = true; };
  }, [device, sensorType]);

  // ------------------------------------------------- live series (buffered, 200 ms)
  const channel = device ? `telemetry:${device}` : null;
  const { points, stats, messagesPerSecond, pointCount } = useTelemetrySeries(channel, { sensorType, maxPoints: 60 });

  // ------------------------------------------------- alert feed + toast
  const handleAlert = useCallback((message) => {
    const alert = message.data;
    if (!alert) return;
    setAlerts((current) => [alert, ...current].slice(0, MAX_ALERTS));
    setToast({ ...alert, key: `${alert.triggeredAt}-${Math.random().toString(36).slice(2, 7)}` });
  }, []);
  useChannel('alerts', handleAlert);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  // Historical alerts so the feed is not empty on first load.
  useEffect(() => {
    let mounted = true;
    telemetryApi.alerts({ limit: 30 })
      .then((response) => { if (mounted) setAlerts(response.data.data ?? []); })
      .catch(() => { /* feed starts empty when the API is unreachable */ });
    return () => { mounted = false; };
  }, []);

  const sensorOptions = useMemo(() => {
    const entry = devices.find((d) => d.deviceId === device);
    return entry?.sensors?.length ? entry.sensors : ['temperature', 'vibration', 'pressure'];
  }, [devices, device]);

  useEffect(() => {
    if (!sensorOptions.includes(sensorType)) setSensorType(sensorOptions[0]);
  }, [sensorOptions, sensorType]);

  const unit = points[points.length - 1]?.unit || '';

  return (
    <div className="dashboard-page">
      <header className="dashboard-topbar">
        <div className="brand select-none">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
          <div className="brand-copy"><strong>NexusFlow<span>.</span></strong><small>LIVE DASHBOARD</small></div>
        </div>
        <NavLinks />
        <div className="dashboard-topbar-meta">
          <span className={`health ${ws?.status === 'connected' ? 'online' : ws?.status === 'disconnected' ? 'offline' : 'checking'}`} role="status">
            <span className="health-dot" />
            {ws?.status === 'connected' ? 'Stream live' : ws?.status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
          </span>
        </div>
      </header>

      <main className="dashboard-body">
        <section className="dashboard-controls panel">
          <div className="control-group">
            <label htmlFor="device-select">Device</label>
            <select id="device-select" value={device} onChange={(event) => setDevice(event.target.value)}>
              {devices.length === 0 && <option value="">No devices yet</option>}
              {devices.map((entry) => <option key={entry.deviceId} value={entry.deviceId}>{entry.deviceId}</option>)}
            </select>
          </div>
          <div className="control-group">
            <label htmlFor="sensor-select">Sensor</label>
            <select id="sensor-select" value={sensorType} onChange={(event) => setSensorType(event.target.value)}>
              {sensorOptions.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
          <div className="control-group control-info">
            <label>Rolling window</label>
            <span className="tabular-nums">last {pointCount} / 60 points · {messagesPerSecond} msg/s</span>
          </div>
          {threshold && (
            <div className="threshold-chip" title="Threshold rule from the active graph">
              rule: {threshold.operator} {threshold.value}
            </div>
          )}
          {loadError && <div className="control-error">{loadError}</div>}
        </section>

        <div className="dashboard-grid">
          <section className="panel chart-panel">
            <header className="panel-header">
              <span className="panel-title"><Activity size={15} /> {device || '—'} · {sensorType}</span>
              <span className="panel-meta">{unit || 'live'}</span>
            </header>
            <LiveLineChart points={points} threshold={threshold} unit={unit} />
          </section>

          <StatCards stats={stats} messagesPerSecond={messagesPerSecond} pointCount={pointCount} unit={unit} />

          <AlertFeed alerts={alerts} />
          <EngineStatus status={ws?.status ?? 'connecting'} />
        </div>
      </main>

      {toast && (
        <div className={`toast alert-toast ${toast.severity === 'critical' ? 'error' : 'success'}`} role="alert">
          <span className="alert-toast-dot" />
          <span><strong>{toast.deviceId}</strong> — {toast.message}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss alert"><X size={16} /></button>
        </div>
      )}
    </div>
  );
}
```
### `client/src/components/dashboard/LiveLineChart.jsx`

```js
import { memo, useMemo } from 'react';
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

const formatTime = (t) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

/**
 * Rolling-window live chart (Recharts).
 *
 * Performance rules:
 *  - `isAnimationActive={false}` on every element (animation would queue frames),
 *  - the parent buffers WebSocket messages and only re-renders every ~200 ms,
 *  - `React.memo` + `useMemo` so an unchanged series never re-renders the subtree.
 *
 * @param {{ points: { t: number, v: number, unit: string }[],
 *           threshold?: { operator: string, value: number } | null,
 *           unit?: string, height?: number }} props
 */
function LiveLineChart({ points, threshold = null, unit = '', height = 280 }) {
  const data = useMemo(
    () => points.map((p) => ({ time: formatTime(p.t), value: Math.round(p.v * 100) / 100 })),
    [points],
  );
  const unitLabel = unit || points[points.length - 1]?.unit || '';

  return (
    <div className="chart-shell" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 16, left: -6, bottom: 4 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="time" minTickGap={40} tick={{ fontSize: 11, fill: 'var(--ink-soft)' }} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
          <YAxis width={46} domain={['auto', 'auto']} tick={{ fontSize: 11, fill: 'var(--ink-soft)' }} tickLine={false} axisLine={false} />
          <Tooltip
            animationDuration={0}
            contentStyle={{ borderRadius: 10, border: '1px solid var(--line)', fontSize: 12 }}
            formatter={(value) => [`${value} ${unitLabel}`, 'value']}
            labelStyle={{ color: 'var(--ink-soft)' }}
          />
          {threshold && Number.isFinite(threshold.value) && (
            <ReferenceLine
              y={threshold.value}
              stroke="#d7654f"
              strokeDasharray="6 4"
              strokeWidth={1.5}
              label={{
                value: `threshold ${threshold.operator} ${threshold.value}`,
                position: 'insideTopRight',
                fontSize: 11,
                fill: '#d7654f',
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--teal)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, animationDuration: 0 }}
            isAnimationActive={false}
            isConnectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default memo(LiveLineChart);
```
### `client/src/components/dashboard/StatCards.jsx`

```js
import { memo, useMemo } from 'react';

const round = (value) => (value == null || Number.isNaN(value) ? '—' : (Math.round(value * 100) / 100).toString());

/**
 * Latest / average / min / max / messages-per-second cards for the selected device.
 * Pure memoised computation over the buffered series — no subscriptions of its own.
 *
 * @param {{ stats: { latest: object|null, average: number|null, min: number|null, max: number|null },
 *           messagesPerSecond: number, pointCount: number, unit?: string }} props
 */
function StatCards({ stats, messagesPerSecond, pointCount, unit = '' }) {
  const cards = useMemo(() => {
    const suffix = unit || stats.latest?.unit || '';
    return [
      { key: 'latest', label: 'Latest value', value: round(stats.latest?.v), accent: 'live' },
      { key: 'average', label: `Average (${pointCount} pts)`, value: round(stats.average) },
      { key: 'min', label: 'Minimum', value: round(stats.min) },
      { key: 'max', label: 'Maximum', value: round(stats.max) },
      { key: 'mps', label: 'Messages / sec', value: String(messagesPerSecond) },
    ].map((card) => ({ ...card, suffix: card.key === 'mps' || card.value === '—' ? '' : suffix }));
  }, [stats, messagesPerSecond, pointCount, unit]);

  return (
    <div className="stat-cards">
      {cards.map((card) => (
        <div key={card.key} className={`dash-stat ${card.accent === 'live' ? 'dash-stat-live' : ''}`}>
          <small>{card.label}</small>
          <strong className="tabular-nums">
            {card.value}
            {card.suffix ? <em> {card.suffix}</em> : null}
          </strong>
        </div>
      ))}
    </div>
  );
}

export default memo(StatCards);
```
### `client/src/components/dashboard/AlertFeed.jsx`

```js
import { memo } from 'react';
import { BellRing, Info, TriangleAlert } from 'lucide-react';

const SEVERITY = {
  critical: { className: 'severity-critical', Icon: TriangleAlert },
  warning: { className: 'severity-warning', Icon: TriangleAlert },
  info: { className: 'severity-info', Icon: Info },
};

const formatTime = (value) => {
  const d = new Date(value);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

/**
 * Live alert list — newest first, severity colour + relative time.
 * Fed by `useChannel('alerts', ...)` in the parent so it re-renders only when an
 * alert actually arrives (alerts are low-volume by design).
 *
 * @param {{ alerts: object[] }} props
 */
function AlertFeed({ alerts }) {
  return (
    <section className="panel alert-feed">
      <header className="panel-header">
        <span className="panel-title"><BellRing size={15} /> Alert feed</span>
        <span className="panel-meta">{alerts.length} recent</span>
      </header>
      {alerts.length === 0 ? (
        <div className="alert-empty">
          <strong>No alerts yet</strong>
          <p>Activate a graph and run the simulator — fired rules show up here instantly.</p>
        </div>
      ) : (
        <ul className="alert-list">
          {alerts.map((alert, index) => {
            const severity = SEVERITY[alert.severity] ?? SEVERITY.info;
            const { Icon } = severity;
            return (
              <li key={`${alert.triggeredAt}-${alert.nodeId}-${index}`} className={`alert-row ${severity.className}`}>
                <span className="alert-severity-icon"><Icon size={14} /></span>
                <span className="alert-copy">
                  <strong>{alert.deviceId}{alert.sensorType ? ` · ${alert.sensorType}` : ''}</strong>
                  <small>{alert.message}</small>
                </span>
                <span className="alert-meta">
                  <em>{alert.severity ?? 'info'}</em>
                  <time dateTime={alert.triggeredAt}>{formatTime(alert.triggeredAt)}</time>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default memo(AlertFeed);
```
### `client/src/components/dashboard/EngineStatus.jsx`

```js
import { memo, useEffect, useState } from 'react';
import { Activity, Cpu, Gauge, Radio, Zap } from 'lucide-react';
import { engineApi, errorMessage } from '../../services/api.js';

/**
 * Engine status panel — polls GET /api/engine/status every 5 s.
 * The interval is cleared on unmount (no leaked timers).
 *
 * @param {{ status: string }} props WebSocket connection status (shown alongside)
 */
function EngineStatus({ status = 'connecting' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    let timer;
    async function poll() {
      try {
        const response = await engineApi.status();
        if (mounted) { setData(response.data.data); setError(''); }
      } catch (err) {
        if (mounted) setError(errorMessage(err));
      }
    }
    poll();
    timer = setInterval(poll, 5000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  const socketLabel = status === 'connected' ? 'LIVE' : status === 'connecting' ? 'CONNECTING' : 'OFFLINE';

  return (
    <section className="panel engine-status">
      <header className="panel-header">
        <span className="panel-title"><Cpu size={15} /> Engine status</span>
        <span className={`socket-badge ${status}`}><i />{socketLabel}</span>
      </header>
      {error && !data ? (
        <div className="engine-error">{error}</div>
      ) : (
        <div className="engine-grid">
          <div className="engine-cell"><Radio size={14} /><strong>{data?.activeGraphs ?? '—'}</strong><small>Active graphs</small></div>
          <div className="engine-cell"><Gauge size={14} /><strong className="tabular-nums">{data?.messagesPerSecond ?? '—'}</strong><small>Msgs / sec</small></div>
          <div className="engine-cell"><Activity size={14} /><strong className="tabular-nums">{data?.messagesProcessed?.toLocaleString() ?? '—'}</strong><small>Processed</small></div>
          <div className="engine-cell"><Zap size={14} /><strong className="tabular-nums">{data?.alertsFired ?? '—'}</strong><small>Alerts fired</small></div>
        </div>
      )}
      {data && <footer className="engine-footer">uptime {Math.floor((data.uptimeSeconds ?? 0) / 60)}m {((data.uptimeSeconds ?? 0) % 60)}s · polled every 5s</footer>}
    </section>
  );
}

export default memo(EngineStatus);
```
### `client/src/components/layout/NavLinks.jsx`

```js
import { NavLink } from 'react-router-dom';

/**
 * Shared Editor | Dashboard navigation (React Router).
 * `NavLink` applies `.active` automatically for styling.
 */
export default function NavLinks({ className = '' }) {
  return (
    <nav className={`route-nav ${className}`} aria-label="Primary">
      <NavLink to="/" end>Editor</NavLink>
      <NavLink to="/dashboard">Dashboard</NavLink>
    </nav>
  );
}
```

## Modified files
### `server/src/services/websocket.js`

```js
import { WebSocket, WebSocketServer } from 'ws';
import { Telemetry } from '../models/Telemetry.js';
import { readingSchema } from '../validation/telemetry.js';
import { telemetryBus } from './telemetryBus.js';

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

const CHANNEL_PATTERN = /^(alerts|telemetry|telemetry:[\w.:-]{1,120}|graph:[\w-]{1,120})$/;
const ACTIVITY_WINDOW_MS = 300;
const THROTTLE_WINDOW_MS = 50; // >20 msg/s triggers sampling
const SAMPLE_MS = 100;

/* ------------------------------------------------------------------ sending */

function sendTo(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > maxBufferedBytes) return false;
  socket.send(payload, (error) => {
    if (error) console.error('WebSocket send failed:', error.message);
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
    console.error(`WebSocket serialisation failed for ${type}: ${error.message}`);
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
  const data = { graphId, nodeId, value: activity.value, timestamp: activity.timestamp ?? new Date() };
  const now = Date.now();
  const last = activitySentAt.get(key) ?? 0;
  if (now - last >= ACTIVITY_WINDOW_MS) {
    activitySentAt.set(key, now);
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

/** Announce activation / deactivation / error of a pipeline to `graph:<id>` subscribers. */
export function broadcastGraphStatus(graphId, status) {
  if (!graphId) return;
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
    try {
      await Telemetry.insertMany([reading], { ordered: false, lean: true });
    } catch (error) {
      console.error(`WebSocket telemetry persist failed: ${error.message}`);
    }
    try {
      telemetryBus.ingest([reading]);
    } catch (error) {
      console.error(`WebSocket telemetry fan-out failed: ${error.message}`);
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
    console.error(`WebSocket message handling failed: ${error.message}`);
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

  socketServer.on('connection', (socket) => {
    socket.isAlive = true;
    socket.channels = new Set();
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('error', (error) => console.error('WebSocket error:', error.message));
    socket.on('message', (raw) => handleMessage(socket, raw));
    socket.on('close', () => detachSocket(socket));
    sendJson(socket, 'connected', { message: 'Connected to NexusFlow', channels: ['telemetry', 'telemetry:<deviceId>', 'alerts', 'graph:<graphId>'] });
  });
  socketServer.on('error', (error) => console.error('WebSocket server error:', error.message));

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
    for (const timer of activityTimers.values()) clearTimeout(timer);
    activityTimers.clear();
    activitySentAt.clear();
    channels.clear();
    socketServer = null;
  });

  return socketServer;
}
```
### `server/src/services/activeGraphManager.js`

```js
import { Graph } from '../models/Graph.js';
import { compileGraph } from '../compiler/index.js';
import { httpError } from '../utils/httpError.js';
import { env } from '../config/env.js';
import { broadcastAlert, broadcastGraphStatus, broadcastNodeActivity } from './websocket.js';
import { ruleExecutor } from './ruleExecutor.js';
import { telemetryBus } from './telemetryBus.js';

/**
 * Holds the compiled pipelines that are currently running, keyed by graph id.
 *
 * Compiling is cheap but not free: a graph is compiled once on activation and then fed
 * by the ingestion path. Re-compiling or deactivating always disposes the previous
 * pipeline so no subscription or Subject is left behind.
 */
class ActiveGraphManager {
  /** @type {Map<string, { graphId: string, name: string, compiled: object, activatedAt: Date, sources: object[] }>} */
  #pipelines = new Map();

  /**
   * Load a saved graph, validate + compile it and make it the active pipeline.
   *
   * @param {string} graphId
   * @returns {Promise<object>} activation summary
   */
  async activate(graphId) {
    const graph = await Graph.findById(graphId).lean();
    if (!graph) throw httpError(404, 'Graph not found.');

    const id = String(graph._id);
    const compiled = compileGraph(
      { nodes: graph.nodes ?? [], edges: graph.edges ?? [] },
      {
        graphId: id,
        onAlert: (alert) => {
          telemetryBus.recordAlertFired();
          broadcastAlert({ graphId: id, ...alert });
        },
        // Optional per-node activity taps (Day 4 glowing wires); disabled in production
        // runs unless NODE_ACTIVITY_ENABLED=true.
        trackActivity: env.nodeActivityEnabled,
        onActivity: (activity) => broadcastNodeActivity(activity),
      },
    );

    // Replace any previously compiled version of this graph.
    this.deactivate(id);
    const entry = {
      graphId: id,
      name: graph.name,
      compiled,
      sources: compiled.sources,
      nodeCount: compiled.nodeCount,
      edgeCount: compiled.edgeCount,
      warnings: compiled.warnings,
      activatedAt: new Date(),
    };
    this.#pipelines.set(id, entry);
    // Route live telemetry to this graph through the rule executor (O(1) key lookup).
    ruleExecutor.register({ graphId: id, sources: compiled.sources, publish: compiled.publish });
    broadcastGraphStatus(id, 'active');
    return entry;
  }

  /**
   * Dispose a running pipeline.
   * @param {string} graphId
   * @returns {boolean} true when something was deactivated
   */
  deactivate(graphId) {
    const entry = this.#pipelines.get(graphId);
    if (!entry) return false;
    try {
      entry.compiled.dispose();
    } catch (error) {
      console.error(`Failed to dispose pipeline ${graphId}: ${error.message}`);
    }
    this.#pipelines.delete(graphId);
    // Stop routing live telemetry to this graph and tell subscribers it is gone.
    try { ruleExecutor.unregister(graphId); } catch (error) { console.error(`Failed to unregister ${graphId}: ${error.message}`); }
    broadcastGraphStatus(graphId, 'inactive');
    return true;
  }

  /** @returns {object[]} summaries of every active pipeline */
  list() {
    return [...this.#pipelines.values()].map((entry) => this.#summarise(entry));
  }

  /** @param {string} graphId */
  get(graphId) {
    const entry = this.#pipelines.get(graphId);
    return entry ? this.#summarise(entry) : null;
  }

  /**
   * Feed freshly ingested readings into every active pipeline.
   * Never throws: a broken pipeline must not fail ingestion.
   *
   * @param {object[]} readings persisted telemetry documents
   * @returns {number} how many (pipeline, reading) deliveries happened
   */
  publish(readings) {
    if (this.#pipelines.size === 0 || !Array.isArray(readings) || readings.length === 0) return 0;
    let delivered = 0;
    for (const entry of this.#pipelines.values()) {
      for (const reading of readings) {
        try {
          delivered += entry.compiled.publish(reading);
        } catch (error) {
          console.error(`Pipeline ${entry.graphId} failed to process a reading: ${error.message}`);
        }
      }
    }
    return delivered;
  }

  /** Dispose everything — used on shutdown and by tests. */
  disposeAll() {
    for (const graphId of [...this.#pipelines.keys()]) this.deactivate(graphId);
  }

  #summarise(entry) {
    return {
      graphId: entry.graphId,
      name: entry.name,
      nodeCount: entry.nodeCount,
      edgeCount: entry.edgeCount,
      sources: entry.sources,
      warnings: entry.warnings,
      activatedAt: entry.activatedAt,
      subscriptions: entry.compiled.subscriptions.length,
    };
  }
}

export const activeGraphManager = new ActiveGraphManager();
```
### `server/src/compiler/streamCompiler.js`

```js
import { EMPTY, Subject, catchError, concatMap, of, share, tap } from 'rxjs';
import { getNode, listNodes, resolveConfig } from './nodeRegistry.js';
import { validateGraph } from './graphValidator.js';
// Importing the node modules is what populates the registry.
import './operators/index.js';
import './actions/index.js';
import './sources/index.js';

/**
 * Thrown when a graph cannot be compiled. Carries the validator issues so the API can
 * return them verbatim.
 */
export class GraphValidationError extends Error {
  constructor(errors, warnings = []) {
    super(`Graph is not valid: ${errors.map((issue) => issue.message).join(' ')}`);
    this.name = 'GraphValidationError';
    this.status = 400;
    this.errors = errors;
    this.warnings = warnings;
  }
}

/**
 * Normalise a persisted telemetry reading into the event shape that flows through a
 * pipeline: `{ deviceId, sensorType, unit, timestamp, value }`.
 */
export function toEvent(reading = {}) {
  return {
    deviceId: reading.metadata?.deviceId ?? 'unknown',
    sensorType: reading.metadata?.sensorType,
    unit: reading.unit,
    timestamp: reading.timestamp ? new Date(reading.timestamp) : new Date(),
    value: Number(reading.value),
  };
}

/**
 * Compile a validated graph into a live RxJS pipeline.
 *
 * Strategy
 *   1. every **source** node gets a `Subject` (the entry point for telemetry),
 *   2. every **math** node wraps its parent's stream with the operator from the registry,
 *   3. streams with more than one child are `share()`d so branching never duplicates work,
 *   4. every **action** node is subscribed at a leaf and its handler runs per event,
 *   5. `dispose()` unsubscribes everything so graphs can be swapped at runtime.
 *
 * @param {object} graph raw React Flow JSON `{ nodes, edges }`
 * @param {{ graphId?: string | null, dryRun?: boolean, onAlert?: (result: object) => void,
 *           trackActivity?: boolean, onActivity?: (activity: object) => void }} [options]
 *   `dryRun` compiles the pipeline but never sends an SMS, calls a webhook or writes to the
 *   database; fired alerts are collected and returned by `getAlerts()`.
 *   `trackActivity` inserts a throttled `tap()` on every node that reports
 *   `{ graphId, nodeId, value }` to `onActivity` — off by default so production runs
 *   pay nothing for instrumentation.
 * @returns {object} compiled pipeline handle
 */
export function compileGraph(graph, options = {}) {
  const {
    graphId = null,
    dryRun = false,
    onAlert = null,
    trackActivity = false,
    onActivity = null,
  } = options;
  const emitActivity = trackActivity && typeof onActivity === 'function';

  const validation = validateGraph(graph);
  if (!validation.ok) throw new GraphValidationError(validation.errors, validation.warnings);

  const nodes = validation.nodes;
  const edges = validation.edges;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  /** @type {Map<string, string[]>} outgoing neighbours */
  const children = new Map(nodes.map((node) => [node.id, []]));
  /** @type {Map<string, string[]>} incoming neighbours (at most one per node) */
  const parents = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    children.get(edge.source).push(edge.target);
    parents.get(edge.target).push(edge.source);
  }

  /** @type {Map<string, Subject<object>>} nodeId -> Subject (source nodes only) */
  const subjects = new Map();
  /** @type {Map<string, import('rxjs').Observable<object>>} memoised streams (nodeId -> Observable) */
  const streams = new Map();
  /** @type {import('rxjs').Subscription[]} */
  const subscriptions = [];
  /** @type {object[]} alerts collected in dry-run mode */
  const alerts = [];
  let disposed = false;

  const sourceNodes = nodes.filter((node) => node.definition.category === 'source');
  const actionNodes = nodes.filter((node) => node.definition.category === 'action');
  for (const node of sourceNodes) subjects.set(node.id, new Subject());

  /** Guard against a malformed graph reaching unbounded recursion (defensive; validator rejects cycles). */
  function buildStream(nodeId, path = []) {
    if (streams.has(nodeId)) return streams.get(nodeId);
    if (path.includes(nodeId)) throw new Error(`Node "${nodeId}" is part of a cycle (${[...path, nodeId].join(' -> ')}).`);

    const node = nodesById.get(nodeId);
    if (!node) throw new Error(`Node "${nodeId}" not found in graph (edge points at a missing node).`);
    const config = resolveConfig(node.type, node.config);
    let stream$;

    if (node.definition.category === 'source') {
      stream$ = subjects.get(nodeId);
    } else {
      const [parentId] = parents.get(nodeId);
      if (!parentId) {
        // A math node may legally have no input (the validator flags this as a warning:
        // it can never receive data). Compile it as a dead branch — an EMPTY stream —
        // instead of dereferencing an undefined parent and crashing the whole pipeline.
        stream$ = EMPTY;
      } else {
        const input$ = buildStream(parentId, [...path, nodeId]);
        const operator = node.definition.createOperator(config, { graphId, nodeId, dryRun });
        // A failing operator must not tear down sibling branches: catch here and log.
        stream$ = input$.pipe(
          operator,
          catchError((error) => {
            console.error(`[compiler] node "${nodeId}" (${node.type}) failed: ${error.message}`);
            return EMPTY;
          }),
        );
      }
    }

    // Optional instrumentation: one tap per node reports values to the activity bus
    // (throttled downstream by the WebSocket layer). Zero cost when trackActivity is off.
    if (emitActivity) {
      stream$ = stream$.pipe(
        tap((event) => {
          try { onActivity({ graphId, nodeId, value: event?.value, timestamp: new Date() }); }
          catch { /* an activity listener must never break the pipeline */ }
        }),
      );
    }

    // Fan-out: share one upstream subscription between all children.
    if (children.get(nodeId).length > 1) stream$ = stream$.pipe(share());

    streams.set(nodeId, stream$);
    return stream$;
  }

  // --------------------------------------------------------------- actions
  for (const node of actionNodes) {
    const [parentId] = parents.get(node.id);
    if (!parentId) continue; // Disconnected action: the validator already warns.

    const config = resolveConfig(node.type, node.config);
    const context = { graphId, nodeId: node.id, dryRun, type: node.type };
    const rawHandler = node.definition.createAction(config, context);

    // Optional per-device cooldown (config `cooldownSeconds`, default 0 = disabled):
    // while the window is open the handler is never called, so nothing is persisted,
    // broadcast or sent — this is what stops alert spam during a sustained spike.
    const cooldownMs = Math.max(0, Number(config.cooldownSeconds) || 0) * 1000;
    const lastFiredAt = new Map(); // deviceId -> epoch ms
    const handler = cooldownMs > 0
      ? (event) => {
        const key = event?.deviceId ?? '*';
        const now = Date.now();
        const previous = lastFiredAt.get(key);
        if (previous !== undefined && now - previous < cooldownMs) return null; // suppressed
        lastFiredAt.set(key, now);
        return rawHandler(event);
      }
      : rawHandler;

    const input$ = buildStream(parentId);

    // Activity tap for the action itself: it only sees the events that actually reach
    // the action (i.e. the ones that passed every upstream condition).
    const actionInput$ = emitActivity
      ? input$.pipe(
        tap((event) => {
          try { onActivity({ graphId, nodeId: node.id, value: event?.value, timestamp: new Date() }); }
          catch { /* an activity listener must never break the pipeline */ }
        }),
      )
      : input$;

    const actionStream$ = actionInput$.pipe(
      // concatMap keeps events in order even when a handler is asynchronous.
      concatMap((event) => of(event).pipe(
        concatMap((value) => Promise.resolve()
          .then(() => handler(value))
          .catch((error) => ({
            nodeId: node.id,
            type: node.type,
            deviceId: value?.deviceId,
            value: value?.value,
            message: `Action failed: ${error.message}`,
            error: error.message,
            delivered: false,
            triggeredAt: new Date(),
          }))),
        catchError((error) => {
          console.error(`[compiler] action "${node.id}" (${node.type}) failed: ${error.message}`);
          return EMPTY;
        }),
      )),
      catchError((error) => {
        console.error(`[compiler] pipeline for action "${node.id}" stopped: ${error.message}`);
        return EMPTY;
      }),
    );

    subscriptions.push(actionStream$.subscribe({
      next: (result) => {
        if (result == null) return; // cooldown suppressed this firing (null sentinel)
        if (dryRun) alerts.push(result);
        try {
          onAlert?.(result);
        } catch (error) {
          console.error(`[compiler] alert listener failed: ${error.message}`);
        }
      },
      error: (error) => console.error(`[compiler] action "${node.id}" subscription error: ${error.message}`),
    }));
  }

  /** Build an event for a source node from a raw test value. */
  function buildEvent(raw, config) {
    const base = {
      deviceId: config.deviceId ?? 'test-device',
      sensorType: config.sensorType ?? 'value',
      unit: '',
      timestamp: new Date(),
    };
    if (typeof raw === 'number') return { ...base, value: raw };
    return {
      deviceId: raw?.deviceId ?? base.deviceId,
      sensorType: raw?.sensorType ?? base.sensorType,
      unit: raw?.unit ?? '',
      timestamp: raw?.timestamp ? new Date(raw.timestamp) : base.timestamp,
      value: Number(raw?.value),
    };
  }

  return {
    graphId,
    dryRun,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    warnings: validation.warnings,
    subjects,
    subscriptions,
    sources: sourceNodes.map((node) => {
      const config = resolveConfig(node.type, node.config);
      return {
        nodeId: node.id,
        type: node.type,
        deviceId: config.deviceId ?? '*',
        sensorType: config.sensorType ?? '*',
        key: node.definition.subjectKey?.(config) ?? `${config.deviceId ?? '*'}:${config.sensorType ?? '*'}`,
      };
    }),

    /** Feed one persisted telemetry reading into every matching source node. */
    publish(reading) {
      if (disposed) return 0;
      let delivered = 0;
      for (const node of sourceNodes) {
        const config = resolveConfig(node.type, node.config);
        if (node.definition.matches && !node.definition.matches(reading, config)) continue;
        subjects.get(node.id).next(toEvent(reading));
        delivered += 1;
      }
      return delivered;
    },

    /**
     * Dry-run helper: push sample values (numbers or `{ deviceId, sensorType, value }`)
     * through the pipeline and return how many source nodes consumed them.
     */
    pushValues(values) {
      if (disposed) return 0;
      let delivered = 0;
      for (const raw of values) {
        for (const node of sourceNodes) {
          const config = resolveConfig(node.type, node.config);
          const event = buildEvent(raw, config);
          if (node.definition.matches && !node.definition.matches({ metadata: event }, config)) continue;
          subjects.get(node.id).next(event);
          delivered += 1;
        }
      }
      return delivered;
    },

    /** Alerts collected while running in dry-run mode. */
    getAlerts: () => (dryRun ? [...alerts] : []),

    get disposed() {
      return disposed;
    },

    /** Unsubscribe every action and complete every source Subject. */
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const subscription of subscriptions) subscription.unsubscribe();
      subscriptions.length = 0;
      for (const subject of subjects.values()) subject.complete();
      subjects.clear();
      streams.clear();
    },
  };
}

/**
 * Node metadata for clients/UI (types, labels, defaults, categories), so the React
 * palette can stay in sync with the compiler instead of hard-coding node kinds.
 */
export function describeNodes() {
  return listNodes().map(({ type, category, label, defaults }) => ({ type, category, label, defaults }));
}

export { getNode };
```
### `server/src/compiler/actions/template.js`

```js
/**
 * Render an action message template.
 *
 * Supported placeholders: ${value}, ${deviceId}, ${sensorType}, ${unit}, ${timestamp}, ${date}
 * Unknown placeholders are left untouched so no information is silently lost.
 *
 * @param {string} template
 * @param {{ value?: number, deviceId?: string, sensorType?: string, unit?: string, timestamp?: Date | string }} event
 * @returns {string}
 */
export function renderTemplate(template, event = {}) {
  if (typeof template !== 'string' || template.trim() === '') return defaultMessage(event);
  const when = event.timestamp ? new Date(event.timestamp) : new Date();
  const values = {
    value: formatNumber(event.value),
    deviceId: event.deviceId ?? 'unknown-device',
    sensorType: event.sensorType ?? 'unknown-sensor',
    unit: event.unit ?? '',
    timestamp: when.toISOString(),
    date: when.toISOString().slice(0, 10),
  };
  return template.replace(/\$\{\s*(\w+)\s*\}/g, (match, key) => (key in values ? String(values[key]) : match));
}

/**
 * Shared validation for the optional `cooldownSeconds` action setting
 * (0 = disabled, max 24 h). Enforced centrally by the stream compiler.
 * @param {{ cooldownSeconds?: unknown }} config
 * @returns {string[]} human-readable issues
 */
export function cooldownErrors(config) {
  const { cooldownSeconds } = config;
  if (cooldownSeconds === undefined) return [];
  if (typeof cooldownSeconds !== 'number' || !Number.isFinite(cooldownSeconds)
    || !Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 86_400) {
    return ['cooldownSeconds must be an integer between 0 and 86400 (24 h).'];
  }
  return [];
}

export function defaultMessage(event = {}) {
  const unit = event.unit ? ` ${event.unit}` : '';
  return `Alert: ${event.deviceId ?? 'unknown-device'} ${event.sensorType ?? ''} = ${formatNumber(event.value)}${unit}`.trim();
}

function formatNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
```
### `server/src/compiler/actions/log.js`

```js
import { registerNode } from '../nodeRegistry.js';
import { recordAlert } from '../../services/alertService.js';
import { cooldownErrors, renderTemplate } from './template.js';

/**
 * Console action — the cheapest way to see a pipeline working during development
 * and the action used by the unit tests.
 */
export function createLogAction(config, context) {
  const prefix = String(config.label ?? '').trim() || 'log';

  return async (event) => {
    const message = renderTemplate(config.template || '${deviceId} ${sensorType} = ${value}${unit}', event);
    const result = {
      nodeId: context.nodeId,
      type: 'log',
      deviceId: event?.deviceId ?? 'unknown',
      sensorType: event?.sensorType,
      value: event?.value,
      message,
      triggeredAt: new Date(),
      delivered: true,
      dryRun: Boolean(context.dryRun),
    };

    // Dry runs collect results in memory; keep the test output quiet.
    if (!context.dryRun) {
      console.info(`[${prefix}] ${message}`);
      await recordAlert({
        graphId: context.graphId,
        nodeId: context.nodeId,
        type: 'log',
        deviceId: result.deviceId,
        sensorType: result.sensorType,
        value: result.value,
        message,
        triggeredAt: result.triggeredAt,
      });
    }
    return result;
  };
}

registerNode({
  type: 'log',
  category: 'action',
  label: 'Log',
  defaults: { label: 'pipeline', template: '${deviceId} ${sensorType} = ${value}${unit}', cooldownSeconds: 0 },
  validate(config) {
    const errors = [];
    if (config.label !== undefined && String(config.label).length > 60) errors.push('label must be 60 characters or fewer.');
    errors.push(...cooldownErrors(config));
    return errors;
  },
  createAction: createLogAction,
});
```
### `server/src/compiler/actions/smsAlert.js`

```js
import { registerNode } from '../nodeRegistry.js';
import { recordAlert } from '../../services/alertService.js';
import { cooldownErrors, renderTemplate } from './template.js';

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
  defaults: { phone: '+10000000000', messageTemplate: DEFAULT_TEMPLATE, cooldownSeconds: 0 },
  validate(config) {
    const errors = [];
    if (config.phone !== undefined) {
      const phone = String(config.phone).trim();
      if (phone === '' || !/^\+?[0-9 ()-]{6,20}$/.test(phone)) errors.push('phone must be 6-20 digits (optional leading +).');
    }
    if (config.messageTemplate !== undefined && String(config.messageTemplate).length > 240) {
      errors.push('messageTemplate must be 240 characters or fewer.');
    }
    errors.push(...cooldownErrors(config));
    return errors;
  },
  createAction: createSmsAction,
});
```
### `server/src/compiler/actions/webhook.js`

```js
import axios from 'axios';
import { registerNode } from '../nodeRegistry.js';
import { recordAlert } from '../../services/alertService.js';
import { cooldownErrors, renderTemplate } from './template.js';

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
  defaults: { url: 'https://example.com/hook', method: 'POST', cooldownSeconds: 0 },
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
    errors.push(...cooldownErrors(config));
    return errors;
  },
  createAction: createWebhookAction,
});
```
### `server/src/controllers/telemetryController.js`

```js
import { Telemetry } from '../models/Telemetry.js';
import { telemetryBus } from '../services/telemetryBus.js';

/**
 * Persist the readings, respond 202 immediately, then fan out.
 *
 * Hot path contract: the HTTP response never waits for rule evaluation or WebSocket
 * delivery. `insertMany` runs first so the 202 is honest about durability; everything
 * else (telemetryBus -> ruleExecutor -> RxJS pipelines, channel broadcast) happens on
 * the next tick after the response is flushed.
 */
async function insertAndAccept(readings, res) {
  // Zod has already validated/cast the complete payload. lean avoids a second
  // Mongoose hydration/validation pass on this high-throughput path.
  const inserted = await Telemetry.insertMany(readings, { ordered: false, lean: true });
  res.status(202).json({ accepted: inserted.length });
  setImmediate(() => {
    try { telemetryBus.ingest(inserted); }
    catch (error) { console.error('Telemetry fan-out failed:', error.message); }
  });
}

export async function ingestReading(req, res) {
  await insertAndAccept([res.locals.validated.body], res);
}

export async function ingestBatch(req, res) {
  await insertAndAccept(res.locals.validated.body, res);
}

export async function getReadings(req, res) {
  const { deviceId, from, to, limit } = res.locals.validated.query;
  const filter = {};
  if (deviceId) filter['metadata.deviceId'] = deviceId;
  if (from || to) {
    filter.timestamp = {};
    if (from) filter.timestamp.$gte = from;
    if (to) filter.timestamp.$lte = to;
  }
  const data = await Telemetry.find(filter).sort({ timestamp: -1 }).limit(limit).lean();
  res.json({ data });
}

/**
 * GET /api/telemetry/stats?deviceId=&window=5m
 * Per-minute buckets (avg / min / max / count) via a MongoDB aggregation pipeline.
 * The first stage always matches on `timestamp`, which time-series collections require.
 */
export async function getTelemetryStats(req, res) {
  const { deviceId, windowMs } = res.locals.validated.query;
  const since = new Date(Date.now() - windowMs);
  const match = { timestamp: { $gte: since } };
  if (deviceId) match['metadata.deviceId'] = deviceId;

  const buckets = await Telemetry.aggregate([
    { $match: match },
    {
      $group: {
        _id: { minute: { $dateTrunc: { date: '$timestamp', unit: 'minute' } } },
        avg: { $avg: '$value' },
        min: { $min: '$value' },
        max: { $max: '$value' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.minute': 1 } },
    {
      $project: {
        _id: 0,
        minute: '$_id.minute',
        avg: { $round: ['$avg', 3] },
        min: 1,
        max: 1,
        count: 1,
      },
    },
  ]).allowDiskUse(true);

  res.json({
    data: {
      deviceId: deviceId ?? null,
      since,
      window: `${Math.round(windowMs / 60_000)}m`,
      buckets,
    },
  });
}
```
### `server/src/controllers/graphController.js`

```js
import { Graph } from '../models/Graph.js';
import { compileGraph, validateGraph, GraphValidationError } from '../compiler/index.js';
import { activeGraphManager } from '../services/activeGraphManager.js';
import { broadcastGraphStatus } from '../services/websocket.js';
import { httpError } from '../utils/httpError.js';

export async function createGraph(req, res) {
  const graph = await Graph.create(res.locals.validated.body);
  res.status(201).json({ data: graph });
}

export async function listGraphs(req, res) {
  // Keep the picker response small; GET by ID returns the complete graph.
  const graphs = await Graph.find().select('name createdAt updatedAt').sort({ updatedAt: -1 }).limit(100).lean();
  res.json({ data: graphs });
}

export async function getGraph(req, res) {
  const graph = await Graph.findById(res.locals.validated.params.id).lean();
  if (!graph) return res.status(404).json({ error: { message: 'Graph not found.' } });
  return res.json({ data: graph });
}

export async function updateGraph(req, res) {
  const graph = await Graph.findByIdAndUpdate(res.locals.validated.params.id, res.locals.validated.body, {
    new: true,
    runValidators: true,
  }).lean();
  if (!graph) return res.status(404).json({ error: { message: 'Graph not found.' } });
  return res.json({ data: graph });
}

export async function deleteGraph(req, res) {
  const graph = await Graph.findByIdAndDelete(res.locals.validated.params.id).lean();
  if (!graph) return res.status(404).json({ error: { message: 'Graph not found.' } });
  return res.status(204).end();
}

/**
 * POST /api/graphs/validate — validate raw graph JSON without saving it.
 * Returns 200 with `{ valid, errors, warnings }` (a 400 is reserved for malformed bodies).
 */
export async function validateGraphJson(req, res) {
  const result = validateGraph(res.locals.validated.body);
  res.json({
    valid: result.ok,
    errors: result.errors,
    warnings: result.warnings,
    summary: { nodeCount: result.nodes.length, edgeCount: result.edges.length },
  });
}

/**
 * POST /api/graphs/:id/compile — validate + compile a saved graph and activate it.
 */
export async function compileGraphHandler(req, res) {
  const { id } = res.locals.validated.params;
  try {
    const entry = await activeGraphManager.activate(id);
    res.status(200).json({
      data: {
        graphId: entry.graphId,
        name: entry.name,
        nodeCount: entry.nodeCount,
        edgeCount: entry.edgeCount,
        sources: entry.sources,
        warnings: entry.warnings,
        subscriptions: entry.compiled.subscriptions.length,
        activatedAt: entry.activatedAt,
      },
    });
  } catch (error) {
    if (error instanceof GraphValidationError) {
      broadcastGraphStatus(id, 'error');
      return res.status(400).json({ error: { message: 'Graph is not valid.', details: error.errors, warnings: error.warnings } });
    }
    broadcastGraphStatus(id, 'error');
    throw error;
  }
}

/** POST /api/graphs/:id/deactivate — dispose the pipeline and forget it. */
export async function deactivateGraphHandler(req, res) {
  const { id } = res.locals.validated.params;
  const deactivated = activeGraphManager.deactivate(id);
  if (!deactivated) throw httpError(404, 'No active pipeline found for this graph.');
  return res.json({ data: { graphId: id, active: false } });
}

/** GET /api/graphs/active — summaries of every running pipeline. */
export async function listActiveGraphs(req, res) {
  res.json({ data: activeGraphManager.list() });
}

/**
 * POST /api/graphs/:id/test — dry run: push sample values through the compiled pipeline
 * and return the alerts that fired. Nothing is sent and nothing is persisted.
 */
export async function testGraphHandler(req, res) {
  const { id } = res.locals.validated.params;
  const { values } = res.locals.validated.body;

  const graph = await Graph.findById(id).lean();
  if (!graph) throw httpError(404, 'Graph not found.');

  let compiled;
  try {
    compiled = compileGraph({ nodes: graph.nodes ?? [], edges: graph.edges ?? [] }, { graphId: String(graph._id), dryRun: true });
  } catch (error) {
    if (error instanceof GraphValidationError) {
      return res.status(400).json({ error: { message: 'Graph is not valid.', details: error.errors, warnings: error.warnings } });
    }
    throw error;
  }

  try {
    const delivered = compiled.pushValues(values);
    // Handlers are async; let the microtask queue drain before reading the results.
    await new Promise((resolve) => setImmediate(resolve));
    const alerts = compiled.getAlerts();
    res.json({
      data: {
        graphId: String(graph._id),
        dryRun: true,
        values: values.length,
        delivered,
        alertCount: alerts.length,
        alerts,
      },
    });
  } finally {
    compiled.dispose();
  }
}
```
### `server/src/routes/telemetryRoutes.js`

```js
import { Router } from 'express';
import { getReadings, getTelemetryStats, ingestBatch, ingestReading } from '../controllers/telemetryController.js';
import { asyncHandler, validate } from '../middleware/validate.js';
import { batchSchema, readingSchema, statsQuerySchema, telemetryQuerySchema } from '../validation/telemetry.js';

const router = Router();
// Static paths must be declared BEFORE "/" so they are not captured by the param route.
router.get('/stats', validate(statsQuerySchema, 'query'), asyncHandler(getTelemetryStats));
router.post('/', validate(readingSchema), asyncHandler(ingestReading));
router.post('/batch', validate(batchSchema), asyncHandler(ingestBatch));
router.get('/', validate(telemetryQuerySchema, 'query'), asyncHandler(getReadings));
export default router;
```
### `server/src/app.js`

```js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import alertRoutes from './routes/alertRoutes.js';
import engineRoutes from './routes/engineRoutes.js';
import graphRoutes from './routes/graphRoutes.js';
import telemetryRoutes from './routes/telemetryRoutes.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.clientOrigins }));
app.use(express.json({ limit: '2mb' }));
if (env.nodeEnv !== 'test') app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.get('/api/health', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({
    status: connected ? 'ok' : 'degraded',
    database: connected ? 'connected' : 'disconnected',
  });
});
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/graphs', graphRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/engine', engineRoutes);
app.use(notFound);
app.use(errorHandler);

export default app;
```
### `server/src/server.js`

```js
import http from 'node:http';
import mongoose from 'mongoose';
import app from './app.js';
import { connectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { attachWebSocketServer } from './services/websocket.js';
import { activeGraphManager } from './services/activeGraphManager.js';
import { ruleExecutor } from './services/ruleExecutor.js';

let server;
let sockets;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`${signal}: shutting down`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  if (sockets) {
    for (const client of sockets.clients) client.terminate();
    sockets.close();
  }
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  // Release every compiled pipeline and detach the rule engine before the process exits.
  activeGraphManager.disposeAll();
  ruleExecutor.stop();
  await mongoose.disconnect();
  clearTimeout(forceExit);
}

process.on('SIGINT', () => { shutdown('SIGINT').catch(console.error); });
process.on('SIGTERM', () => { shutdown('SIGTERM').catch(console.error); });

try {
  await connectDatabase();
  server = http.createServer(app);
  sockets = attachWebSocketServer(server);
  // Attach the rule engine to the telemetry bus before the first reading arrives.
  ruleExecutor.start();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.port, '0.0.0.0', resolve);
  });
  console.info(`NexusFlow API listening on port ${env.port}; WebSocket: /ws`);
} catch (error) {
  console.error('Startup failed:', error.message);
  await shutdown('startup failure');
  process.exitCode = 1;
}
```
### `server/src/config/env.js`

```js
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/nexusflow'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  TELEMETRY_RETENTION_SECONDS: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.coerce.number().int().positive().optional(),
  ),
  // Per-node activity taps (Day 4 glowing wires). On by default; set to false in
  // production runs that do not need instrumentation.
  NODE_ACTIVITY_ENABLED: z.union([z.boolean(), z.string()]).optional()
    .transform((value) => (value === undefined
      ? true
      : !['false', '0', 'no', 'off'].includes(String(value).toLowerCase()))),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = {
  nodeEnv: result.data.NODE_ENV,
  port: result.data.PORT,
  mongoUri: result.data.MONGODB_URI,
  clientOrigins: result.data.CLIENT_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean),
  telemetryRetentionSeconds: result.data.TELEMETRY_RETENTION_SECONDS,
  nodeActivityEnabled: result.data.NODE_ACTIVITY_ENABLED,
};
```
### `server/src/validation/telemetry.js`

```js
import { z } from 'zod';

const boundedText = z.string().trim().min(1).max(120);
const timestamp = z.string().datetime({ offset: true }).transform((value) => new Date(value));
const knownFields = new Set(['timestamp', 'metadata', 'value', 'unit']);

export const readingSchema = z.object({
  // A missing timestamp is captured at ingestion, not at schema construction.
  timestamp: timestamp.optional().transform((value) => value ?? new Date()),
  metadata: z.object({
    deviceId: boundedText,
    sensorType: boundedText,
    location: boundedText,
  }).strict(),
  value: z.number().finite(),
  unit: boundedText,
}).catchall(z.number().finite()).superRefine((reading, context) => {
  const extras = Object.keys(reading).filter((key) => !knownFields.has(key));
  if (extras.length > 32) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'At most 32 extra numeric measurements are allowed.' });
  }
  for (const key of extras) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Extra measurement names must start with a letter and contain only letters, digits, or underscores.' });
    }
  }
});

export const batchSchema = z.array(readingSchema).min(1).max(1000);

export const telemetryQuerySchema = z.object({
  deviceId: boundedText.optional(),
  from: timestamp.optional(),
  to: timestamp.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
}).strict().refine((query) => !query.from || !query.to || query.from <= query.to, {
  message: 'from must be earlier than or equal to to.',
  path: ['from'],
});

const WINDOW_UNITS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * GET /api/telemetry/stats?deviceId=&window=5m
 * `window` accepts a suffix of s/m/h/d (default 5m) and is converted to milliseconds.
 */
export const statsQuerySchema = z.object({
  deviceId: boundedText.optional(),
  window: z.string().trim().regex(/^\d{1,5}[smhd]$/, 'window must look like 30s, 5m, 2h or 1d.').default('5m'),
}).strict().transform((query) => {
  const amount = Number.parseInt(query.window, 10);
  const unit = query.window.slice(-1);
  return { deviceId: query.deviceId, windowMs: amount * WINDOW_UNITS[unit] };
});
```
### `server/scripts/simulator.js`

```js
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const { values } = parseArgs({ options: {
  devices: { type: 'string', default: process.env.SIMULATOR_DEVICES ?? '10' },
  interval: { type: 'string', default: process.env.SIMULATOR_INTERVAL_MS ?? '1000' },
  url: { type: 'string', default: process.env.SIMULATOR_URL ?? 'http://localhost:5000' },
  transport: { type: 'string', default: process.env.SIMULATOR_TRANSPORT ?? 'http' }, // http | ws | both
  'ws-url': { type: 'string', default: process.env.SIMULATOR_WS_URL ?? '' },
  spikes: { type: 'string', default: process.env.SIMULATOR_SPIKES ?? '0.04' }, // P(temperature anomaly) per reading
} });
const devices = Number(values.devices);
const interval = Number(values.interval);
const spikeRate = Number(values.spikes);
const transport = String(values.transport).toLowerCase();
if (!Number.isInteger(devices) || devices < 1 || devices > 10_000 || !Number.isInteger(interval) || interval < 50) {
  console.error('Use --devices 1..10000 and --interval (milliseconds) >= 50.');
  process.exit(1);
}
if (!['http', 'ws', 'both'].includes(transport)) {
  console.error('Use --transport http | ws | both.');
  process.exit(1);
}
if (!Number.isFinite(spikeRate) || spikeRate < 0 || spikeRate > 1) {
  console.error('Use --spikes between 0 and 1 (probability of an anomaly spike).');
  process.exit(1);
}
const baseUrl = new URL(values.url);
if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('The URL must use HTTP or HTTPS.');
const endpoint = new URL('/api/telemetry/batch', baseUrl);
const wsEndpoint = values['ws-url']
  ? new URL(values['ws-url'])
  : new URL(`/ws`, `${baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${baseUrl.host}`);
const useHttp = transport === 'http' || transport === 'both';
const useWs = transport === 'ws' || transport === 'both';
let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });

/* ------------------------------------------------------------ WebSocket sender */
let socket = null;
let socketReady = false;
let wsAccepted = 0;
let wsErrors = 0;
let reconnectDelay = 500;

function connectWs() {
  if (!useWs || !running) return;
  socket = new WebSocket(wsEndpoint);
  socket.on('open', () => {
    socketReady = true;
    reconnectDelay = 500;
    console.log(`WebSocket connected -> ${wsEndpoint}`);
  });
  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'ack') wsAccepted += message.data?.accepted ?? 1;
      else if (message.type === 'error') { wsErrors += 1; console.error(`WS error: ${message.data?.message}`); }
    } catch { /* ignore malformed frames */ }
  });
  socket.on('error', (error) => console.error(`WebSocket error: ${error.message}`));
  socket.on('close', () => {
    socketReady = false;
    if (!running) return;
    setTimeout(connectWs, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
  });
}

function sendWs(readings) {
  if (!socketReady || socket.readyState !== WebSocket.OPEN) return 0;
  let sent = 0;
  for (const reading of readings) {
    socket.send(JSON.stringify({ type: 'telemetry', data: reading }));
    sent += 1;
  }
  return sent;
}

/* ------------------------------------------------------------------- main loop */
const roundedValue = (value) => Math.round(value * 100) / 100;
console.log(`Simulating ${devices} devices (3 readings each) every ${interval} ms (spike chance ${spikeRate})`);
console.log(`  HTTP: ${useHttp ? endpoint : 'disabled'}   WS: ${useWs ? wsEndpoint : 'disabled'}`);
console.log('Press Ctrl+C to stop.');
if (useWs) connectWs();

while (running) {
  const start = Date.now();
  const timestamp = new Date().toISOString();
  const readings = [];
  for (let i = 1; i <= devices; i += 1) {
    const deviceId = `turbine-${String(i).padStart(3, '0')}`;
    const location = `Site ${Math.ceil(i / 10)}`;
    const anomaly = Math.random() < spikeRate;
    for (const [sensorType, value, unit] of [
      ['temperature', anomaly ? 85 + Math.random() * 20 : 45 + Math.random() * 25, '°C'],
      ['vibration', 0.5 + Math.random() * 4, 'mm/s'],
      ['pressure', 2 + Math.random() * 6, 'bar'],
    ]) {
      readings.push({ timestamp, metadata: { deviceId, sensorType, location }, value: roundedValue(value), unit });
    }
  }

  let accepted = 0;
  if (useHttp) {
    try {
      for (let i = 0; i < readings.length; i += 1000) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(readings.slice(i, i + 1000)),
          signal: AbortSignal.timeout(15_000),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error?.message ?? 'request failed'}`);
        accepted += body.accepted;
      }
    } catch (error) {
      console.error(`${timestamp}  accepted ${accepted} readings before error: ${error.message}`);
    }
  }
  if (useWs) sendWs(readings);

  const parts = [];
  if (useHttp) parts.push(`HTTP accepted ${accepted}`);
  if (useWs) parts.push(`WS sent ${readings.length} (acked ${wsAccepted}${wsErrors ? `, ${wsErrors} errors` : ''})`);
  console.log(`${timestamp}  ${parts.join('  |  ')}`);
  if (running) await sleep(Math.max(0, interval - (Date.now() - start)));
}
if (socket) socket.close();
console.log('Simulator stopped.');
```
### `server/package.json`

```json
{
  "name": "nexusflow-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js",
    "simulate": "node scripts/simulator.js",
    "engine-check": "node scripts/engineCheck.js",
    "benchmark": "node scripts/benchmark.js",
    "test": "vitest run && node --test test/validation.test.js test/integration.test.js test/compilerRoutes.test.js test/websocketChannels.test.js",
    "test:compiler": "vitest run",
    "test:http": "node --test test/validation.test.js test/integration.test.js test/compilerRoutes.test.js test/websocketChannels.test.js"
  },
  "dependencies": {
    "axios": "^1.21.1",
    "cors": "^2.8.5",
    "dotenv": "^16.6.1",
    "express": "^4.22.1",
    "helmet": "^8.1.0",
    "mongoose": "^8.24.8",
    "morgan": "^1.10.1",
    "rxjs": "^7.8.2",
    "ws": "^8.22.2",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "nodemon": "^3.1.11",
    "supertest": "^7.2.2",
    "vitest": "^5.1.0"
  }
}
```
### `server/.env.example`

```bash
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/nexusflow
# Comma-separated browser origins permitted for direct cross-origin requests.
# The Vite development proxy is same-origin and does not require CORS.
CLIENT_ORIGIN=http://localhost:5173
# Optional positive integer. Applies when the telemetry collection is first created.
TELEMETRY_RETENTION_SECONDS=
# Day 3: per-node activity taps feeding the "node_activity" channel (Day 4 glowing wires).
# true (default) | false — set false to keep production pipelines instrumentation-free.
NODE_ACTIVITY_ENABLED=true
```
### `client/src/App.jsx`

```js
import { ReactFlowProvider } from '@xyflow/react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage.jsx';
import EditorPage from './pages/EditorPage.jsx';
import { WebSocketProvider } from './ws/WebSocketProvider.jsx';

/**
 * App shell: one shared WebSocket (with auto-reconnect) for every page,
 * React Router for Editor | Dashboard navigation.
 */
export default function App() {
  return (
    <WebSocketProvider>
      <BrowserRouter>
        <ReactFlowProvider>
          <Routes>
            <Route path="/" element={<EditorPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ReactFlowProvider>
      </BrowserRouter>
    </WebSocketProvider>
  );
}
```
### `client/src/pages/EditorPage.jsx`

```js
import { useCallback, useEffect, useRef, useState } from 'react';
import { addEdge, useEdgesState, useNodesState, useReactFlow } from '@xyflow/react';
import { AlertTriangle, CheckCircle2, ChevronRight, CircleHelp, PencilLine, X } from 'lucide-react';
import FlowCanvas from '../components/canvas/FlowCanvas.jsx';
import NodePalette from '../components/canvas/NodePalette.jsx';
import { validateGraph } from '../components/canvas/graphRules.js';
import { getDefinition, initialEdges, initialNodes, makeNode } from '../components/nodes/definitions.js';
import FlowInspector from '../components/FlowInspector.jsx';
import GraphPicker from '../components/GraphPicker.jsx';
import Navbar from '../components/layout/Navbar.jsx';
import ValidationPanel from '../components/ValidationPanel.jsx';
import { errorMessage, graphApi, telemetryApi } from '../services/api.js';
import { copyText, downloadJson, graphFilename, serializeGraph, toJsonString } from '../services/graphSerializer.js';
import { useTelemetry } from '../services/useTelemetry.js';
import { useChannel } from '../ws/useChannel.js';

/** Dimensions of a node card, used to centre a dropped node under the cursor. */
const NODE_OFFSET = { x: 130, y: 46 };

export default function EditorPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [name, setName] = useState('Turbine overheat rule');
  const [health, setHealth] = useState('checking');
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [graphs, setGraphs] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [loadingId, setLoadingId] = useState('');
  const [notice, setNotice] = useState(null);
  // ---------------------------------------------------------- live activation
  const [graphId, setGraphId] = useState('');
  const [activation, setActivation] = useState({ status: 'inactive', message: '' });
  const [activating, setActivating] = useState(false);
  const [testing, setTesting] = useState(false);
  const canvasRef = useRef(null);
  const nameRef = useRef(null);
  const exportRef = useRef('');
  const flow = useReactFlow();
  const { socketStatus, readings } = useTelemetry();
  const selectedNode = nodes.find((node) => node.selected);

  // Live pipeline status pushed by the server (`graph_status` on activate/deactivate/error).
  useChannel(graphId ? `graph:${graphId}` : null, useCallback((message) => {
    if (message.type !== 'graph_status' || !message.data) return;
    const { status } = message.data;
    setActivation((current) => {
      if (status === 'active') return { status: 'active', message: 'Pipeline is evaluating live telemetry.' };
      if (status === 'error') return { status: 'error', message: 'Activation failed.' };
      if (current.status !== 'inactive') return { status: 'inactive', message: 'Pipeline deactivated.' };
      return current;
    });
  }, []));

  // ------------------------------------------------------------- backend health
  useEffect(() => {
    let mounted = true;
    async function check() {
      try { await graphApi.health(); if (mounted) setHealth('online'); }
      catch { if (mounted) setHealth('offline'); }
    }
    check();
    const timer = setInterval(check, 15_000);
    window.addEventListener('focus', check);
    return () => { mounted = false; clearInterval(timer); window.removeEventListener('focus', check); };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), notice.action ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // ------------------------------------------------------------------ graph ops
  const onConnect = useCallback((connection) => {
    setEdges((current) => addEdge({ ...connection, type: 'smoothstep' }, current));
  }, [setEdges]);

  function addNode(type, position, config) {
    if (!getDefinition(type)) return;
    setNodes((current) => [...current, makeNode(type, position, undefined, config)]);
  }

  /**
   * Palette drag payload: a JSON string `{ type, config }`.
   * A bare type string is still accepted (graphs dragged before Day 2 used that format).
   */
  function parseDragPayload(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.type) return { type: parsed.type, config: parsed.config };
    } catch {
      // Not JSON: treat the payload as a plain node type.
    }
    return { type: raw, config: undefined };
  }

  function handleDrop(event) {
    event.preventDefault();
    const { type, config } = parseDragPayload(event.dataTransfer.getData('application/nexusflow-node')) ?? {};
    if (!type || !getDefinition(type)) return;
    const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addNode(type, { x: position.x - NODE_OFFSET.x, y: position.y - NODE_OFFSET.y }, config);
  }

  function handlePaletteClick(type, config) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const position = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    addNode(type, { x: position.x - NODE_OFFSET.x, y: position.y - NODE_OFFSET.y }, config);
  }

  function removeNode(id) {
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
  }

  function focusNode(nodeId) {
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })));
    flow.fitView({ nodes: [{ id: nodeId }], duration: 400, maxZoom: 1.2, padding: 0.6 });
  }

  // ---------------------------------------------------------------- save / load
  async function saveGraph() {
    if (!name.trim()) {
      setNotice({ type: 'error', message: 'Give your graph a name before saving.' });
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const { viewport } = flow.toObject();
      const payload = serializeGraph(name, nodes, edges, viewport);
      const created = await graphApi.create(payload);
      setGraphId(created.data.data._id);
      setActivation({ status: 'inactive', message: '' });
      setName(payload.name);
      setNotice({ type: 'success', message: `Graph saved with ${payload.nodes.length} nodes and ${payload.edges.length} edges. Ready to Activate.` });
    } catch (error) {
      setNotice({ type: 'error', message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  async function fetchGraphs() {
    setListLoading(true);
    setListError('');
    try { setGraphs((await graphApi.list()).data.data); }
    catch (error) { setListError(errorMessage(error)); }
    finally { setListLoading(false); }
  }

  const openPicker = () => { setPickerOpen(true); fetchGraphs(); };
  const closePicker = useCallback(() => setPickerOpen(false), []);

  async function loadGraph(id) {
    setLoadingId(id);
    try {
      const graph = (await graphApi.get(id)).data.data;
      setNodes(graph.nodes ?? []);
      // Saved edges carry no `type`; re-apply the canvas default so the round trip is seamless.
      setEdges((graph.edges ?? []).map((edge) => ({ type: 'smoothstep', ...edge })));
      setName(graph.name ?? 'Untitled graph');
      setGraphId(id);
      setActivation({ status: 'inactive', message: '' });
      // A loaded graph may already be running — ask the engine so the badge is correct.
      graphApi.active()
        .then((response) => {
          if (response.data.data.some((entry) => entry.graphId === id)) {
            setActivation({ status: 'active', message: 'Pipeline is evaluating live telemetry.' });
          }
        })
        .catch(() => { /* engine status is best-effort */ });
      setValidation(null);
      setPickerOpen(false);
      requestAnimationFrame(() => {
        if (graph.viewport) flow.setViewport(graph.viewport, { duration: 300 });
        else flow.fitView({ padding: 0.22, maxZoom: 1, duration: 300 });
      });
      setNotice({ type: 'success', message: 'Graph loaded onto your canvas.' });
    } catch (error) {
      setListError(errorMessage(error));
    } finally {
      setLoadingId('');
    }
  }

  // ------------------------------------------------------------- validate / export
  async function runValidation() {
    setValidating(true);
    const local = validateGraph(nodes, edges);
    setValidation({ result: local, source: 'local' });
    try {
      const response = await graphApi.validate(serializeGraph(name, nodes, edges));
      setValidation({
        result: { errors: response.data.errors, warnings: response.data.warnings },
        source: 'backend',
      });
    } catch (error) {
      // Keep the local verdict; the backend is only reachable when MongoDB is up.
      if (error.response?.status === 400 && Array.isArray(error.response.data?.error?.details)) {
        setValidation({
          result: { errors: error.response.data.error.details, warnings: error.response.data.error.warnings ?? [] },
          source: 'backend',
        });
      }
    } finally {
      setValidating(false);
    }
  }

  function exportJson() {
    const { viewport } = flow.toObject();
    const payload = serializeGraph(name, nodes, edges, viewport);
    exportRef.current = toJsonString(payload);
    downloadJson(payload, graphFilename(payload.name));
    setNotice({
      type: 'success',
      message: `Exported ${payload.nodes.length} nodes and ${payload.edges.length} edges as JSON.`,
      action: {
        label: 'Copy JSON',
        onClick: async () => {
          const copied = await copyText(exportRef.current);
          setNotice({ type: copied ? 'success' : 'error', message: copied ? 'Graph JSON copied to your clipboard.' : 'Could not access the clipboard.' });
        },
      },
    });
  }

  const showInvalidConnection = useCallback((reason) => {
    setNotice({ type: 'error', message: reason ?? 'That connection is not allowed.' });
  }, []);

  // ------------------------------------------------------- activate / deactivate
  async function activateGraph() {
    if (!graphId) {
      setNotice({ type: 'error', message: 'Save the graph first — activation runs the saved version.' });
      return;
    }
    setActivating(true);
    try {
      const response = await graphApi.compile(graphId);
      const data = response.data.data;
      setActivation({ status: 'active', message: `Evaluating ${data.sources?.length ?? 0} source(s) live.` });
      setNotice({ type: 'success', message: `Pipeline active — ${data.nodeCount} nodes, ${data.subscriptions} subscription(s). Watch the Dashboard.` });
    } catch (error) {
      const details = error.response?.data?.error?.details;
      setActivation({ status: 'error', message: errorMessage(error) });
      setNotice({
        type: 'error',
        message: details?.length ? `Activation failed: ${details[0].message}` : errorMessage(error),
      });
    } finally {
      setActivating(false);
    }
  }

  async function deactivateGraph() {
    if (!graphId) return;
    try {
      await graphApi.deactivate(graphId);
      setActivation({ status: 'inactive', message: 'Pipeline deactivated.' });
      setNotice({ type: 'success', message: 'Pipeline deactivated — rule evaluation stopped.' });
    } catch (error) {
      // 404 means it was not running anyway; treat as inactive.
      if (error.response?.status === 404) setActivation({ status: 'inactive', message: 'Pipeline was not active.' });
      else setNotice({ type: 'error', message: errorMessage(error) });
    }
  }

  /**
   * Push sample readings (a few normal values + overheat spikes) through the real
   * ingestion API so the user sees the rule fire from the UI without the simulator.
   */
  async function sendTestData() {
    const source = nodes.find((node) => node.type === 'sensor' || node.data?.category === 'source');
    const config = source?.data?.config ?? {};
    const deviceId = config.deviceId || 'turbine-001';
    const sensorType = config.sensorType || 'temperature';
    const location = 'Test bench';
    const now = Date.now();
    const values = [50, 52, 48, 96, 51, 97]; // spike above the default threshold (>80)
    const readings = values.map((value, index) => ({
      timestamp: new Date(now - (values.length - index) * 250).toISOString(),
      metadata: { deviceId, sensorType, location },
      value,
      unit: '°C',
    }));

    setTesting(true);
    try {
      const response = await telemetryApi.ingestBatch(readings);
      setNotice({
        type: 'success',
        message: `Sent ${response.data.accepted} readings for ${deviceId} · ${sensorType} (2 overheat spikes). Check the Dashboard${activation.status === 'active' ? ' — the rule should fire' : ' after activating this graph'}.`,
      });
    } catch (error) {
      setNotice({ type: 'error', message: errorMessage(error) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="app-shell">
      <Navbar
        health={health}
        onSave={saveGraph}
        onLoad={openPicker}
        onValidate={runValidation}
        onExport={exportJson}
        saving={saving}
        validating={validating}
        activation={activation}
        onActivate={activateGraph}
        onDeactivate={deactivateGraph}
        onSendTestData={sendTestData}
        activating={activating}
        testing={testing}
      />

      <div className="editor-body">
        <NodePalette onAddNode={handlePaletteClick} />
        <main className="work-area">
          <div className="work-header">
            <div className="work-title">
              <div className="work-breadcrumb"><span>WORKSPACE</span><ChevronRight size={12} /><span>FLOW EDITOR</span></div>
              <div className="name-row">
                <input ref={nameRef} aria-label="Graph name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
                <PencilLine size={15} />
                <span className="draft-badge"><i /> DRAFT</span>
              </div>
              <p>Bring your data and ideas together, one node at a time.</p>
            </div>
            <div className="work-meta">
              <div><strong>{String(nodes.length).padStart(2, '0')}</strong><span>NODES</span></div>
              <i />
              <div><strong>{String(edges.length).padStart(2, '0')}</strong><span>CONNECTIONS</span></div>
            </div>
          </div>

          {validation && (
            <ValidationPanel
              result={validation.result}
              source={validation.source}
              onClose={() => setValidation(null)}
              onSelectNode={focusNode}
            />
          )}

          <FlowCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={handleDrop}
            onInvalidConnection={showInvalidConnection}
            canvasRef={canvasRef}
          />

          <div className="workspace-footer">
            <span><i /> CANVAS MODE <b> / </b> FLOW EDITOR</span>
            <span><CircleHelp size={14} /> Select a node or edge and press Delete to remove it.</span>
            <span>MADE TO FLOW <span className="footer-star">✳</span></span>
          </div>
        </main>
        <FlowInspector nodes={nodes} edges={edges} selectedNode={selectedNode} onRemoveNode={removeNode} socketStatus={socketStatus} readings={readings} />
      </div>

      {pickerOpen && (
        <GraphPicker graphs={graphs} loading={listLoading} error={listError} busyId={loadingId} onSelect={loadGraph} onRetry={fetchGraphs} onClose={closePicker} />
      )}

      {notice && (
        <div className={`toast ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
          {notice.type === 'error' ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
          <span>{notice.message}</span>
          {notice.action && <button className="toast-action" onClick={notice.action.onClick}>{notice.action.label}</button>}
          <button onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}
    </div>
  );
}
```
### `client/src/components/layout/Navbar.jsx`

```js
import { ChevronRight, Download, FolderOpen, LoaderCircle, Play, Save, Send, ShieldCheck, Square } from 'lucide-react';
import NavLinks from './NavLinks.jsx';

/**
 * Top toolbar: health indicator, Editor | Dashboard nav, activation controls
 * (Activate / Deactivate / Send Test Data + live status badge) and
 * Load / Validate / Export / Save.
 *
 * The activation props are optional so pages that do not manage a pipeline can omit them.
 */
export default function Navbar({
  health,
  onSave,
  onLoad,
  onValidate,
  onExport,
  saving,
  validating,
  activation,
  onActivate,
  onDeactivate,
  onSendTestData,
  activating = false,
  testing = false,
}) {
  const healthText = health === 'online' ? 'Backend connected' : health === 'offline' ? 'Backend offline' : 'Checking backend';
  const status = activation?.status ?? 'inactive';
  const statusLabel = status === 'active' ? 'ACTIVE' : status === 'error' ? 'ERROR' : 'INACTIVE';

  return (
    <header className="navbar">
      <div className="brand select-none">
        <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
        <div className="brand-copy"><strong>NexusFlow<span>.</span></strong><small>VISUAL IOT WORKSPACE</small></div>
      </div>
      <div className="nav-breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>Flow editor</strong></div>
      <NavLinks />
      <div className="nav-actions">
        <div className={`health ${health}`} role="status"><span className="health-dot" />{healthText}</div>
        <div className="nav-divider" />

        {onActivate && (
          <>
            <span className={`engine-badge engine-badge-${status}`} title={activation?.message ?? 'Pipeline status'}>
              <i />{statusLabel}
            </span>
            <button className="button button-ghost" onClick={onActivate} disabled={activating || status === 'active'}>
              {activating ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
              <span>{activating ? 'Activating…' : 'Activate'}</span>
            </button>
            <button className="button button-ghost" onClick={onDeactivate} disabled={status !== 'active'}>
              <Square size={16} /><span>Deactivate</span>
            </button>
            <button className="button button-ghost" onClick={onSendTestData} disabled={testing}>
              {testing ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
              <span>{testing ? 'Sending…' : 'Send test data'}</span>
            </button>
            <div className="nav-divider" />
          </>
        )}

        <button className="button button-ghost" onClick={onLoad}><FolderOpen size={16} /><span>Load graph</span></button>
        <button className="button button-ghost" onClick={onValidate} disabled={validating}>
          {validating ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}
          <span>{validating ? 'Validating...' : 'Validate graph'}</span>
        </button>
        <button className="button button-ghost" onClick={onExport}><Download size={16} /><span>Export JSON</span></button>
        <button className="button button-primary" onClick={onSave} disabled={saving}>
          {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}<span>{saving ? 'Saving...' : 'Save graph'}</span>
        </button>
      </div>
    </header>
  );
}
```
### `client/src/components/nodes/definitions.js`

```js
import { Activity, BellRing, ChartNoAxesCombined, Radio, Scale, ScrollText, Webhook } from 'lucide-react';

/**
 * Single source of truth for every node type the editor can place on the canvas.
 *
 * `type` matches the registry key used by the backend compiler, so the palette, the
 * canvas and the stream compiler always agree on what a node is.
 *
 * Node data shape (this is what gets persisted):
 *   { id, type, position, data: { kind, label, category, description, config: { ... } } }
 */

export const CATEGORIES = {
  source: { id: 'source', label: 'Data source', color: '#2f6fb3' },
  math: { id: 'math', label: 'Math operation', color: '#b57a1a' },
  action: { id: 'action', label: 'Action trigger', color: '#b9523a' },
};

/** @type {Record<string, any>} */
export const NODE_TYPES = {
  sensor: {
    type: 'sensor',
    category: 'source',
    label: 'Sensor',
    description: 'Emits telemetry for one device + sensor type',
    tag: 'SENSOR INPUT',
    icon: Radio,
    hasInput: false,
    hasOutput: true,
    defaultConfig: { deviceId: 'turbine-001', sensorType: 'temperature' },
    fields: [
      { key: 'deviceId', label: 'Device ID', type: 'text', placeholder: 'turbine-001' },
      { key: 'sensorType', label: 'Sensor type', type: 'text', placeholder: 'temperature' },
    ],
  },
  movingAverage: {
    type: 'movingAverage',
    category: 'math',
    label: 'Moving Average',
    description: 'Smooths readings over a sliding window',
    tag: 'TRANSFORM',
    icon: ChartNoAxesCombined,
    hasInput: true,
    hasOutput: true,
    defaultConfig: { windowSize: 5 },
    fields: [
      { key: 'windowSize', label: 'Window size', type: 'number', min: 1, max: 1000, step: 1 },
    ],
  },
  threshold: {
    type: 'threshold',
    category: 'math',
    label: 'Threshold',
    description: 'Passes readings that match a comparison',
    tag: 'CONDITION',
    icon: Activity,
    hasInput: true,
    hasOutput: true,
    defaultConfig: { operator: '>', value: 80 },
    fields: [
      { key: 'operator', label: 'Operator', type: 'select', options: ['>', '>=', '<', '<=', '==', '!='] },
      { key: 'value', label: 'Value', type: 'number', step: 'any' },
    ],
  },
  scale: {
    type: 'scale',
    category: 'math',
    label: 'Scale',
    description: 'Applies value * factor + offset',
    tag: 'TRANSFORM',
    icon: Scale,
    hasInput: true,
    hasOutput: true,
    defaultConfig: { factor: 1, offset: 0 },
    fields: [
      { key: 'factor', label: 'Factor', type: 'number', step: 'any' },
      { key: 'offset', label: 'Offset', type: 'number', step: 'any' },
    ],
  },
  smsAlert: {
    type: 'smsAlert',
    category: 'action',
    label: 'SMS Alert',
    description: 'Sends a mock SMS and stores an alert',
    tag: 'NOTIFICATION',
    icon: BellRing,
    hasInput: true,
    hasOutput: false,
    defaultConfig: { phone: '+911234567890', messageTemplate: 'ALERT ${deviceId} ${sensorType} = ${value}${unit}', cooldownSeconds: 0 },
    fields: [
      { key: 'phone', label: 'Phone', type: 'text', placeholder: '+911234567890' },
      { key: 'messageTemplate', label: 'Message', type: 'text', placeholder: 'ALERT ${deviceId} = ${value}${unit}' },
      { key: 'cooldownSeconds', label: 'Cooldown (s)', type: 'number', min: 0, max: 86400, step: 1 },
    ],
  },
  webhook: {
    type: 'webhook',
    category: 'action',
    label: 'Webhook',
    description: 'POSTs the reading to an HTTP endpoint',
    tag: 'HTTP REQUEST',
    icon: Webhook,
    hasInput: true,
    hasOutput: false,
    defaultConfig: { url: 'https://example.com/hook', method: 'POST', cooldownSeconds: 0 },
    fields: [
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com/hook' },
      { key: 'method', label: 'Method', type: 'select', options: ['POST', 'PUT', 'PATCH'] },
      { key: 'cooldownSeconds', label: 'Cooldown (s)', type: 'number', min: 0, max: 86400, step: 1 },
    ],
  },
  log: {
    type: 'log',
    category: 'action',
    label: 'Log',
    description: 'Prints the reading to the server console',
    tag: 'DEBUG OUTPUT',
    icon: ScrollText,
    hasInput: true,
    hasOutput: false,
    defaultConfig: { label: 'pipeline', template: '${deviceId} ${sensorType} = ${value}${unit}', cooldownSeconds: 0 },
    fields: [
      { key: 'label', label: 'Prefix', type: 'text', placeholder: 'pipeline' },
      { key: 'template', label: 'Template', type: 'text', placeholder: '${deviceId} = ${value}${unit}' },
      { key: 'cooldownSeconds', label: 'Cooldown (s)', type: 'number', min: 0, max: 86400, step: 1 },
    ],
  },
};

/**
 * Palette groups. Several entries can share the same `type` with different starting
 * config (Turbine Sensor and Temperature Sensor are both `sensor` nodes).
 */
export const PALETTE_GROUPS = [
  {
    id: 'source',
    label: 'Data sources',
    items: [
      { type: 'sensor', label: 'Turbine Sensor', description: 'Turbine temperature stream', config: { deviceId: 'turbine-001', sensorType: 'temperature' } },
      { type: 'sensor', label: 'Temperature Sensor', description: 'Ambient temperature stream', config: { deviceId: 'temp-001', sensorType: 'temperature' } },
      { type: 'sensor', label: 'Vibration Sensor', description: 'Turbine vibration stream', config: { deviceId: 'turbine-001', sensorType: 'vibration' } },
    ],
  },
  {
    id: 'math',
    label: 'Math operations',
    items: [
      { type: 'movingAverage', label: 'Moving Average', description: 'Smooth over N readings', config: { windowSize: 5 } },
      { type: 'threshold', label: 'Threshold', description: 'Filter by comparison', config: { operator: '>', value: 80 } },
      { type: 'scale', label: 'Scale', description: 'Convert or calibrate values', config: { factor: 1, offset: 0 } },
    ],
  },
  {
    id: 'action',
    label: 'Action triggers',
    items: [
      { type: 'smsAlert', label: 'SMS Alert', description: 'Notify an operator', config: { phone: '+911234567890' } },
      { type: 'webhook', label: 'Webhook', description: 'Call an HTTP endpoint', config: { url: 'https://example.com/hook', method: 'POST' } },
      { type: 'log', label: 'Log', description: 'Debug the pipeline', config: { label: 'pipeline' } },
    ],
  },
];

export const getDefinition = (type) => NODE_TYPES[type] ?? null;
export const NODE_TYPE_KEYS = Object.keys(NODE_TYPES);

let counter = 0;
export function nextNodeId(type) {
  counter += 1;
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 6) ?? `${Date.now().toString(36)}${counter}`;
  return `${type}-${suffix}`;
}

/**
 * Build a React Flow node with a fully populated `data` object.
 *
 * @param {string} type registry key, e.g. "movingAverage"
 * @param {{x: number, y: number}} position
 * @param {string} [id]
 * @param {object} [config] overrides for the node defaults
 */
export function makeNode(type, position, id = nextNodeId(type), config = {}) {
  const definition = getDefinition(type);
  if (!definition) throw new Error(`Unknown node type "${type}"`);
  return {
    id,
    type,
    position,
    data: {
      kind: type,
      label: definition.label,
      category: definition.category,
      description: definition.description,
      config: { ...definition.defaultConfig, ...config },
    },
  };
}

/** Day-2 seed graph: Turbine Sensor -> Moving Average -> Threshold -> SMS Alert. */
export const initialNodes = [
  makeNode('sensor', { x: 0, y: 96 }, 'sensor-turbine', { deviceId: 'turbine-001', sensorType: 'temperature' }),
  makeNode('movingAverage', { x: 320, y: 96 }, 'average-1', { windowSize: 5 }),
  makeNode('threshold', { x: 640, y: 96 }, 'threshold-1', { operator: '>', value: 80 }),
  makeNode('smsAlert', { x: 960, y: 96 }, 'sms-1', { phone: '+911234567890' }),
];

export const initialEdges = [
  { id: 'edge-sensor-average', source: 'sensor-turbine', target: 'average-1', type: 'smoothstep' },
  { id: 'edge-average-threshold', source: 'average-1', target: 'threshold-1', type: 'smoothstep' },
  { id: 'edge-threshold-sms', source: 'threshold-1', target: 'sms-1', type: 'smoothstep' },
];
```
### `client/src/services/api.js`

```js
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 8000,
});

export const graphApi = {
  health: () => api.get('/health'),
  create: (graph) => api.post('/graphs', graph),
  list: () => api.get('/graphs'),
  get: (id) => api.get(`/graphs/${encodeURIComponent(id)}`),
  /** Validate raw graph JSON server-side without saving it. */
  validate: (graph) => api.post('/graphs/validate', graph),
  /** Compile + activate a saved graph (returns the pipeline summary). */
  compile: (id) => api.post(`/graphs/${encodeURIComponent(id)}/compile`),
  deactivate: (id) => api.post(`/graphs/${encodeURIComponent(id)}/deactivate`),
  active: () => api.get('/graphs/active'),
  /** Dry run: push sample values through the compiled pipeline. */
  test: (id, values) => api.post(`/graphs/${encodeURIComponent(id)}/test`, { values }),
};

export const telemetryApi = {
  /** Recent alerts: `?graphId=&deviceId=&limit=` */
  alerts: (params = {}) => api.get('/alerts', { params }),
  /** Per-minute buckets: `?deviceId=&window=5m` (avg/min/max/count). */
  stats: (params = {}) => api.get('/telemetry/stats', { params }),
  /** Ingest readings (the "Send Test Data" button and manual curl tests). */
  ingestBatch: (readings) => api.post('/telemetry/batch', readings),
  readings: (params = {}) => api.get('/telemetry', { params }),
};

export const engineApi = {
  /** { activeGraphs, messagesProcessed, messagesPerSecond, alertsFired } */
  status: () => api.get('/engine/status'),
};

export function errorMessage(error) {
  return error.response?.data?.error?.message
    || (error.code === 'ECONNABORTED' ? 'The request timed out.' : 'Cannot reach the backend. Check that the server and MongoDB are running.');
}

/** Backend validation issues, when the API returned a 400 with details. */
export function errorDetails(error) {
  return Array.isArray(error.response?.data?.error?.details) ? error.response.data.error.details : [];
}
```
### `client/src/services/useTelemetry.js`

```js
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocket } from '../ws/WebSocketProvider.jsx';
import { useChannel } from '../ws/useChannel.js';

/**
 * Same-origin live telemetry for the editor inspector.
 *
 * Day 3: the server no longer blanket-broadcasts — this hook now subscribes to the
 * catch-all `telemetry` channel through the shared WebSocket provider, so it shares
 * one socket (and one reconnect loop) with the rest of the app.
 *
 * Incoming messages are buffered in a ref and flushed into state at most every
 * 500 ms (same bounded-update behaviour as Day 1), keeping the editor render path
 * cheap even under a hot device stream.
 */
export function useTelemetry() {
  const ws = useWebSocket();
  const [socketStatus, setSocketStatus] = useState('connecting');
  const [readings, setReadings] = useState([]);
  const pendingRef = useRef([]);
  const flushTimerRef = useRef(null);

  useEffect(() => {
    setSocketStatus(ws?.status ?? 'connecting');
  }, [ws?.status]);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    const pending = pendingRef.current;
    if (pending.length === 0) return;
    pendingRef.current = [];
    // Newest first, bounded to the 3 rows the inspector renders.
    setReadings((current) => [...pending.reverse(), ...current].slice(0, 3));
  }, []);

  const onTelemetry = useCallback((message) => {
    const received = Array.isArray(message.data) ? message.data : [message.data];
    for (const reading of received) {
      if (reading && typeof reading === 'object') pendingRef.current.push(reading);
    }
    if (pendingRef.current.length > 24) pendingRef.current = pendingRef.current.slice(-12);
    if (flushTimerRef.current === null) flushTimerRef.current = setTimeout(flush, 500);
  }, [flush]);
  useChannel('telemetry', onTelemetry);

  useEffect(() => () => clearTimeout(flushTimerRef.current), []);

  return { socketStatus, readings };
}
```
### `client/src/index.css` (Day 3 section — appended at the end of the file)

```css
/* ===========================================================================
   Day 3 — live execution: navigation, activation controls, live dashboard
   =========================================================================== */

@layer components {
  /* ---------------- Route navigation (Editor | Dashboard) ---------------- */
  .route-nav {
    display: inline-flex;
    gap: 4px;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: #fff;
  }

  .route-nav a {
    padding: 5px 14px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-soft);
    text-decoration: none;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .route-nav a:hover {
    color: var(--ink);
  }

  .route-nav a.active {
    background: var(--teal);
    color: #fff;
  }

  /* ---------------- Activation status badge ---------------- */
  .engine-badge {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 11px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: #fff;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
  }

  .engine-badge i {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: #b6c4c3;
  }

  .engine-badge-active {
    border-color: #bfe3d1;
    color: #1f7a52;
  }

  .engine-badge-active i {
    background: #2f9e6d;
    box-shadow: 0 0 0 3px rgba(47, 158, 109, 0.18);
    animation: badge-pulse 1.6s ease-in-out infinite;
  }

  .engine-badge-error {
    border-color: #f0cfc5;
    color: #b9523a;
  }

  .engine-badge-error i {
    background: #d7654f;
  }

  @keyframes badge-pulse {
    50% { box-shadow: 0 0 0 5px rgba(47, 158, 109, 0.08); }
  }

  /* ---------------- Dashboard shell ---------------- */
  .dashboard-page {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    overflow-y: auto;
  }

  .dashboard-topbar {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 12px 22px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    box-shadow: var(--shadow-panel);
    position: sticky;
    top: 0;
    z-index: 20;
  }

  .dashboard-topbar-meta {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-left: auto;
  }

  .dashboard-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px 22px 28px;
    width: min(1280px, 100%);
    margin: 0 auto;
    flex: 1 1 auto;
  }

  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-panel);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 13px 16px;
    border-bottom: 1px solid var(--line);
  }

  .panel-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 700;
    color: var(--ink);
  }

  .panel-title svg {
    color: var(--teal);
  }

  .panel-meta {
    font-size: 11px;
    color: var(--ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  /* ---------------- Controls ---------------- */
  .dashboard-controls {
    display: flex;
    align-items: flex-end;
    gap: 18px;
    padding: 14px 16px;
    flex-wrap: wrap;
  }

  .control-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .control-group label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  .control-group select {
    min-width: 180px;
    padding: 8px 11px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: #fff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .control-info span {
    font-size: 12px;
    color: var(--ink-soft);
  }

  .control-error {
    font-size: 12px;
    color: #b9523a;
  }

  .threshold-chip {
    margin-left: auto;
    padding: 6px 12px;
    border-radius: 999px;
    background: #fbeae5;
    border: 1px solid #f0cfc5;
    color: #b9523a;
    font-size: 12px;
    font-weight: 700;
  }

  /* ---------------- Dashboard grid ---------------- */
  .dashboard-grid {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
    grid-template-areas:
      'chart stats'
      'alerts engine';
    gap: 14px;
  }

  .chart-panel { grid-area: chart; min-width: 0; }
  .stat-cards { grid-area: stats; }
  .alert-feed { grid-area: alerts; }
  .engine-status { grid-area: engine; }

  .chart-shell {
    width: 100%;
    padding: 12px 8px 8px 0;
  }

  /* ---------------- Stat cards ---------------- */
  .stat-cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    align-content: start;
  }

  .dash-stat {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 13px 15px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-panel);
  }

  .dash-stat small {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  .dash-stat strong {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.1;
  }

  .dash-stat strong em {
    font-style: normal;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-soft);
  }

  .dash-stat-live {
    border-color: #bfe3d1;
    background: linear-gradient(180deg, #f2fbf7, var(--panel));
  }

  .dash-stat-live strong {
    color: #1f7a52;
  }

  .dash-stat:last-child:nth-child(odd) {
    grid-column: span 2;
  }

  /* ---------------- Alert feed ---------------- */
  .alert-feed {
    display: flex;
    flex-direction: column;
    min-height: 260px;
    max-height: 420px;
  }

  .alert-list {
    margin: 0;
    padding: 8px;
    list-style: none;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .alert-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 11px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: #fff;
    animation: alert-in 0.18s ease-out;
  }

  @keyframes alert-in {
    from { opacity: 0; transform: translateY(-6px); }
  }

  .alert-severity-icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    flex: 0 0 auto;
  }

  .alert-row.severity-critical {
    border-color: #f0cfc5;
    background: #fdf6f4;
  }

  .alert-row.severity-critical .alert-severity-icon {
    background: #f9ded6;
    color: #b9523a;
  }

  .alert-row.severity-warning {
    border-color: #f3e0bd;
    background: #fdfaf3;
  }

  .alert-row.severity-warning .alert-severity-icon {
    background: #f8ecd2;
    color: #9a6b12;
  }

  .alert-row.severity-info .alert-severity-icon {
    background: var(--teal-soft);
    color: var(--teal);
  }

  .alert-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1 1 auto;
  }

  .alert-copy strong {
    font-size: 12px;
    font-weight: 700;
  }

  .alert-copy small {
    font-size: 12px;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .alert-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
    flex: 0 0 auto;
  }

  .alert-meta em {
    font-style: normal;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  .alert-meta time {
    font-size: 11px;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }

  .alert-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 34px 18px;
    text-align: center;
    color: var(--ink-soft);
  }

  .alert-empty strong {
    font-size: 13px;
    color: var(--ink);
  }

  .alert-empty p {
    margin: 0;
    font-size: 12px;
    max-width: 300px;
  }

  /* ---------------- Engine status ---------------- */
  .engine-status {
    display: flex;
    flex-direction: column;
  }

  .engine-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    padding: 14px;
  }

  .engine-cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 11px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: #fff;
  }

  .engine-cell svg {
    color: var(--teal);
  }

  .engine-cell strong {
    font-size: 19px;
    font-weight: 700;
  }

  .engine-cell small {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  .engine-error {
    padding: 16px;
    font-size: 12px;
    color: #b9523a;
  }

  .engine-footer {
    margin-top: auto;
    padding: 10px 16px;
    border-top: 1px solid var(--line);
    font-size: 11px;
    color: var(--ink-soft);
  }

  /* ---------------- Alert toast ---------------- */
  .alert-toast {
    left: auto;
    right: 22px;
    transform: none;
    max-width: 420px;
    animation: alert-toast-in 0.18s ease-out;
  }

  .alert-toast strong {
    font-weight: 700;
  }

  .alert-toast-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: currentColor;
    flex: 0 0 auto;
    animation: badge-pulse 1.4s ease-in-out infinite;
  }

  @keyframes alert-toast-in {
    from { opacity: 0; transform: translateY(-8px); }
  }
}

@media (max-width: 1080px) {
  .dashboard-grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'chart'
      'stats'
      'alerts'
      'engine';
  }
}
```
