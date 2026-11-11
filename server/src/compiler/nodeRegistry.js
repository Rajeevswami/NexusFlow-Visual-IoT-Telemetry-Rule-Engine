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
