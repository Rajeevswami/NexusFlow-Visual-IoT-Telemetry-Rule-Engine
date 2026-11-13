import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export function notFound(req, res, next) {
  const error = new Error('Route not found.');
  error.status = 404;
  error.code = 'NOT_FOUND';
  next(error);
}
export function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(error);
  const status = error.status ?? error.statusCode ?? 500;
  const safeStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  if (safeStatus >= 500) logger.error({ err: error, requestId: req.id }, 'Request failed');
  let message = safeStatus >= 500 ? 'An unexpected server error occurred.' : error.message;
  let code = typeof error.code === 'string' ? error.code : 'REQUEST_FAILED';
  if (error.type === 'entity.parse.failed') { message = 'Malformed JSON body.'; code = 'INVALID_JSON'; }
  if (error.type === 'entity.too.large') { message = 'Request body is too large.'; code = 'PAYLOAD_TOO_LARGE'; }
  if (error.name === 'CastError') { message = 'Invalid resource ID.'; code = 'INVALID_ID'; }
  if (error.name === 'ValidationError') { message = 'Validation failed.'; code = 'VALIDATION_ERROR'; }
  const response = { error: { message, code, requestId: req.id } };
  if (Array.isArray(error.details)) response.error.details = error.details;
  if (Array.isArray(error.warnings)) response.error.warnings = error.warnings;
  // Bulk writes can partially succeed even with ordered:false. Do not imply a retry is safe.
  if (error.insertedDocs?.length) response.error.insertedCount = error.insertedDocs.length;
  if (env.nodeEnv === 'development' && safeStatus >= 500) response.error.detail = error.message;
  return res.status(safeStatus).json(response);
}
