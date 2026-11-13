import { z } from 'zod';
export const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID.');
export const deliveryQuerySchema = z.object({
  graphId: objectId.optional(), status: z.enum(['pending', 'success', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
}).strict();
export const deliveryIdSchema = z.object({ id: objectId });
export const nodeTestSchema = z.object({
  type: z.enum(['webhook', 'smsAlert', 'email']),
  config: z.record(z.unknown()),
  event: z.object({
    deviceId: z.string().trim().min(1).max(120).default('turbine-001'),
    sensorType: z.string().trim().min(1).max(120).default('temperature'),
    value: z.number().finite().default(82.4), unit: z.string().max(20).default('°C'),
    timestamp: z.string().datetime({ offset: true }).optional(),
    nodeId: z.string().trim().max(200).optional(),
  }).default({}),
}).strict();
export const demoStartSchema = z.object({ durationSeconds: z.coerce.number().int().min(10).max(600).default(120) }).strict();
