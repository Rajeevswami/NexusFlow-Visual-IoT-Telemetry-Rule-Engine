# Day 2 — new and modified files

Complete source of every file that was **added** or **modified** on Day 2. Files that were
not touched (the Day 1 server models/routes, the time-series setup, the simulator, the
benchmark, `FlowInspector.jsx`, `GraphPicker.jsx`, `useTelemetry.js`, ...) are unchanged and
can be read in [`CODE.md`](CODE.md).

Summary of the changes:

* **Backend** — a registry-driven stream compiler (`src/compiler/`) that turns a saved React Flow
  JSON graph into RxJS pipelines, an in-memory `ActiveGraphManager`, the `Alert` model, and five
  new API endpoints (validate / compile / deactivate / active / test).
* **Frontend** — seven configurable custom node types, connection validation with cycle
  prevention, graph validation panel, and clean JSON serialization with export.

## New files

### `server/src/compiler/index.js`

```js
/**
 * Public entry point of the stream compiler.
 *
 * Importing this module registers every node type (operators, actions and sources)
 * and exposes the validator, the registry and the compiler.
 */
import './operators/index.js';
import './actions/index.js';
import './sources/index.js';

export { validateGraph } from './graphValidator.js';
export { compileGraph, describeNodes, toEvent, GraphValidationError } from './streamCompiler.js';
export { nodeRegistry, registerNode, getNode, hasNode, listNodes, nodeTypes, resolveConfig } from './nodeRegistry.js';
```

### `server/src/compiler/graphValidator.js`

```js
import { nodeRegistry } from './nodeRegistry.js';

/**
 * Shape of the graph JSON produced by the React Flow editor:
 *
 * {
 *   name: 'Turbine overheat rule',
 *   nodes: [ { id, type, position, data: { label?, config: { ... } } } ],
 *   edges: [ { id, source, target } ]
 * }
 */

/** @typedef {{ code: string, message: string, nodeId?: string, edgeId?: string }} GraphIssue */

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const problem = (code, message, extra = {}) => ({ code, message, ...extra });

/**
 * Detect a cycle with an iterative depth-first search. Returns the ids that form
 * the cycle (including the repeated node at the end) or `null` when the graph is acyclic.
 *
 * @param {Map<string, string[]>} adjacency node id -> outgoing neighbour ids
 * @returns {string[] | null}
 */
function findCycle(adjacency) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map([...adjacency.keys()].map((id) => [id, WHITE]));

  for (const root of adjacency.keys()) {
    if (color.get(root) !== WHITE) continue;
    // Each stack entry is [nodeId, iterator over its neighbours].
    const stack = [[root, adjacency.get(root)[Symbol.iterator]()]];
    const path = [root];
    color.set(root, GRAY);

    while (stack.length) {
      const [node, iterator] = stack[stack.length - 1];
      const next = iterator.next();
      if (next.done) {
        color.set(node, BLACK);
        stack.pop();
        path.pop();
        continue;
      }
      const neighbour = next.value;
      const state = color.get(neighbour);
      if (state === GRAY) {
        // Found a back edge: slice the current path from the first occurrence.
        return [...path.slice(path.indexOf(neighbour)), neighbour];
      }
      if (state === WHITE) {
        color.set(neighbour, GRAY);
        stack.push([neighbour, adjacency.get(neighbour)[Symbol.iterator]()]);
        path.push(neighbour);
      }
    }
  }
  return null;
}

/**
 * Validate a raw graph JSON document.
 *
 * Errors make the graph uncompilable; warnings are surfaced to the client but do not
 * block compilation (for example a node that is not wired to anything).
 *
 * @param {unknown} graph raw graph JSON
 * @returns {{ ok: boolean, errors: GraphIssue[], warnings: GraphIssue[], nodes: any[], edges: any[] }}
 */
export function validateGraph(graph) {
  /** @type {GraphIssue[]} */
  const errors = [];
  /** @type {GraphIssue[]} */
  const warnings = [];

  if (!isPlainObject(graph)) {
    return { ok: false, errors: [problem('invalid_graph', 'Graph must be a JSON object.')], warnings, nodes: [], edges: [] };
  }
  const rawNodes = graph.nodes;
  const rawEdges = graph.edges ?? [];

  if (!Array.isArray(rawNodes)) {
    return { ok: false, errors: [problem('invalid_nodes', 'Graph.nodes must be an array.')], warnings, nodes: [], edges: [] };
  }
  if (rawNodes.length === 0) {
    return { ok: false, errors: [problem('empty_graph', 'Graph must contain at least one node.')], warnings, nodes: [], edges: [] };
  }
  if (rawNodes.length > 500) {
    errors.push(problem('too_many_nodes', `Graph has ${rawNodes.length} nodes; the maximum is 500.`));
  }
  if (!Array.isArray(rawEdges)) {
    return { ok: false, errors: [problem('invalid_edges', 'Graph.edges must be an array.')], warnings, nodes: rawNodes, edges: [] };
  }

  // ---------------------------------------------------------------- nodes
  /** @type {Map<string, any>} */
  const nodesById = new Map();
  rawNodes.forEach((node, index) => {
    if (!isPlainObject(node)) {
      errors.push(problem('invalid_node', `Node at index ${index} must be an object.`));
      return;
    }
    const id = typeof node.id === 'string' ? node.id.trim() : '';
    if (!id) {
      errors.push(problem('invalid_node', `Node at index ${index} is missing an id.`));
      return;
    }
    if (nodesById.has(id)) {
      errors.push(problem('duplicate_node', `Duplicate node id "${id}".`, { nodeId: id }));
      return;
    }
    const type = typeof node.type === 'string' ? node.type : '';
    if (!type) {
      errors.push(problem('missing_type', `Node "${id}" is missing a type.`, { nodeId: id }));
      return;
    }
    const definition = nodeRegistry.get(type);
    if (!definition) {
      errors.push(problem('unknown_type', `Node "${id}" has unknown type "${type}". Known types: ${nodeRegistry.types().join(', ')}.`, { nodeId: id }));
      return;
    }
    if (node.data !== undefined && !isPlainObject(node.data)) {
      errors.push(problem('invalid_data', `Node "${id}" has a non-object "data" field.`, { nodeId: id }));
      return;
    }
    const config = node.data?.config ?? {};
    if (!isPlainObject(config)) {
      errors.push(problem('invalid_config', `Node "${id}" has a non-object "config" field.`, { nodeId: id }));
      return;
    }
    // Each node type owns its own config rules (Open/Closed: new nodes bring their own).
    for (const message of definition.validate(config)) {
      errors.push(problem('invalid_config', `Node "${id}" (${type}): ${message}`, { nodeId: id }));
    }
    nodesById.set(id, { ...node, id, type, definition, config });
  });

  // ---------------------------------------------------------------- edges
  /** @type {Map<string, any>} */
  const edgesById = new Map();
  /** @type {Map<string, string[]>} */
  const adjacency = new Map([...nodesById.keys()].map((id) => [id, []]));
  /** @type {Map<string, number>} */
  const inDegree = new Map([...nodesById.keys()].map((id) => [id, 0]));
  /** @type {Set<string>} */
  const seenPairs = new Set();

  rawEdges.forEach((edge, index) => {
    if (!isPlainObject(edge)) {
      errors.push(problem('invalid_edge', `Edge at index ${index} must be an object.`));
      return;
    }
    const id = typeof edge.id === 'string' ? edge.id.trim() : '';
    const source = typeof edge.source === 'string' ? edge.source : '';
    const target = typeof edge.target === 'string' ? edge.target : '';
    if (!id || !source || !target) {
      errors.push(problem('invalid_edge', `Edge at index ${index} requires id, source and target.`));
      return;
    }
    if (edgesById.has(id)) {
      errors.push(problem('duplicate_edge', `Duplicate edge id "${id}".`, { edgeId: id }));
      return;
    }
    if (!nodesById.has(source)) {
      errors.push(problem('missing_source', `Edge "${id}" references unknown source node "${source}".`, { edgeId: id }));
      return;
    }
    if (!nodesById.has(target)) {
      errors.push(problem('missing_target', `Edge "${id}" references unknown target node "${target}".`, { edgeId: id }));
      return;
    }
    if (source === target) {
      errors.push(problem('self_connection', `Edge "${id}" connects node "${source}" to itself.`, { edgeId: id }));
      return;
    }
    const pair = `${source}->${target}`;
    if (seenPairs.has(pair)) {
      errors.push(problem('duplicate_connection', `Nodes "${source}" and "${target}" are already connected.`, { edgeId: id }));
      return;
    }
    seenPairs.add(pair);

    const from = nodesById.get(source);
    const to = nodesById.get(target);
    if (to.definition.category === 'source') {
      errors.push(problem('source_has_input', `"${from.definition.label}" cannot connect into source node "${target}": sources only emit data.`, { edgeId: id }));
      return;
    }
    if (from.definition.category === 'action') {
      errors.push(problem('action_has_output', `Action node "${source}" cannot feed another node: actions are terminal.`, { edgeId: id }));
      return;
    }
    edgesById.set(id, { id, source, target });
    adjacency.get(source).push(target);
    inDegree.set(target, inDegree.get(target) + 1);
  });

  // ------------------------------------------------------- cardinality rules
  for (const node of nodesById.values()) {
    const incoming = inDegree.get(node.id);
    const outgoing = adjacency.get(node.id).length;
    if (node.definition.category !== 'source' && incoming > 1) {
      errors.push(problem('too_many_inputs', `Node "${node.id}" has ${incoming} inputs; only a single input per node is supported.`, { nodeId: node.id }));
    }
    if (node.definition.category !== 'source' && incoming === 0) {
      warnings.push(problem('disconnected_node', `Node "${node.id}" (${node.definition.label}) has no input and will never receive data.`, { nodeId: node.id }));
    }
    if (node.definition.category !== 'action' && outgoing === 0) {
      warnings.push(problem('dangling_output', `Node "${node.id}" (${node.definition.label}) output is not connected to anything.`, { nodeId: node.id }));
    }
  }

  // --------------------------------------------------------------- cycles
  const cycle = findCycle(adjacency);
  if (cycle) {
    errors.push(problem('cycle', `Graph contains a cycle: ${cycle.join(' -> ')}.`));
  }

  // ------------------------------------------------- sources / sinks summary
  const sourceNodes = [...nodesById.values()].filter((node) => node.definition.category === 'source');
  const actionNodes = [...nodesById.values()].filter((node) => node.definition.category === 'action');
  if (sourceNodes.length === 0) {
    errors.push(problem('no_source', 'Graph needs at least one data source node.'));
  }
  if (actionNodes.length === 0) {
    warnings.push(problem('no_action', 'Graph has no action node, so it will never trigger an alert.'));
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    nodes: [...nodesById.values()],
    edges: [...edgesById.values()],
  };
}
```

