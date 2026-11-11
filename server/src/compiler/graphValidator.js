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
