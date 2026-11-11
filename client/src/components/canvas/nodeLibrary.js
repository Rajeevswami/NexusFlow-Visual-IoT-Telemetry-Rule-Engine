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
