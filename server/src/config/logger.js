import pino from 'pino';
import { env } from './env.js';

/** Structured logs only. Redaction is defensive: do not pass request bodies or provider credentials. */
export const logger = pino({
  level: env.nodeEnv === 'test' ? 'silent' : env.logLevel,
  base: { service: 'nexusflow' },
  redact: {
    paths: [
      'req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers.cookie',
      'res.headers["set-cookie"]', 'headers.authorization', 'headers["x-api-key"]',
      'headers.Authorization', 'headers["X-Api-Key"]', 'auth.password', 'auth.pass',
      'password', 'token', 'authToken', 'apiKey', 'smtp.pass',
    ],
    censor: '[REDACTED]',
  },
  serializers: { err: pino.stdSerializers.err },
});
export default logger;