### `server/src/compiler/nodeRegistry.js`

```js
/**
 * Node registry — the extension point of the stream compiler.
 *
 * Every node type registers itself with:
 *   {
 *     type: 'movingAverage',
 *     category: 'source' | 'math' | 'action',
 *     label: 'Moving Average',
 *     defaults: { windowSize: 5 },
 *     validate(config): string[]                      // human-readable config errors
 *     createOperator(config, context): (source$) => Observable   // math nodes only
 *     createAction(config, context): (event) => result | Promise<result>  // action nodes only
 *     subjectKey(config): string                      // source nodes only
 *   }
 *
 * `streamCompiler` contains no node-specific logic: it only walks the registry, so new
 * node types are added by dropping a file into operators/ or actions/ and importing it.
 */

/** @type {Map<string, any>} */
const registry = new Map();

/**
 * Register a node type.
 * @param {any} definition node definition (see file header)
 */
export function registerNode(definition) {
  if (!definition?.type) throw new Error('registerNode requires a "type".');
  if (!['source', 'math', 'action'].includes(definition.category)) {
    throw new Error(`registerNode: "${definition.type}" needs a category of source, math or action.`);
  }
  if (definition.category === 'math' && typeof definition.createOperator !== 'function') {
    throw new Error(`registerNode: math node "${definition.type}" must implement createOperator().`);
  }
  if (definition.category === 'action' && typeof definition.createAction !== 'function') {
    throw new Error(`registerNode: action node "${definition.type}" must implement createAction().`);
  }
  registry.set(definition.type, {
    validate: () => [],
    defaults: {},
    ...definition,
  });
}

/** @param {string} type */
export function getNode(type) {
  return registry.get(type);
}

/** @param {string} type */
export const hasNode = (type) => registry.has(type);

/** All registered node definitions, sorted by category then label. */
export function listNodes() {
  return [...registry.values()];
}

/** All registered node type ids (used in error messages and by the client). */
export const nodeTypes = () => [...registry.keys()];

/** Merge a node's defaults with the config coming from the client. */
export function resolveConfig(type, config = {}) {
  return { ...(registry.get(type)?.defaults ?? {}), ...config };
}

export const nodeRegistry = { register: registerNode, get: getNode, has: hasNode, list: listNodes, types: nodeTypes };
```

### `server/src/compiler/streamCompiler.js`

```js
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
```

### `server/src/compiler/operators/index.js`

```js
/**
 * Importing this module registers every math/transform node in the registry.
 * Add a new file here to make a new operator available to the compiler.
 */
export { movingAverage } from './movingAverage.js';
export { threshold, THRESHOLD_OPERATORS } from './threshold.js';
export { scale } from './scale.js';
```

### `server/src/compiler/operators/movingAverage.js`

```js
import { bufferCount, map } from 'rxjs';
import { registerNode } from '../nodeRegistry.js';

/**
 * Sliding-window average.
 *
 * `bufferCount(windowSize, 1)` emits a new buffer on every event (startOffset = 1), so the
 * average updates on each reading once the window is full.
 *
 * @param {number} windowSize number of readings in the window (>= 1)
 * @returns {(source$: import('rxjs').Observable<object>) => import('rxjs').Observable<object>}
 */
export function movingAverage(windowSize = 5) {
  const size = Math.max(1, Math.floor(Number(windowSize) || 1));
  return (source$) => source$.pipe(
    bufferCount(size, 1),
    map((events) => {
      const sum = events.reduce((total, event) => total + Number(event.value), 0);
      const last = events[events.length - 1];
      return {
        ...last,
        value: sum / events.length,
        // Extra context for actions/UI: the raw window that produced this average.
        samples: events.length,
        window: events.map((event) => event.value),
      };
    }),
  );
}

registerNode({
  type: 'movingAverage',
  category: 'math',
  label: 'Moving Average',
  defaults: { windowSize: 5 },
  validate(config) {
    const errors = [];
    const { windowSize } = config;
    if (windowSize !== undefined && (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 1000)) {
      errors.push('windowSize must be an integer between 1 and 1000.');
    }
    return errors;
  },
  createOperator: (config) => movingAverage(config.windowSize),
});
```

### `server/src/compiler/operators/threshold.js`

```js
import { filter } from 'rxjs';
import { registerNode } from '../nodeRegistry.js';

/** Supported comparison operators (mirrored by the client dropdown). */
export const THRESHOLD_OPERATORS = ['>', '>=', '<', '<=', '==', '!='];

const comparators = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

/**
 * Pass through only the events that satisfy `value <operator> threshold`.
 *
 * @param {string} operator one of THRESHOLD_OPERATORS
 * @param {number} value threshold
 */
export function threshold(operator = '>', value = 0) {
  const compare = comparators[operator];
  if (!compare) throw new Error(`Unsupported threshold operator "${operator}".`);
  const limit = Number(value);
  return (source$) => source$.pipe(filter((event) => compare(Number(event.value), limit)));
}

registerNode({
  type: 'threshold',
  category: 'math',
  label: 'Threshold',
  defaults: { operator: '>', value: 80 },
  validate(config) {
    const errors = [];
    if (config.operator !== undefined && !THRESHOLD_OPERATORS.includes(config.operator)) {
      errors.push(`operator must be one of ${THRESHOLD_OPERATORS.join(', ')}.`);
    }
    if (config.value !== undefined && typeof config.value !== 'number') {
      errors.push('value must be a number.');
    }
    return errors;
  },
  createOperator: (config) => threshold(config.operator, config.value),
});
```

### `server/src/compiler/operators/scale.js`

```js
import { map } from 'rxjs';
import { registerNode } from '../nodeRegistry.js';

/**
 * Linear transform: `value = value * factor + offset` (unit conversion, calibration...).
 *
 * @param {number} factor
 * @param {number} offset
 */
export function scale(factor = 1, offset = 0) {
  const k = Number(factor);
  const c = Number(offset);
  return (source$) => source$.pipe(map((event) => ({ ...event, value: Number(event.value) * k + c })));
}

registerNode({
  type: 'scale',
  category: 'math',
  label: 'Scale',
  defaults: { factor: 1, offset: 0 },
  validate(config) {
    const errors = [];
    for (const key of ['factor', 'offset']) {
      if (config[key] !== undefined && typeof config[key] !== 'number') errors.push(`${key} must be a number.`);
    }
    return errors;
  },
  createOperator: (config) => scale(config.factor, config.offset),
});
```

### `server/src/compiler/actions/index.js`

```js
/**
 * Importing this module registers every action node in the registry.
 */
export { createSmsAction } from './smsAlert.js';
export { createWebhookAction } from './webhook.js';
export { createLogAction } from './log.js';
export { renderTemplate } from './template.js';
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

export function defaultMessage(event = {}) {
  const unit = event.unit ? ` ${event.unit}` : '';
  return `Alert: ${event.deviceId ?? 'unknown-device'} ${event.sensorType ?? ''} = ${formatNumber(event.value)}${unit}`.trim();
}

function formatNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
```

### `server/src/compiler/actions/smsAlert.js`

```js
import { registerNode } from '../nodeRegistry.js';
import { recordAlert } from '../../services/alertService.js';
import { renderTemplate } from './template.js';

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
  defaults: { phone: '+10000000000', messageTemplate: DEFAULT_TEMPLATE },
  validate(config) {
    const errors = [];
    if (config.phone !== undefined) {
      const phone = String(config.phone).trim();
      if (phone === '' || !/^\+?[0-9 ()-]{6,20}$/.test(phone)) errors.push('phone must be 6-20 digits (optional leading +).');
    }
    if (config.messageTemplate !== undefined && String(config.messageTemplate).length > 240) {
      errors.push('messageTemplate must be 240 characters or fewer.');
    }
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
```

### `server/src/compiler/actions/log.js`

```js
import { registerNode } from '../nodeRegistry.js';
import { recordAlert } from '../../services/alertService.js';
import { renderTemplate } from './template.js';

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
  defaults: { label: 'pipeline', template: '${deviceId} ${sensorType} = ${value}${unit}' },
  validate(config) {
    const errors = [];
    if (config.label !== undefined && String(config.label).length > 60) errors.push('label must be 60 characters or fewer.');
    return errors;
  },
  createAction: createLogAction,
});
```

### `server/src/compiler/sources/index.js`

```js
/**
 * Importing this module registers every source node in the registry.
 */
export { sensorKey, sensorMatches } from './sensor.js';
```

### `server/src/compiler/sources/sensor.js`

```js
import { registerNode } from '../nodeRegistry.js';

const WILDCARD = '*';

/** Stable key used to look up a source node's Subject. */
export function sensorKey(config = {}) {
  return `${config.deviceId || WILDCARD}:${config.sensorType || WILDCARD}`;
}

const matches = (configured, actual) => !configured || configured === WILDCARD || configured === actual;

/** Does an incoming telemetry reading belong to this sensor node? */
export function sensorMatches(reading, config = {}) {
  const metadata = reading?.metadata ?? {};
  return matches(config.deviceId, metadata.deviceId) && matches(config.sensorType, metadata.sensorType);
}

registerNode({
  type: 'sensor',
  category: 'source',
  label: 'Sensor Source',
  defaults: { deviceId: 'turbine-001', sensorType: 'temperature' },
  subjectKey: sensorKey,
  matches: sensorMatches,
  validate(config) {
    const errors = [];
    for (const key of ['deviceId', 'sensorType']) {
      if (config[key] !== undefined) {
        const value = String(config[key]).trim();
        if (value === '') errors.push(`${key} must not be empty.`);
        else if (value.length > 120) errors.push(`${key} must be 120 characters or fewer.`);
      }
    }
    return errors;
  },
});
```

### `server/src/models/Alert.js`

```js
import mongoose from 'mongoose';

/**
 * Alerts raised by action nodes of a compiled pipeline.
 * Stored in a normal collection (not time-series) because alerts are low volume,
 * are read by id/graph and are kept for auditing.
 */
const alertSchema = new mongoose.Schema({
  graphId: { type: mongoose.Schema.Types.ObjectId, ref: 'Graph', index: true },
  nodeId: { type: String, required: true, trim: true },
  type: { type: String, required: true, trim: true },
  deviceId: { type: String, required: true, trim: true, index: true },
  sensorType: { type: String, trim: true },
  value: { type: Number },
  message: { type: String, required: true },
  triggeredAt: { type: Date, default: Date.now },
}, { timestamps: false, versionKey: false });

export const Alert = mongoose.model('Alert', alertSchema);
```

