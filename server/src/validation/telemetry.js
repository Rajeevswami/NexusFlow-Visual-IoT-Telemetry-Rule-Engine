import { z } from 'zod';

const boundedText = z.string().trim().min(1).max(120);
const timestamp = z.string().datetime({ offset: true }).transform((value) => new Date(value));
const knownFields = new Set(['timestamp', 'metadata', 'value', 'unit']);

export const readingSchema = z.object({
  // A missing timestamp is captured at ingestion, not at schema construction.
  timestamp: timestamp.optional().transform((value) => value ?? new Date()),
  metadata: z.object({
    deviceId: boundedText,
    sensorType: boundedText,
    location: boundedText,
  }).strict(),
  value: z.number().finite(),
  unit: boundedText,
}).catchall(z.number().finite()).superRefine((reading, context) => {
  const extras = Object.keys(reading).filter((key) => !knownFields.has(key));
  if (extras.length > 32) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'At most 32 extra numeric measurements are allowed.' });
  }
  for (const key of extras) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Extra measurement names must start with a letter and contain only letters, digits, or underscores.' });
    }
  }
});

export const batchSchema = z.array(readingSchema).min(1).max(1000);

export const telemetryQuerySchema = z.object({
  deviceId: boundedText.optional(),
  from: timestamp.optional(),
  to: timestamp.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
}).strict().refine((query) => !query.from || !query.to || query.from <= query.to, {
  message: 'from must be earlier than or equal to to.',
  path: ['from'],
});
