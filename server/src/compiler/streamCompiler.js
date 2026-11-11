import { EMPTY, Subject, catchError, concatMap, of, share } from 'rxjs';
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
 * @param {{ graphId?: string | null, dryRun?: boolean, onAlert?: (result: object) => void }} [options]
 *   `dryRun` compiles the pipeline but never sends an SMS, calls a webhook or writes to the
 *   database; fired alerts are collected and returned by `getAlerts()`.
 * @returns {object} compiled pipeline handle
 */
export function compileGraph(graph, options = {}) {
  const { graphId = null, dryRun = false, onAlert = null } = options;

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
    const handler = node.definition.createAction(config, context);
    const input$ = buildStream(parentId);

    const actionStream$ = input$.pipe(
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