### `server/src/services/activeGraphManager.js`

```js
import { Graph } from '../models/Graph.js';
import { compileGraph } from '../compiler/index.js';
import { httpError } from '../utils/httpError.js';
import { broadcastAlert } from './websocket.js';

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
        onAlert: (alert) => broadcastAlert({ graphId: id, ...alert }),
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

### `server/src/services/alertService.js`

```js
import { Alert } from '../models/Alert.js';

/**
 * Persist an alert raised by an action node.
 *
 * Never throws: persistence must not break the RxJS pipeline, it only means the alert
 * is not recorded.
 *
 * @param {{ graphId?: string, nodeId: string, type: string, deviceId?: string,
 *           sensorType?: string, value?: number, message: string, triggeredAt?: Date }} alert
 * @returns {Promise<object | null>} the saved document, or null when it could not be stored
 */
export async function recordAlert(alert) {
  try {
    const saved = await Alert.create({
      graphId: alert.graphId || undefined,
      nodeId: alert.nodeId,
      type: alert.type,
      deviceId: alert.deviceId ?? 'unknown',
      sensorType: alert.sensorType,
      value: alert.value,
      message: alert.message,
      triggeredAt: alert.triggeredAt ?? new Date(),
    });
    return saved.toObject();
  } catch (error) {
    console.error(`Failed to persist alert for node ${alert.nodeId}: ${error.message}`);
    return null;
  }
}

/**
 * @param {string} graphId
 * @param {number} [limit]
 */
export async function listAlerts(graphId, limit = 50) {
  return Alert.find({ graphId }).sort({ triggeredAt: -1 }).limit(Math.min(limit, 500)).lean();
}
```

### `server/src/utils/httpError.js`

```js
/**
 * Create an Error carrying an HTTP status code, recognised by the central error middleware.
 *
 * @param {number} status HTTP status code
 * @param {string} message human-readable message returned to the client
 * @param {object} [extra] additional fields (for example `details`)
 */
export function httpError(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}
```

### `server/src/validation/compile.js`

```js
import { z } from 'zod';

/**
 * Body of POST /api/graphs/validate — the raw graph JSON straight from React Flow,
 * checked without being persisted.
 */
export const rawGraphSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  nodes: z.array(z.record(z.unknown())).max(500),
  edges: z.array(z.record(z.unknown())).max(2000),
  viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().positive() }).optional(),
}).strict();

const testValueSchema = z.object({
  deviceId: z.string().trim().min(1).max(120).optional(),
  sensorType: z.string().trim().min(1).max(120).optional(),
  unit: z.string().trim().max(20).optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
  value: z.number().finite(),
}).strict();

/**
 * Body of POST /api/graphs/:id/test — sample values pushed through the compiled pipeline.
 * Accepts bare numbers or explicit readings.
 */
export const testGraphSchema = z.object({
  values: z.array(z.union([z.number().finite(), testValueSchema])).min(1).max(1000),
}).strict();
```

### `server/samples/turbine-graph.json`

```json
{
  "name": "Turbine overheat rule",
  "viewport": {
    "x": 0,
    "y": 0,
    "zoom": 1
  },
  "nodes": [
    {
      "id": "sensor-turbine",
      "type": "sensor",
      "position": {
        "x": 0,
        "y": 120
      },
      "data": {
        "label": "Turbine Sensor",
        "config": {
          "deviceId": "turbine-001",
          "sensorType": "temperature"
        }
      }
    },
    {
      "id": "average-1",
      "type": "movingAverage",
      "position": {
        "x": 300,
        "y": 120
      },
      "data": {
        "label": "Moving Average Filter",
        "config": {
          "windowSize": 5
        }
      }
    },
    {
      "id": "threshold-1",
      "type": "threshold",
      "position": {
        "x": 600,
        "y": 120
      },
      "data": {
        "label": "Overheat Threshold",
        "config": {
          "operator": ">",
          "value": 80
        }
      }
    },
    {
      "id": "sms-1",
      "type": "smsAlert",
      "position": {
        "x": 900,
        "y": 120
      },
      "data": {
        "label": "SMS Alert",
        "config": {
          "phone": "+911234567890",
          "messageTemplate": "ALERT ${deviceId} ${sensorType} average = ${value}${unit}"
        }
      }
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "sensor-turbine",
      "target": "average-1"
    },
    {
      "id": "edge-2",
      "source": "average-1",
      "target": "threshold-1"
    },
    {
      "id": "edge-3",
      "source": "threshold-1",
      "target": "sms-1"
    }
  ]
}
```

### `server/vitest.config.js`

```js
import { defineConfig } from 'vitest/config';

/**
 * Vitest runs the compiler unit tests (pure logic, no database).
 * The HTTP/database suites stay on Node's built-in runner, see the "test" script.
 */
export default defineConfig({
  test: {
    include: ['test/compiler/**/*.test.js'],
    environment: 'node',
    reporters: 'default',
  },
});
```

### `server/test/compiler/graphValidator.test.js`

```js
import { describe, expect, it } from 'vitest';
import { validateGraph } from '../../src/compiler/index.js';

const source = (id, overrides = {}) => ({
  id,
  type: 'sensor',
  position: { x: 0, y: 0 },
  data: { config: { deviceId: 'turbine-001', sensorType: 'temperature' } },
  ...overrides,
});
const movingAverage = (id, windowSize = 3) => ({ id, type: 'movingAverage', position: { x: 0, y: 0 }, data: { config: { windowSize } } });
const threshold = (id = 'threshold-1') => ({ id, type: 'threshold', position: { x: 0, y: 0 }, data: { config: { operator: '>', value: 80 } } });
const logNode = (id = 'log-1') => ({ id, type: 'log', position: { x: 0, y: 0 }, data: { config: {} } });
const edge = (sourceId, targetId, id = `${sourceId}->${targetId}`) => ({ id, source: sourceId, target: targetId });

describe('graphValidator', () => {
  it('accepts the sample turbine graph', () => {
    const result = validateGraph({
      nodes: [source('sensor-1'), movingAverage('average-1', 5), threshold('threshold-1'), { id: 'sms-1', type: 'smsAlert', position: { x: 0, y: 0 }, data: { config: { phone: '+911234567890' } } }],
      edges: [edge('sensor-1', 'average-1'), edge('average-1', 'threshold-1'), edge('threshold-1', 'sms-1')],
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(4);
  });

  it('reports unknown node types', () => {
    const result = validateGraph({ nodes: [{ id: 'n1', type: 'quantumFlux', data: {} }], edges: [] });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('unknown_type');
  });

  it('reports missing nodes referenced by an edge', () => {
    const result = validateGraph({ nodes: [source('sensor-1'), movingAverage('average-1')], edges: [edge('sensor-1', 'ghost')] });
    expect(result.errors.map((error) => error.code)).toContain('missing_target');
  });

  it('reports duplicate node and edge ids', () => {
    const result = validateGraph({
      nodes: [source('sensor-1'), source('sensor-1')],
      edges: [edge('sensor-1', 'sensor-1')],
    });
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(['duplicate_node', 'self_connection']));
  });

  it('rejects a cycle', () => {
    const result = validateGraph({
      nodes: [source('sensor-1'), movingAverage('average-1'), movingAverage('average-2')],
      edges: [edge('sensor-1', 'average-1'), edge('average-1', 'average-2'), edge('average-2', 'average-1')],
    });
    const cycle = result.errors.find((error) => error.code === 'cycle');
    expect(cycle).toBeDefined();
    expect(cycle.message).toContain('average-1');
  });

  it('rejects input into a source and output from an action', () => {
    const intoSource = validateGraph({ nodes: [source('sensor-1'), source('sensor-2')], edges: [edge('sensor-1', 'sensor-2')] });
    expect(intoSource.errors.map((error) => error.code)).toContain('source_has_input');

    const fromAction = validateGraph({ nodes: [source('sensor-1'), logNode('log-1'), movingAverage('average-1')], edges: [edge('sensor-1', 'log-1'), edge('log-1', 'average-1')] });
    expect(fromAction.errors.map((error) => error.code)).toContain('action_has_output');
  });

  it('requires at least one source and warns without an action', () => {
    const noSource = validateGraph({ nodes: [movingAverage('average-1')], edges: [] });
    expect(noSource.errors.map((error) => error.code)).toContain('no_source');

    const noAction = validateGraph({ nodes: [source('sensor-1'), movingAverage('average-1')], edges: [edge('sensor-1', 'average-1')] });
    expect(noAction.ok).toBe(true);
    expect(noAction.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(['no_action', 'dangling_output']));
  });

  it('flags configuration errors per node type', () => {
    const result = validateGraph({ nodes: [source('sensor-1'), { id: 'average-1', type: 'movingAverage', data: { config: { windowSize: 0 } } }], edges: [edge('sensor-1', 'average-1')] });
    expect(result.errors.some((error) => error.code === 'invalid_config' && error.nodeId === 'average-1')).toBe(true);
  });

  it('rejects non-object graphs', () => {
    expect(validateGraph(null).ok).toBe(false);
    expect(validateGraph({ nodes: 'nope' }).errors[0].code).toBe('invalid_nodes');
    expect(validateGraph({ nodes: [] }).errors[0].code).toBe('empty_graph');
  });
});
```

### `server/test/compiler/operators.test.js`

```js
import { Subject, take } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { movingAverage } from '../../src/compiler/operators/movingAverage.js';
import { threshold } from '../../src/compiler/operators/threshold.js';
import { scale } from '../../src/compiler/operators/scale.js';

const event = (value, extra = {}) => ({ deviceId: 'turbine-001', sensorType: 'temperature', unit: '°C', value, ...extra });

/**
 * Push values through an operator and return every emission.
 *
 * `expected` uses `take()` instead of completing the Subject: `bufferCount` flushes its
 * partial window on completion, which never happens in production (source Subjects are hot).
 *
 * @param {(source$: any) => any} operator
 * @param {number[]} values
 * @param {number} expected how many emissions to wait for
 */
function collect(operator, values, expected) {
  const subject = new Subject();
  const results = [];
  const subscription = subject.pipe(operator, take(expected)).subscribe((next) => results.push(next));
  for (const value of values) subject.next(event(value));
  subscription.unsubscribe();
  return results;
}

describe('movingAverage', () => {
  it('emits one average per reading once the window is full', () => {
    expect(collect(movingAverage(3), [10, 20, 30, 40], 2).map((result) => result.value)).toEqual([20, 30]);
  });

  it('keeps the metadata of the newest reading and records the window', () => {
    const results = collect(movingAverage(2), [4, 8], 1);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ deviceId: 'turbine-001', sensorType: 'temperature', unit: '°C', value: 6, samples: 2, window: [4, 8] });
  });

  it('supports a window of one (pass-through)', () => {
    expect(collect(movingAverage(1), [7, 9], 2).map((result) => result.value)).toEqual([7, 9]);
  });

  it('rounds nothing and keeps fractional averages', () => {
    expect(collect(movingAverage(3), [70, 85, 90], 1)[0].value).toBeCloseTo(81.6667, 4);
  });
});

