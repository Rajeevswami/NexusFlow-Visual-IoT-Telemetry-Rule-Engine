import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { secretEquals } from '../utils/sanitize.js';

export const requestId = (req, res, next) => {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
const INGESTION_PATHS = new Set(['/api/telemetry', '/api/telemetry/batch']);

/**
 * Per-request log level.
 *
 * Ingestion is the hot path: one log line per request would dominate the log stream at
 * the target throughput and add I/O to the measured latency. Successful ingestion is
 * therefore silent, while failures (4xx/5xx) are still emitted at `warn` so a broken
 * deploy is visible. `customLogLevel` receives the response, which is what makes the
 * status check possible — note that `autoLogging.ignore` only receives the request.
 */
const requestLogLevel = (req, res, err) => {
  const url = req.url?.split('?')[0] ?? '';
  if (url === '/api/health') return 'silent';
  if (req.method === 'POST' && INGESTION_PATHS.has(url)) {
    return err || res.statusCode >= 400 ? 'warn' : 'silent';
  }
  return 'info';
};

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req) => req.id,
  customLogLevel: requestLogLevel,
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
const limitHandler = (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please retry later.', requestId: req.id } });
export const publicLimiter = rateLimit({ windowMs: 60_000, limit: env.apiRateLimit, standardHeaders: 'draft-7', legacyHeaders: false, handler: limitHandler });
// Mounted before publicLimiter: batch ingestion gets its own much larger budget.
export const ingestionLimiter = rateLimit({ windowMs: 60_000, limit: env.ingestRateLimit, standardHeaders: 'draft-7', legacyHeaders: false, handler: limitHandler });
export const requireIngestionKey = (req, res, next) => {
  if (!env.ingestApiKey || secretEquals(req.get('x-api-key'), env.ingestApiKey)) return next();
  return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'A valid x-api-key header is required for ingestion.', requestId: req.id } });
};
