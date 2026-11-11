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
