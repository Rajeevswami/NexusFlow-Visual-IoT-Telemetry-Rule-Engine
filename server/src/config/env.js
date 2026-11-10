import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/nexusflow'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  TELEMETRY_RETENTION_SECONDS: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.coerce.number().int().positive().optional(),
  ),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = {
  nodeEnv: result.data.NODE_ENV,
  port: result.data.PORT,
  mongoUri: result.data.MONGODB_URI,
  clientOrigins: result.data.CLIENT_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean),
  telemetryRetentionSeconds: result.data.TELEMETRY_RETENTION_SECONDS,
};