describe('threshold', () => {
  it('passes only values matching the operator', () => {
    expect(collect(threshold('>', 80), [70, 81, 80, 95], 2).map((result) => result.value)).toEqual([81, 95]);
    expect(collect(threshold('>=', 80), [70, 80, 95], 2).map((result) => result.value)).toEqual([80, 95]);
    expect(collect(threshold('<', 80), [70, 80, 95], 1).map((result) => result.value)).toEqual([70]);
    expect(collect(threshold('<=', 80), [70, 80, 95], 2).map((result) => result.value)).toEqual([70, 80]);
    expect(collect(threshold('==', 80), [70, 80, 95], 1).map((result) => result.value)).toEqual([80]);
    expect(collect(threshold('!=', 80), [70, 80, 95], 2).map((result) => result.value)).toEqual([70, 95]);
  });

  it('rejects unsupported operators', () => {
    expect(() => threshold('~', 1)).toThrow(/Unsupported threshold operator/);
  });
});

describe('scale', () => {
  it('applies factor and offset', () => {
    expect(collect(scale(2, 1), [0, 5], 2).map((result) => result.value)).toEqual([1, 11]);
  });
});

describe('operator composition', () => {
  it('chains movingAverage then threshold like the compiler does', () => {
    const results = collect((source$) => source$.pipe(movingAverage(3), threshold('>', 80)), [70, 85, 90, 95], 2);
    // windows: [70,85,90] -> 81.67 (fires), [85,90,95] -> 90 (fires)
    expect(results.map((result) => Number(result.value.toFixed(2)))).toEqual([81.67, 90]);
  });
});
```

### `server/test/compiler/streamCompiler.test.js`

```js
import { describe, expect, it, vi } from 'vitest';
import { compileGraph, GraphValidationError } from '../../src/compiler/streamCompiler.js';
import { nodeRegistry } from '../../src/compiler/nodeRegistry.js';

const sourceNode = (id = 'sensor-1', config = { deviceId: 'turbine-001', sensorType: 'temperature' }) => ({ id, type: 'sensor', position: { x: 0, y: 0 }, data: { config } });
const averageNode = (id = 'average-1', windowSize = 3) => ({ id, type: 'movingAverage', position: { x: 0, y: 0 }, data: { config: { windowSize } } });
const thresholdNode = (id = 'threshold-1', operator = '>', value = 80) => ({ id, type: 'threshold', position: { x: 0, y: 0 }, data: { config: { operator, value } } });
const logAction = (id = 'log-1') => ({ id, type: 'log', position: { x: 0, y: 0 }, data: { config: { label: 'test' } } });
const smsAction = (id = 'sms-1') => ({ id, type: 'smsAlert', position: { x: 0, y: 0 }, data: { config: { phone: '+911234567890', messageTemplate: 'ALERT ${deviceId} = ${value}${unit}' } } });
const link = (source, target) => ({ id: `${source}->${target}`, source, target });

/** Sensor -> MovingAverage(3) -> Threshold(>80) -> Log */
const linearGraph = {
  nodes: [sourceNode(), averageNode(), thresholdNode(), logAction()],
  edges: [link('sensor-1', 'average-1'), link('average-1', 'threshold-1'), link('threshold-1', 'log-1')],
};

