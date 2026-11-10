import { z } from 'zod';

const id = z.string().trim().min(1).max(200);
const nodeSchema = z.object({
  id,
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).passthrough(),
  data: z.record(z.unknown()),
}).passthrough();
const edgeSchema = z.object({ id, source: id, target: id }).passthrough();

export const graphSchema = z.object({
  name: z.string().trim().min(1).max(100),
  nodes: z.array(nodeSchema).max(500),
  edges: z.array(edgeSchema).max(2000),
  viewport: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    zoom: z.number().finite().positive(),
  }).optional(),
}).strict().superRefine((graph, context) => {
  const nodeIds = new Set();
  graph.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', index, 'id'], message: 'Node IDs must be unique.' });
    nodeIds.add(node.id);
  });
  const edgeIds = new Set();
  graph.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['edges', index, 'id'], message: 'Edge IDs must be unique.' });
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['edges', index], message: 'Edge endpoints must reference existing nodes.' });
    }
    edgeIds.add(edge.id);
  });
});

export const graphIdSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid graph ID.'),
});
