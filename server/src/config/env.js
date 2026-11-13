import 'dotenv/config';
import { z } from 'zod';

const booleanFlag = (defaultValue) => z.union([z.boolean(), z.string()]).optional()
  .transform((value) => value === undefined ? defaultValue : ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase()));
const positiveInt = (defaultValue, max = 100_000) => z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.coerce.number().int().min(1).max(max).default(defaultValue),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/nexusflow'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  TELEMETRY_RETENTION_SECONDS: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.coerce.number().int().positive().optional(),
  ),
  NODE_ACTIVITY_ENABLED: booleanFlag(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  REQUEST_SIZE_LIMIT: z.string().regex(/^\d+(b|kb|mb)$/i).default('1mb'),
  API_RATE_LIMIT: positiveInt(300),
  INGEST_RATE_LIMIT: positiveInt(6000, 1_000_000),
  INGEST_API_KEY: z.string().max(512).default(''),
  ALLOW_PRIVATE_WEBHOOKS: booleanFlag(false),
  OUTBOUND_CONCURRENCY: positiveInt(4, 32),
  OUTBOUND_QUEUE_LIMIT: positiveInt(1000, 10_000),
  OUTBOUND_RATE_PER_MINUTE: positiveInt(30, 10_000),
  OUTBOUND_RETRY_BASE_MS: z.coerce.number().int().min(0).max(10_000).default(250),
  SMS_PROVIDER: z.enum(['mock', 'twilio']).default('mock'),
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_FROM: z.string().default(''),
  EMAIL_PROVIDER: z.enum(['mock', 'smtp']).default('mock'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: booleanFlag(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  EMAIL_FROM: z.string().default('nexusflow@example.com'),
  MOCK_RECEIVER_ENABLED: booleanFlag(false),
  DEMO_ENABLED: booleanFlag(false),
  DEMO_WEBHOOK_URL: z.string().default(''),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && !value.INGEST_API_KEY.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['INGEST_API_KEY'], message: 'An ingestion API key is required in production.' });
  }
  if (value.SMS_PROVIDER === 'twilio') {
    for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM']) {
      if (!value[key].trim()) context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `Required when SMS_PROVIDER=twilio.` });
    }
    if (value.TWILIO_ACCOUNT_SID && !/^AC[a-fA-F0-9]{32}$/.test(value.TWILIO_ACCOUNT_SID)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['TWILIO_ACCOUNT_SID'], message: 'Invalid Twilio account SID.' });
    }
  }
  if (value.EMAIL_PROVIDER === 'smtp' && !value.SMTP_HOST.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['SMTP_HOST'], message: 'Required when EMAIL_PROVIDER=smtp.' });
  }
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  // Never include received values: an invalid secret must not end up in a log.
  const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}
const value = result.data;
const localDemo = value.NODE_ENV !== 'production';
export const env = {
  nodeEnv: value.NODE_ENV,
  port: value.PORT,
  mongoUri: value.MONGODB_URI,
  clientOrigins: value.CLIENT_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean),
  telemetryRetentionSeconds: value.TELEMETRY_RETENTION_SECONDS,
  nodeActivityEnabled: value.NODE_ACTIVITY_ENABLED,
  logLevel: value.LOG_LEVEL,
  requestSizeLimit: value.REQUEST_SIZE_LIMIT,
  apiRateLimit: value.API_RATE_LIMIT,
  ingestRateLimit: value.INGEST_RATE_LIMIT,
  ingestApiKey: value.INGEST_API_KEY.trim(),
  allowPrivateWebhooks: value.ALLOW_PRIVATE_WEBHOOKS,
  outboundConcurrency: value.OUTBOUND_CONCURRENCY,
  outboundQueueLimit: value.OUTBOUND_QUEUE_LIMIT,
  outboundRatePerMinute: value.OUTBOUND_RATE_PER_MINUTE,
  outboundRetryBaseMs: value.OUTBOUND_RETRY_BASE_MS,
  smsProvider: value.SMS_PROVIDER,
  twilio: { accountSid: value.TWILIO_ACCOUNT_SID, authToken: value.TWILIO_AUTH_TOKEN, from: value.TWILIO_FROM },
  emailProvider: value.EMAIL_PROVIDER,
  smtp: { host: value.SMTP_HOST, port: value.SMTP_PORT, secure: value.SMTP_SECURE, user: value.SMTP_USER, pass: value.SMTP_PASS, from: value.EMAIL_FROM },
  mockReceiverEnabled: value.MOCK_RECEIVER_ENABLED || localDemo,
  demoEnabled: value.DEMO_ENABLED || localDemo,
  demoWebhookUrl: value.DEMO_WEBHOOK_URL || `http://127.0.0.1:${value.PORT}/api/mock/webhook-receiver`,
};