describe('streamCompiler', () => {
  it('registers the built-in node types', () => {
    expect(nodeRegistry.types().sort()).toEqual(['log', 'movingAverage', 'scale', 'sensor', 'smsAlert', 'threshold', 'webhook']);
  });

  it('fires the log action when the moving average crosses the threshold', async () => {
    const compiled = compileGraph(linearGraph, { graphId: 'test', dryRun: true });
    compiled.pushValues([70, 85, 90, 95]);
    await new Promise((resolve) => setImmediate(resolve));

    const alerts = compiled.getAlerts();
    // window [70,85,90] -> 81.67 (fires), window [85,90,95] -> 90 (fires)
    expect(alerts).toHaveLength(2);
    expect(alerts.map((alert) => Number(alert.value.toFixed(2)))).toEqual([81.67, 90]);
    expect(alerts[0]).toMatchObject({ type: 'log', nodeId: 'log-1', deviceId: 'turbine-001', delivered: true, dryRun: true });
    compiled.dispose();
  });

  it('does not fire below the threshold', async () => {
    const compiled = compileGraph(linearGraph, { dryRun: true });
    compiled.pushValues([10, 20, 30, 40]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(compiled.getAlerts()).toEqual([]);
    compiled.dispose();
  });

  it('keeps metadata and renders the SMS template', async () => {
    const compiled = compileGraph({
      nodes: [sourceNode(), thresholdNode('threshold-1', '>', 50), smsAction()],
      edges: [link('sensor-1', 'threshold-1'), link('threshold-1', 'sms-1')],
    }, { dryRun: true });
    compiled.pushValues([{ value: 60, unit: '°C' }]);
    await new Promise((resolve) => setImmediate(resolve));

    const [alert] = compiled.getAlerts();
    expect(alert.message).toBe('ALERT turbine-001 = 60°C');
    expect(alert.to).toBe('+911234567890');
    compiled.dispose();
  });

  it('supports branching with share(): one source feeding two actions', async () => {
    const compiled = compileGraph({
      nodes: [sourceNode(), thresholdNode('threshold-1', '>', 50), logAction('log-1'), smsAction('sms-1')],
      edges: [link('sensor-1', 'threshold-1'), link('threshold-1', 'log-1'), link('threshold-1', 'sms-1')],
    }, { dryRun: true });

    expect(compiled.subscriptions).toHaveLength(2);
    compiled.pushValues([55]);
    await new Promise((resolve) => setImmediate(resolve));

    const alerts = compiled.getAlerts();
    expect(alerts.map((alert) => alert.type).sort()).toEqual(['log', 'smsAlert']);
    compiled.dispose();
  });

  it('routes readings by deviceId and sensorType', async () => {
    const compiled = compileGraph({
      nodes: [sourceNode('sensor-a', { deviceId: 'turbine-001', sensorType: 'temperature' }), logAction('log-a')],
      edges: [link('sensor-a', 'log-a')],
    }, { dryRun: true });

    compiled.publish({ metadata: { deviceId: 'turbine-001', sensorType: 'temperature' }, value: 10, unit: '°C' });
    compiled.publish({ metadata: { deviceId: 'turbine-002', sensorType: 'temperature' }, value: 99, unit: '°C' });
    compiled.publish({ metadata: { deviceId: 'turbine-001', sensorType: 'vibration' }, value: 99, unit: 'mm/s' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(compiled.getAlerts()).toHaveLength(1);
    compiled.dispose();
  });

  it('exposes source summaries for the compile response', () => {
    const compiled = compileGraph(linearGraph, { graphId: 'abc', dryRun: true });
    expect(compiled.sources).toEqual([{ nodeId: 'sensor-1', type: 'sensor', deviceId: 'turbine-001', sensorType: 'temperature', key: 'turbine-001:temperature' }]);
    expect(compiled.nodeCount).toBe(4);
    expect(compiled.edgeCount).toBe(3);
    compiled.dispose();
  });

  it('compiles a disconnected math node feeding an action as a dead branch instead of crashing', async () => {
    // average-1 has no input (validator: warning only) but feeds log-1.
    const graph = {
      nodes: [sourceNode('sensor-1'), averageNode('average-1', 3), logAction('log-1')],
      edges: [link('average-1', 'log-1')],
    };
    const compiled = compileGraph(graph, { dryRun: true });
    // Dry-run values reach the source; the dead branch emits nothing, so no crash and no alerts.
    compiled.pushValues([80, 90, 100]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(compiled.getAlerts()).toEqual([]);
    compiled.dispose();
  });

  it('refuses to compile an invalid graph', () => {
    expect(() => compileGraph({ nodes: [averageNode()], edges: [] }, { dryRun: true })).toThrow(GraphValidationError);
    const invalid = { nodes: [sourceNode(), averageNode()], edges: [link('sensor-1', 'average-1'), link('average-1', 'sensor-1')] };
    expect(() => compileGraph(invalid, { dryRun: true })).toThrow(/not valid/);
  });

  it('dispose() unsubscribes and stops the pipeline', async () => {
    const compiled = compileGraph(linearGraph, { dryRun: true });
    expect(compiled.disposed).toBe(false);
    compiled.dispose();
    expect(compiled.disposed).toBe(true);
    expect(compiled.subscriptions).toHaveLength(0);
    // Pushing after disposal must be a no-op, not a crash.
    expect(compiled.pushValues([100, 100, 100])).toBe(0);
    compiled.dispose(); // idempotent
  });

  it('never lets a failing action kill the pipeline', async () => {
    const compiled = compileGraph({
      nodes: [sourceNode(), logAction('log-1')],
      edges: [link('sensor-1', 'log-1')],
    }, { dryRun: true, onAlert: () => { throw new Error('listener exploded'); } });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    compiled.pushValues([1, 2]);
    await new Promise((resolve) => setImmediate(resolve));
    // Both events were still delivered to the action.
    expect(compiled.getAlerts()).toHaveLength(2);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
    compiled.dispose();
  });
});
```

### `server/test/compilerRoutes.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { Graph } from '../src/models/Graph.js';
import { activeGraphManager } from '../src/services/activeGraphManager.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * HTTP tests for the Day 2 compile endpoints.
 *
 * `Graph.findById` is stubbed so the routing, validation, status codes, response shape and
 * disposal logic can be tested without a database. Use the vitest suite and
 * `TEST_MONGODB_URI=... npm test` for the real database paths.
 */

const ID_A = '64b7f9c2e1a2b3c4d5e6f7a8';
const ID_B = '64b7f9c2e1a2b3c4d5e6f7b9';
const sample = JSON.parse(readFileSync(fileURLToPath(new URL('../samples/turbine-graph.json', import.meta.url)), 'utf8'));
const originalFindById = Graph.findById;

/** Serve the given documents (by id) through the model. */
function stubGraphs(docs) {
  Graph.findById = (id) => ({
    lean: async () => {
      const doc = docs[id];
      return doc ? { ...doc, _id: id } : null;
    },
  });
}

test('compile, list, test and deactivate a graph', async (t) => {
  stubGraphs({ [ID_A]: sample });

  t.after(() => {
    Graph.findById = originalFindById;
    activeGraphManager.disposeAll();
  });

  // Unknown id -> 404.
  assert.equal((await request(app).post(`/api/graphs/${ID_B}/compile`)).status, 404);
  // Bad id -> 400.
  assert.equal((await request(app).post('/api/graphs/not-an-id/compile')).status, 400);

  // Compile + activate.
  const compiled = await request(app).post(`/api/graphs/${ID_A}/compile`);
  assert.equal(compiled.status, 200);
  assert.equal(compiled.body.data.graphId, ID_A);
  assert.equal(compiled.body.data.nodeCount, 4);
  assert.equal(compiled.body.data.edgeCount, 3);
  assert.equal(compiled.body.data.sources[0].key, 'turbine-001:temperature');
  assert.equal(compiled.body.data.subscriptions, 1);

  // Listed as active.
  const active = await request(app).get('/api/graphs/active');
  assert.equal(active.status, 200);
  assert.equal(active.body.data.length, 1);
  assert.equal(active.body.data[0].name, 'Turbine overheat rule');

  // Dry run: 5-reading window, so six values produce two alerts.
  const dryRun = await request(app).post(`/api/graphs/${ID_A}/test`).send({ values: [70, 85, 90, 95, 99, 100] });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.data.dryRun, true);
  assert.equal(dryRun.body.data.delivered, 6);
  assert.equal(dryRun.body.data.alertCount, 2);
  assert.equal(dryRun.body.data.alerts[0].type, 'smsAlert');
  assert.equal(Number(dryRun.body.data.alerts[0].value.toFixed(2)), 87.8);

  // Bad test payloads.
  assert.equal((await request(app).post(`/api/graphs/${ID_A}/test`).send({ values: [] })).status, 400);
  assert.equal((await request(app).post(`/api/graphs/${ID_A}/test`).send({ values: [1, 2, 'x'] })).status, 400);
  assert.equal((await request(app).post(`/api/graphs/${ID_B}/test`).send({ values: [1] })).status, 404);

  // Deactivate twice: first ok, then 404.
  assert.equal((await request(app).post(`/api/graphs/${ID_A}/deactivate`)).status, 200);
  assert.equal((await request(app).post(`/api/graphs/${ID_A}/deactivate`)).status, 404);
  assert.equal((await request(app).get('/api/graphs/active')).body.data.length, 0);
});

test('recompiling replaces the previous pipeline instead of leaking it', async (t) => {
  stubGraphs({ [ID_A]: sample });
  t.after(() => {
    Graph.findById = originalFindById;
    activeGraphManager.disposeAll();
  });

  await request(app).post(`/api/graphs/${ID_A}/compile`);
  await request(app).post(`/api/graphs/${ID_A}/compile`);
  const active = await request(app).get('/api/graphs/active');
  assert.equal(active.body.data.length, 1, 'recompiling must not create a second entry');
  assert.equal(active.body.data[0].subscriptions, 1);
});

test('compiling an invalid graph returns 400 with the validator issues', async (t) => {
  stubGraphs({
    [ID_B]: {
      name: 'broken',
      nodes: [
        { id: 'a', type: 'sensor', position: { x: 0, y: 0 }, data: { config: {} } },
        { id: 'b', type: 'movingAverage', position: { x: 0, y: 0 }, data: { config: { windowSize: 3 } } },
        { id: 'c', type: 'threshold', position: { x: 0, y: 0 }, data: { config: { operator: '>', value: 1 } } },
      ],
      // a -> b -> c -> b : a genuine loop built from category-valid edges.
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
        { id: 'e3', source: 'c', target: 'b' },
      ],
    },
  });
  t.after(() => {
    Graph.findById = originalFindById;
    activeGraphManager.disposeAll();
  });

  const response = await request(app).post(`/api/graphs/${ID_B}/compile`);
  assert.equal(response.status, 400);
  assert.equal(response.body.error.message, 'Graph is not valid.');
  const codes = response.body.error.details.map((issue) => issue.code);
  assert.ok(codes.includes('cycle'), `expected a cycle error, got ${codes.join(', ')}`);
  assert.ok(codes.includes('too_many_inputs'), 'node b has two inputs');

  // An edge into a source node is rejected with a dedicated message.
  const intoSource = await request(app).post('/api/graphs/validate').send({
    nodes: [
      { id: 's1', type: 'sensor', position: { x: 0, y: 0 }, data: { config: {} } },
      { id: 's2', type: 'sensor', position: { x: 0, y: 0 }, data: { config: {} } },
    ],
    edges: [{ id: 'e1', source: 's1', target: 's2' }],
  });
  assert.equal(intoSource.status, 200);
  assert.ok(intoSource.body.errors.some((issue) => issue.code === 'source_has_input'));
});

test('POST /api/graphs/validate checks raw JSON without saving', async () => {
  const valid = await request(app).post('/api/graphs/validate').send(sample);
  assert.equal(valid.status, 200);
  assert.equal(valid.body.valid, true);
  assert.equal(valid.body.summary.nodeCount, 4);

  const invalid = await request(app).post('/api/graphs/validate').send({ nodes: [{ id: 'a', type: 'nope' }], edges: [] });
  assert.equal(invalid.status, 200);
  assert.equal(invalid.body.valid, false);
  assert.ok(invalid.body.errors.some((issue) => issue.code === 'unknown_type'));

  // Malformed bodies are 400, not 200.
  assert.equal((await request(app).post('/api/graphs/validate').send({ nodes: [] })).status, 400);
  assert.equal((await request(app).post('/api/graphs/validate').send({ nope: true })).status, 400);
});
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
    defaultConfig: { phone: '+911234567890', messageTemplate: 'ALERT ${deviceId} ${sensorType} = ${value}${unit}' },
    fields: [
      { key: 'phone', label: 'Phone', type: 'text', placeholder: '+911234567890' },
      { key: 'messageTemplate', label: 'Message', type: 'text', placeholder: 'ALERT ${deviceId} = ${value}${unit}' },
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
    defaultConfig: { url: 'https://example.com/hook', method: 'POST' },
    fields: [
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com/hook' },
      { key: 'method', label: 'Method', type: 'select', options: ['POST', 'PUT', 'PATCH'] },
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
    defaultConfig: { label: 'pipeline', template: '${deviceId} ${sensorType} = ${value}${unit}' },
    fields: [
      { key: 'label', label: 'Prefix', type: 'text', placeholder: 'pipeline' },
      { key: 'template', label: 'Template', type: 'text', placeholder: '${deviceId} = ${value}${unit}' },
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

### `client/src/components/nodes/fields.jsx`

```jsx
import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { NODE_TYPES } from './definitions.js';

/**
 * Returns a setter that writes one key of `data.config` back into React Flow state.
 *
 * Uses `updateNodeData`, which merges into the node's data, so the rest of the node
 * (label, category, ...) and the other config keys are preserved.
 */
export function useNodeConfig(id, data) {
  const { updateNodeData } = useReactFlow();
  return useCallback((key, value) => {
    updateNodeData(id, { config: { ...(data?.config ?? {}), [key]: value } });
  }, [id, data?.config, updateNodeData]);
}

/**
 * A single labelled config input.
 *
 * `nodrag` / `nopan` keep React Flow from panning or starting a selection while the user
 * types or scrolls inside a node.
 */
export function ConfigField({ field, value, onChange }) {
  const inputClass = `node-input nodrag nopan ${field.type === 'select' ? 'is-select' : ''}`;
  return (
    <label className="node-field nodrag">
      <span>{field.label}</span>
      {field.type === 'select' ? (
        <select className={inputClass} value={value ?? ''} onChange={(event) => onChange(field.key, event.target.value)}>
          {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : field.type === 'number' ? (
        <input
          className={inputClass}
          type="number"
          value={value ?? ''}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(field.key, raw === '' ? '' : Number(raw));
          }}
        />
      ) : (
        <input
          className={inputClass}
          type="text"
          value={value ?? ''}
          placeholder={field.placeholder}
          maxLength={field.key === 'messageTemplate' || field.key === 'template' ? 240 : 120}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      )}
    </label>
  );
}

/** Renders the configured fields of a node definition. */
export function ConfigFields({ id, type, data }) {
  const definition = NODE_TYPES[type];
  const setConfig = useNodeConfig(id, data);
  if (!definition) return null;
  return (
    <div className="node-fields">
      {definition.fields.map((field) => (
        <ConfigField key={field.key} field={field} value={data?.config?.[field.key]} onChange={setConfig} />
      ))}
    </div>
  );
}
```

### `client/src/components/nodes/NodeCard.jsx`

```jsx
import { Handle, Position } from '@xyflow/react';
import { ArrowUpRight } from 'lucide-react';
import { CATEGORIES, getDefinition } from './definitions.js';

/**
 * Shared card shell for every custom node.
 *
 * Handles are driven by the node definition: sources expose only an output, actions only
 * an input, math nodes both. Children are the node's config fields.
 */
export default function NodeCard({ id, type, data, selected, children, badge }) {
  const definition = getDefinition(type);
  const category = definition?.category ?? data?.category ?? 'source';
  const meta = CATEGORIES[category] ?? CATEGORIES.source;
  const Icon = definition?.icon;

  return (
    <div className={`flow-node ${category} ${selected ? 'is-selected' : ''}`} data-node-type={type}>
      {definition?.hasInput && <Handle type="target" position={Position.Left} aria-label="Input connection" />}

      <div className="flow-node-top">
        <span><i style={{ background: meta.color }} />{meta.label.toUpperCase()}</span>
        <ArrowUpRight size={14} />
      </div>

      <div className="flow-node-main">
        {Icon && (
          <span className={`node-icon ${category}`}>
            <Icon size={20} strokeWidth={1.8} />
          </span>
        )}
        <div className="node-headings">
          <strong>{data?.label || definition?.label || 'Node'}</strong>
          <small>{badge ?? data?.description ?? definition?.description}</small>
        </div>
      </div>

      {children}

      <div className="flow-node-footer">
        <span>{definition?.tag ?? 'FLOW NODE'}</span>
        <span className="node-footer-dots">···</span>
      </div>

      {definition?.hasOutput && <Handle type="source" position={Position.Right} aria-label="Output connection" />}
    </div>
  );
}
```

### `client/src/components/nodes/SensorNode.jsx`

```jsx
import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Data source: the entry point of a pipeline. Only has an output handle. */
export default function SensorNode({ id, data, selected }) {
  const deviceId = data?.config?.deviceId ?? 'unknown';
  const sensorType = data?.config?.sensorType ?? 'unknown';
  return (
    <NodeCard id={id} type="sensor" data={data} selected={selected} badge={`${deviceId} · ${sensorType}`}>
      <ConfigFields id={id} type="sensor" data={data} />
    </NodeCard>
  );
}
```

### `client/src/components/nodes/MovingAverageNode.jsx`

```jsx
import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Math: sliding-window average over `windowSize` readings. */
export default function MovingAverageNode({ id, data, selected }) {
  const windowSize = data?.config?.windowSize ?? 5;
  return (
    <NodeCard id={id} type="movingAverage" data={data} selected={selected} badge={`average of last ${windowSize} readings`}>
      <ConfigFields id={id} type="movingAverage" data={data} />
    </NodeCard>
  );
}
```

### `client/src/components/nodes/ThresholdNode.jsx`

```jsx
import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Math: forwards a reading only when `value <operator> threshold`. */
export default function ThresholdNode({ id, data, selected }) {
  const operator = data?.config?.operator ?? '>';
  const value = data?.config?.value ?? 0;
  return (
    <NodeCard id={id} type="threshold" data={data} selected={selected} badge={`fires when value ${operator} ${value}`}>
      <ConfigFields id={id} type="threshold" data={data} />
    </NodeCard>
  );
}
```

### `client/src/components/nodes/ScaleNode.jsx`

```jsx
import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Math: unit conversion / calibration, `value * factor + offset`. */
export default function ScaleNode({ id, data, selected }) {
  const factor = data?.config?.factor ?? 1;
  const offset = data?.config?.offset ?? 0;
  return (
    <NodeCard id={id} type="scale" data={data} selected={selected} badge={`value × ${factor} + ${offset}`}>
      <ConfigFields id={id} type="scale" data={data} />
    </NodeCard>
  );
}
```

### `client/src/components/nodes/SmsAlertNode.jsx`

```jsx
import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Action: mock SMS gateway (logs the message and stores an alert). */
export default function SmsAlertNode({ id, data, selected }) {
  const phone = data?.config?.phone ?? '';
  return (
    <NodeCard id={id} type="smsAlert" data={data} selected={selected} badge={phone ? `to ${phone}` : 'set a phone number'}>
      <ConfigFields id={id} type="smsAlert" data={data} />
    </NodeCard>
  );
}
```

### `client/src/components/nodes/WebhookNode.jsx`

```jsx
import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Action: HTTP call with a 3 second timeout; failures never break the pipeline. */
export default function WebhookNode({ id, data, selected }) {
  const method = data?.config?.method ?? 'POST';
  const url = data?.config?.url ?? '';
  return (
    <NodeCard id={id} type="webhook" data={data} selected={selected} badge={`${method} ${url}`}>
      <ConfigFields id={id} type="webhook" data={data} />
    </NodeCard>
  );
}
```

### `client/src/components/nodes/LogNode.jsx`

```jsx
import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Action: prints the reading to the server console — the cheapest way to debug a graph. */
export default function LogNode({ id, data, selected }) {
  const prefix = data?.config?.label ?? 'pipeline';
  return (
    <NodeCard id={id} type="log" data={data} selected={selected} badge={`console · ${prefix}`}>
      <ConfigFields id={id} type="log" data={data} />
    </NodeCard>
  );
}
```

### `client/src/components/nodes/index.js`

```js
/**
 * Node type registry for React Flow.
 *
 * IMPORTANT: `nodeTypes` is created once at module scope. Defining it inside a component
 * would give React Flow a new object on every render and remount every node.
 */
import FlowNode from '../canvas/FlowNode.jsx';
import LogNode from './LogNode.jsx';
import MovingAverageNode from './MovingAverageNode.jsx';
import ScaleNode from './ScaleNode.jsx';
import SensorNode from './SensorNode.jsx';
import SmsAlertNode from './SmsAlertNode.jsx';
import ThresholdNode from './ThresholdNode.jsx';
import WebhookNode from './WebhookNode.jsx';

export const nodeTypes = {
  // "nexus" is the Day 1 generic node, kept so graphs saved before Day 2 still render.
  nexus: FlowNode,
  sensor: SensorNode,
  movingAverage: MovingAverageNode,
  threshold: ThresholdNode,
  scale: ScaleNode,
  smsAlert: SmsAlertNode,
  webhook: WebhookNode,
  log: LogNode,
};

export { default as NodeCard } from './NodeCard.jsx';
export { ConfigField, ConfigFields, useNodeConfig } from './fields.jsx';
export * from './definitions.js';
```

### `client/src/components/canvas/graphRules.js`

```js
import { getDefinition } from '../nodes/definitions.js';

/**
 * Client-side graph rules.
 *
 * These mirror `server/src/compiler/graphValidator.js` so the editor can give instant
 * feedback; the backend always re-validates before compiling, so it stays authoritative.
 */

/** Is `to` reachable from `from` by following edges? (used for cycle prevention) */
export function hasPath(edges, from, to) {
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source).push(edge.target);
  }
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const current = queue.shift();
    if (current === to) return true;
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/**
 * Can these two nodes be connected?
 *
 * Allowed flows: Source -> Math -> ... -> Math -> Action, and Source -> Action.
 *
 * @param {{ source: string, target: string }} connection
 * @param {any[]} nodes
 * @param {any[]} edges
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateConnection(connection, nodes, edges) {
  const { source, target } = connection ?? {};
  if (!source || !target) return { valid: false, reason: 'Incomplete connection.' };
  if (source === target) return { valid: false, reason: 'A node cannot connect to itself.' };

  const from = nodes.find((node) => node.id === source);
  const to = nodes.find((node) => node.id === target);
  if (!from || !to) return { valid: false, reason: 'Unknown node.' };

  const fromDefinition = getDefinition(from.type);
  const toDefinition = getDefinition(to.type);
  if (!fromDefinition || !toDefinition) return { valid: false, reason: 'Unknown node type.' };

  if (!fromDefinition.hasOutput) return { valid: false, reason: `${fromDefinition.label} nodes have no output.` };
  if (!toDefinition.hasInput) return { valid: false, reason: `${toDefinition.label} nodes have no input.` };

  if (edges.some((edge) => edge.source === source && edge.target === target)) {
    return { valid: false, reason: 'These nodes are already connected.' };
  }
  if (hasPath(edges, target, source)) {
    return { valid: false, reason: 'That connection would create a loop.' };
  }
  return { valid: true };
}

/**
 * Full graph check for the "Validate graph" button.
 *
 * @param {any[]} nodes
 * @param {any[]} edges
 * @returns {{ ok: boolean, errors: object[], warnings: object[] }}
 */
export function validateGraph(nodes, edges) {
  /** @type {object[]} */
  const errors = [];
  /** @type {object[]} */
  const warnings = [];

  if (nodes.length === 0) {
    return { ok: false, errors: [{ code: 'empty_graph', message: 'The canvas is empty. Add a data source to begin.' }], warnings };
  }

  for (const node of nodes) {
    const definition = getDefinition(node.type);
    if (!definition) {
      errors.push({ code: 'unknown_type', nodeId: node.id, message: `Node "${node.id}" has unknown type "${node.type}".` });
      continue;
    }
    const incoming = edges.filter((edge) => edge.target === node.id).length;
    const outgoing = edges.filter((edge) => edge.source === node.id).length;

    if (incoming > 1) {
      errors.push({ code: 'too_many_inputs', nodeId: node.id, message: `${definition.label} "${node.id}" has ${incoming} inputs; only one is supported.` });
    }
    if (definition.category !== 'source' && incoming === 0) {
      errors.push({ code: 'disconnected_node', nodeId: node.id, message: `${definition.label} is not connected to any input.` });
    }
    if (definition.category === 'source' && outgoing === 0) {
      warnings.push({ code: 'dangling_source', nodeId: node.id, message: `${definition.label} output is not connected to anything.` });
    }
    if (definition.category !== 'action' && outgoing === 0 && incoming > 0) {
      warnings.push({ code: 'dangling_output', nodeId: node.id, message: `${definition.label} output is not connected to anything.` });
    }
  }

  for (const edge of edges) {
    const check = { source: edge.source, target: edge.target };
    if (!(nodes.some((node) => node.id === edge.source) && nodes.some((node) => node.id === edge.target))) {
      errors.push({ code: 'dangling_edge', edgeId: edge.id, message: `Edge "${edge.id}" points at a missing node.` });
      continue;
    }
    // Existing edges were created before the rules ran, so re-check them here.
    if (edge.source !== edge.target) {
      const result = validateConnection(check, nodes, edges.filter((item) => item.id !== edge.id));
      if (!result.valid && result.reason !== 'These nodes are already connected.') {
        errors.push({ code: 'invalid_edge', edgeId: edge.id, message: `Edge "${edge.id}" is not valid: ${result.reason}` });
      }
    }
  }

  const sources = nodes.filter((node) => getDefinition(node.type)?.category === 'source');
  const actions = nodes.filter((node) => getDefinition(node.type)?.category === 'action');
  if (sources.length === 0) errors.push({ code: 'no_source', message: 'Add at least one data source node.' });
  if (actions.length === 0) errors.push({ code: 'no_action', message: 'Add at least one action trigger (SMS, webhook or log).' });

  return { ok: errors.length === 0, errors, warnings };
}
```

### `client/src/components/ValidationPanel.jsx`

```jsx
import { CheckCircle2, ChevronDown, Info, TriangleAlert, X } from 'lucide-react';

/**
 * Result panel for the "Validate graph" button.
 *
 * Errors block compilation (they mirror the backend validator); warnings are advisory.
 */
export default function ValidationPanel({ result, source, onClose, onSelectNode }) {
  if (!result) return null;
  const { errors = [], warnings = [] } = result;
  const ok = errors.length === 0;

  return (
    <section className={`validation-panel ${ok ? 'is-valid' : 'is-invalid'}`} aria-live="polite">
      <header className="validation-head">
        <span className="validation-title">
          {ok ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
          <strong>{ok ? 'Graph is valid' : `${errors.length} problem${errors.length === 1 ? '' : 's'} found`}</strong>
          {source === 'backend' && <span className="validation-source">checked by backend</span>}
          {source === 'local' && <span className="validation-source">checked in browser</span>}
        </span>
        <button className="icon-button small" onClick={onClose} aria-label="Close validation panel"><X size={15} /></button>
      </header>

      {ok && warnings.length === 0 && (
        <p className="validation-ok">Every node is connected, there are no loops and the graph has a source and an action.</p>
      )}

      {errors.length > 0 && (
        <ul className="validation-list errors">
          {errors.map((issue, index) => (
            <li key={`error-${index}`}>
              <TriangleAlert size={13} />
              <span>{issue.message}</span>
              {issue.nodeId && onSelectNode && (
                <button className="validation-link" onClick={() => onSelectNode(issue.nodeId)}>Show node</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <details className="validation-warnings" open={errors.length === 0}>
          <summary><ChevronDown size={13} /> {warnings.length} warning{warnings.length === 1 ? '' : 's'}</summary>
          <ul className="validation-list warnings">
            {warnings.map((issue, index) => (
              <li key={`warning-${index}`}>
                <Info size={13} />
                <span>{issue.message}</span>
                {issue.nodeId && onSelectNode && (
                  <button className="validation-link" onClick={() => onSelectNode(issue.nodeId)}>Show node</button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
```

### `client/src/services/graphSerializer.js`

```js
/**
 * Graph serialization.
 *
 * The editor keeps a lot of runtime state on nodes and edges (measurements, selection,
 * dragging, styling). Only the fields the compiler needs are persisted, which keeps the
 * saved JSON clean and stable:
 *
 *   { name, nodes: [{ id, type, data, position }], edges: [{ id, source, target }], viewport }
 */

/** Keep only the persisted fields of a React Flow node. */
export function serializeNode(node) {
  return {
    id: node.id,
    type: node.type,
    position: { x: Number(node.position?.x ?? 0), y: Number(node.position?.y ?? 0) },
    data: {
      kind: node.data?.kind ?? node.type,
      label: node.data?.label,
      category: node.data?.category,
      description: node.data?.description,
      config: { ...(node.data?.config ?? {}) },
    },
  };
}

/** Keep only the persisted fields of a React Flow edge. */
export function serializeEdge(edge) {
  return { id: edge.id, source: edge.source, target: edge.target };
}

/**
 * Build the clean JSON that is sent to `POST /api/graphs`.
 *
 * @param {string} name graph name
 * @param {any[]} nodes React Flow nodes
 * @param {any[]} edges React Flow edges
 * @param {{x: number, y: number, zoom: number}} [viewport]
 */
export function serializeGraph(name, nodes, edges, viewport) {
  const payload = {
    name: (name ?? '').trim() || 'Untitled graph',
    nodes: nodes.map(serializeNode),
    edges: edges.map(serializeEdge),
  };
  if (viewport && Number.isFinite(viewport.zoom)) {
    payload.viewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
  }
  return payload;
}

/** Pretty-printed JSON, ready to download or copy. */
export const toJsonString = (graph) => JSON.stringify(graph, null, 2);

/** Trigger a browser download for the graph JSON. */
export function downloadJson(graph, filename) {
  const blob = new Blob([toJsonString(graph)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Filesystem-safe filename derived from the graph name. */
export function graphFilename(name, extension = 'json') {
  const slug = (name ?? 'graph')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'nexusflow-graph'}.${extension}`;
}

/** Copy text to the clipboard, falling back to a hidden textarea on insecure origins. */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
```

## Modified files

### `server/package.json`

*scripts: added vitest and split test targets*

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
    "benchmark": "node scripts/benchmark.js",
    "test": "vitest run && node --test test/validation.test.js test/integration.test.js test/compilerRoutes.test.js",
    "test:compiler": "vitest run",
    "test:http": "node --test test/validation.test.js test/integration.test.js test/compilerRoutes.test.js"
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

### `server/src/routes/graphRoutes.js`

*added /active, /validate, /:id/compile, /:id/deactivate, /:id/test*

```js
import { Router } from 'express';
import {
  compileGraphHandler,
  createGraph,
  deactivateGraphHandler,
  deleteGraph,
  getGraph,
  listActiveGraphs,
  listGraphs,
  testGraphHandler,
  updateGraph,
  validateGraphJson,
} from '../controllers/graphController.js';
import { asyncHandler, validate } from '../middleware/validate.js';
import { graphIdSchema, graphSchema } from '../validation/graph.js';
import { rawGraphSchema, testGraphSchema } from '../validation/compile.js';

const router = Router();

// Static paths must be declared BEFORE "/:id" so they are not captured by the param route.
router.route('/active').get(asyncHandler(listActiveGraphs));
router.route('/validate').post(validate(rawGraphSchema), asyncHandler(validateGraphJson));

router.route('/')
  .post(validate(graphSchema), asyncHandler(createGraph))
  .get(asyncHandler(listGraphs));

// All "/:id" routes share the ObjectId param check.
const byId = router.route('/:id').all(validate(graphIdSchema, 'params'));
byId.get(asyncHandler(getGraph))
  .put(validate(graphSchema), asyncHandler(updateGraph))
  .delete(asyncHandler(deleteGraph));

router.route('/:id/compile').all(validate(graphIdSchema, 'params')).post(asyncHandler(compileGraphHandler));
router.route('/:id/deactivate').all(validate(graphIdSchema, 'params')).post(asyncHandler(deactivateGraphHandler));
router.route('/:id/test')
  .all(validate(graphIdSchema, 'params'))
  .post(validate(testGraphSchema), asyncHandler(testGraphHandler));

export default router;
```

### `server/src/controllers/graphController.js`

*added validateGraphJson, compileGraphHandler, deactivateGraphHandler, listActiveGraphs, testGraphHandler*

```js
import { Graph } from '../models/Graph.js';
import { compileGraph, validateGraph, GraphValidationError } from '../compiler/index.js';
import { activeGraphManager } from '../services/activeGraphManager.js';
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
      return res.status(400).json({ error: { message: 'Graph is not valid.', details: error.errors, warnings: error.warnings } });
    }
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

### `server/src/controllers/telemetryController.js`

*publish accepted readings into the active pipelines*

```js
import { Telemetry } from '../models/Telemetry.js';
import { broadcastTelemetry } from '../services/websocket.js';
import { activeGraphManager } from '../services/activeGraphManager.js';

async function insertAndAccept(readings, res, single = false) {
  // Zod has already validated/cast the complete payload. lean avoids a second
  // Mongoose hydration/validation pass on this high-throughput path.
  const inserted = await Telemetry.insertMany(readings, { ordered: false, lean: true });
  res.status(202).json({ accepted: inserted.length });
  // Fan-out is best-effort and must never delay or fail the HTTP response:
  // (1) push the readings to the browser, (2) feed every active RxJS pipeline.
  setImmediate(() => {
    try { broadcastTelemetry(single ? inserted[0] : inserted); }
    catch (error) { console.error('WebSocket broadcast failed:', error.message); }
    try { activeGraphManager.publish(inserted); }
    catch (error) { console.error('Failed to publish readings to active graphs:', error.message); }
  });
}

export async function ingestReading(req, res) {
  await insertAndAccept([res.locals.validated.body], res, true);
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
```

### `server/src/services/websocket.js`

*shared broadcast() helper + broadcastAlert()*

```js
import { WebSocket, WebSocketServer } from 'ws';

let socketServer;
const maxBufferedBytes = 1024 * 1024;

export function attachWebSocketServer(httpServer) {
  socketServer = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 64 * 1024 });
  socketServer.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('error', (error) => console.error('WebSocket error:', error.message));
    socket.send(JSON.stringify({ type: 'connected', data: { message: 'Connected to NexusFlow' } }));
  });
  socketServer.on('error', (error) => console.error('WebSocket server error:', error.message));

  // Remove broken connections; unref prevents this timer from keeping Node alive.
  const heartbeat = setInterval(() => {
    for (const socket of socketServer.clients) {
      if (!socket.isAlive) socket.terminate();
      else { socket.isAlive = false; socket.ping(); }
    }
  }, 30_000);
  heartbeat.unref();
  socketServer.on('close', () => clearInterval(heartbeat));
  return socketServer;
}

/**
 * Best-effort fan-out. A slow or dead client must never block ingestion or make the
 * server buffer unbounded data, so anything over `maxBufferedBytes` is skipped.
 *
 * @param {string} type message type, for example "telemetry" or "alert"
 * @param {unknown} data payload
 */
function broadcast(type, data) {
  if (!socketServer || socketServer.clients.size === 0) return;
  const message = JSON.stringify({ type, data });
  for (const socket of socketServer.clients) {
    if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > maxBufferedBytes) continue;
    socket.send(message, (error) => {
      if (error) console.error('WebSocket broadcast failed:', error.message);
    });
  }
}

/** Push freshly ingested telemetry to every connected client. */
export function broadcastTelemetry(data) {
  broadcast('telemetry', data);
}

/** Push an alert raised by a compiled pipeline to every connected client. */
export function broadcastAlert(data) {
  broadcast('alert', data);
}
```

### `server/src/server.js`

*dispose active pipelines on shutdown*

```js
import http from 'node:http';
import mongoose from 'mongoose';
import app from './app.js';
import { connectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { attachWebSocketServer } from './services/websocket.js';
import { activeGraphManager } from './services/activeGraphManager.js';

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
  // Release every compiled pipeline before the process exits.
  activeGraphManager.disposeAll();
  await mongoose.disconnect();
  clearTimeout(forceExit);
}

process.on('SIGINT', () => { shutdown('SIGINT').catch(console.error); });
process.on('SIGTERM', () => { shutdown('SIGTERM').catch(console.error); });

try {
  await connectDatabase();
  server = http.createServer(app);
  sockets = attachWebSocketServer(server);
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

### `client/src/components/canvas/nodeLibrary.js`

*re-exports the Day 2 node definitions*

```js
/**
 * Day 2: the node catalogue now lives in components/nodes/definitions.js (one place for
 * the palette, the canvas and the backend compiler).
 *
 * This module stays as the import path used by Day 1 components (palette, inspector and
 * the legacy generic node) so no earlier code had to change.
 */
export {
  CATEGORIES,
  NODE_TYPES as nodeDefinitions,
  PALETTE_GROUPS as groups,
  getDefinition,
  initialEdges,
  initialNodes,
  makeNode,
  nextNodeId,
} from '../nodes/definitions.js';
```

### `client/src/components/canvas/NodePalette.jsx`

*palette groups now carry default config per entry*

```jsx
import { GripVertical, MousePointer2, Search, X } from 'lucide-react';
import { useState } from 'react';
import { PALETTE_GROUPS, getDefinition } from '../nodes/definitions.js';

/**
 * Left sidebar: every palette entry is draggable (HTML5 drag & drop, read by the canvas)
 * and clickable (drops the node in the middle of the viewport).
 */
export default function NodePalette({ onAddNode }) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const matches = PALETTE_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(query)),
  })).filter((group) => group.items.length);

  function startDrag(event, item) {
    event.dataTransfer.setData('application/nexusflow-node', JSON.stringify({ type: item.type, config: item.config }));
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <aside className="palette" aria-label="Node palette">
      <div className="palette-heading">
        <span className="eyebrow"><span className="eyebrow-line" /> THE BUILDING BLOCKS</span>
        <h2>Node palette<span className="heading-period">.</span></h2>
        <p>Drag a node onto the canvas to start building your flow.</p>
        <label className="palette-search">
          <Search size={15} aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a node..." aria-label="Find a node" />
          {search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}
          {!search && <span className="search-shortcut">/</span>}
        </label>
      </div>

      <div className="palette-groups">
        {matches.length === 0 && <p className="palette-empty">No nodes match “{search}”.</p>}
        {matches.map((group) => (
          <section className="palette-group" key={group.id}>
            <div className="group-heading"><h3>{group.label}</h3><span>{String(group.items.length).padStart(2, '0')}</span></div>
            <div className="palette-items">
              {group.items.map((item) => {
                const definition = getDefinition(item.type);
                const Icon = definition?.icon;
                return (
                  <button
                    type="button"
                    className={`palette-item ${definition?.category ?? ''}`}
                    key={`${group.id}-${item.label}`}
                    draggable
                    onDragStart={(event) => startDrag(event, item)}
                    onClick={() => onAddNode(item.type, item.config)}
                    title={`Drag or click to add ${item.label}`}
                  >
                    <span className={`node-icon ${definition?.category ?? ''}`}>
                      {Icon ? <Icon size={18} strokeWidth={1.8} /> : null}
                    </span>
                    <span className="palette-item-copy">
                      <strong>{item.label}</strong>
                      <small className="truncate">{item.description}</small>
                    </span>
                    <GripVertical className="grip" size={15} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="palette-tip">
        <span className="tip-icon"><MousePointer2 size={15} /></span>
        <div><strong>A little tip</strong><p>Drag to add, or click a node to place it on your canvas.</p></div>
      </div>
      <div className="palette-footer"><span>YOUR IDEAS, CONNECTED</span><span>✳</span></div>
    </aside>
  );
}
```

### `client/src/components/canvas/FlowCanvas.jsx`

*registers nodeTypes + isValidConnection / onConnectEnd*

```jsx
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import { MousePointer2, Sparkles } from 'lucide-react';
import { useCallback } from 'react';
import { nodeTypes } from '../nodes/index.js';
import { validateConnection } from './graphRules.js';

const edgeOptions = { type: 'smoothstep', style: { stroke: '#94aaa9', strokeWidth: 2 } };

/**
 * Central canvas.
 *
 * `nodeTypes` comes from a module-level constant (never recreated inside a component),
 * and `isValidConnection` refuses illegal links while the user is still dragging.
 */
export default function FlowCanvas({ nodes, edges, onNodesChange, onEdgesChange, onConnect, onDrop, onInvalidConnection, canvasRef }) {
  // Pure: React Flow calls this repeatedly while dragging, so it must not have side effects.
  const isValidConnection = useCallback(
    (connection) => validateConnection(connection, nodes, edges).valid,
    [nodes, edges],
  );

  // Report *why* a link was refused only once, when the drag ends on an invalid target.
  const handleConnectEnd = useCallback((event, connectionState) => {
    if (connectionState?.isValid !== false) return;
    const source = connectionState?.fromNode?.id;
    const target = connectionState?.toNode?.id;
    if (!source || !target) return;
    const result = validateConnection({ source, target }, nodes, edges);
    onInvalidConnection?.(result.reason ?? 'That connection is not allowed.');
  }, [nodes, edges, onInvalidConnection]);

  return (
    <div className="canvas-wrap" ref={canvasRef} onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={handleConnectEnd}
        isValidConnection={isValidConnection}
        defaultEdgeOptions={edgeOptions}
        connectionLineStyle={{ stroke: '#418d8a', strokeWidth: 2 }}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={2}
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="#cbd8d7" />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeStrokeWidth={3}
          nodeColor={(node) => (node.data?.category === 'math' ? '#cddff6' : node.data?.category === 'action' ? '#f5ddc4' : '#bfe4db')}
          maskColor="rgba(242, 247, 246, .72)"
        />
      </ReactFlow>
      <div className="canvas-label select-none"><span className="canvas-label-icon"><Sparkles size={13} /></span><span>YOUR WORKSPACE</span><i /><span>READY TO CREATE</span></div>
      <div className="canvas-hint select-none"><MousePointer2 size={14} /> <span>Drag to pan</span><i /> <span>Scroll to zoom</span></div>
    </div>
  );
}
```

### `client/src/components/layout/Navbar.jsx`

*added Validate graph and Export JSON*

```jsx
import { ChevronRight, Download, FolderOpen, LoaderCircle, Save, ShieldCheck } from 'lucide-react';

/**
 * Top toolbar: health indicator, Load / Validate / Export / Save.
 */
export default function Navbar({ health, onSave, onLoad, onValidate, onExport, saving, validating }) {
  const healthText = health === 'online' ? 'Backend connected' : health === 'offline' ? 'Backend offline' : 'Checking backend';
  return (
    <header className="navbar">
      <div className="brand select-none">
        <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
        <div className="brand-copy"><strong>NexusFlow<span>.</span></strong><small>VISUAL IOT WORKSPACE</small></div>
      </div>
      <div className="nav-breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>Flow editor</strong></div>
      <div className="nav-actions">
        <div className={`health ${health}`} role="status"><span className="health-dot" />{healthText}</div>
        <div className="nav-divider" />
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

### `client/src/pages/EditorPage.jsx`

*config-aware add/drop, clean serialization, validation, export*

```jsx
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
import { errorMessage, graphApi } from '../services/api.js';
import { copyText, downloadJson, graphFilename, serializeGraph, toJsonString } from '../services/graphSerializer.js';
import { useTelemetry } from '../services/useTelemetry.js';

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
  const canvasRef = useRef(null);
  const nameRef = useRef(null);
  const exportRef = useRef('');
  const flow = useReactFlow();
  const { socketStatus, readings } = useTelemetry();
  const selectedNode = nodes.find((node) => node.selected);

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
      await graphApi.create(payload);
      setName(payload.name);
      setNotice({ type: 'success', message: `Graph saved with ${payload.nodes.length} nodes and ${payload.edges.length} edges.` });
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
### `client/src/services/api.js`

*added validate / compile / deactivate / active / test helpers*

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

export function errorMessage(error) {
  return error.response?.data?.error?.message
    || (error.code === 'ECONNABORTED' ? 'The request timed out.' : 'Cannot reach the backend. Check that the server and MongoDB are running.');
}

/** Backend validation issues, when the API returned a 400 with details. */
export function errorDetails(error) {
  return Array.isArray(error.response?.data?.error?.details) ? error.response.data.error.details : [];
}
```

### `client/src/index.css` (modified — Day 2 additions only)

*appended the node-field, validation-panel and toast-action styles; everything above them is Day 1 CSS*

```css
  /* ---------------- Node config fields (Day 2) ---------------- */
  .node-headings {
    min-width: 0;
  }

  .node-headings strong {
    display: block;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.25;
  }

  .node-headings small {
    display: block;
    font-size: 11px;
    color: var(--ink-soft);
    overflow-wrap: anywhere;
  }

  .node-fields {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
  }

  .node-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .node-field > span {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  .node-input {
    width: 100%;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--page);
    font-size: 12px;
    font-weight: 500;
    color: var(--ink);
    outline: none;
    transition: border-color 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
  }

  .node-input:focus {
    border-color: var(--teal);
    background: #fff;
    box-shadow: 0 0 0 3px rgba(23, 123, 121, 0.12);
  }

  .node-input.is-select {
    appearance: none;
    cursor: pointer;
    background-image: linear-gradient(45deg, transparent 50%, var(--ink-soft) 50%), linear-gradient(135deg, var(--ink-soft) 50%, transparent 50%);
    background-position: calc(100% - 14px) 13px, calc(100% - 9px) 13px;
    background-size: 5px 5px, 5px 5px;
    background-repeat: no-repeat;
  }

  .flow-node.source {
    border-top: 3px solid #2f6fb3;
  }

  .flow-node.math {
    border-top: 3px solid #b57a1a;
  }

  .flow-node.action {
    border-top: 3px solid #b9523a;
  }

  .button-ghost {
    background: #fff;
  }

  .icon-button.small {
    width: 26px;
    height: 26px;
  }

  /* ---------------- Validation panel (Day 2) ---------------- */
  .validation-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
    background: #fff;
    box-shadow: var(--shadow-panel);
  }

  .validation-panel.is-valid {
    border-color: #bfe3d1;
    background: #f4fbf7;
  }

  .validation-panel.is-invalid {
    border-color: #f0cfc5;
    background: #fdf5f2;
  }

  .validation-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .validation-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .validation-panel.is-valid .validation-title {
    color: #1f7a52;
  }

  .validation-panel.is-invalid .validation-title {
    color: #b9523a;
  }

  .validation-source {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  .validation-ok {
    margin: 0;
    font-size: 12px;
    color: var(--ink-soft);
  }

  .validation-list {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .validation-list li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    line-height: 1.45;
  }

  .validation-list.errors li {
    color: #a4442e;
  }

  .validation-list.warnings li {
    color: #8a6a20;
  }

  .validation-link {
    margin-left: auto;
    border: none;
    background: none;
    padding: 0;
    font-size: 11px;
    font-weight: 700;
    color: var(--teal);
    text-decoration: underline;
    white-space: nowrap;
    cursor: pointer;
  }

  .validation-warnings summary {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--ink-soft);
    cursor: pointer;
  }

  .validation-warnings .validation-list {
    margin-top: 8px;
  }

  .toast-action {
    border: 1px solid currentColor;
    border-radius: 8px;
    padding: 4px 9px;
    background: transparent;
    color: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .toast-action:hover {
    background: rgba(32, 54, 64, 0.06);
  }
```

