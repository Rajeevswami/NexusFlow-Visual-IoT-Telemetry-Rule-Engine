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
