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
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req) => req.id,
  autoLogging: { ignore: (req) => req.url === '/api/health' },
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
