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
