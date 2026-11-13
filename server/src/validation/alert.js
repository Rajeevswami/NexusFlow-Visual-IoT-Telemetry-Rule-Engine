import { z } from 'zod';

/**
 * GET /api/alerts?graphId=&deviceId=&limit=
 * All filters are optional; results come back newest first.
 */
export const alertQuerySchema = z.object({
  graphId: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid graph ID.').optional(),
  deviceId: z.string().trim().min(1).max(120).optional(),
  from: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  to: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
}).strict().refine((query) => !query.from || !query.to || query.from <= query.to, { message: 'from must be earlier than or equal to to.', path: ['from'] });
