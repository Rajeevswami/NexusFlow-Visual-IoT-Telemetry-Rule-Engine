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
