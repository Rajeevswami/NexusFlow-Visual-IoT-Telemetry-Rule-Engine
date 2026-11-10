import { env } from '../config/env.js';

export function notFound(req, res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.path}`);
  error.status = 404;
  next(error);
}

export function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(error);
  const status = error.status ?? error.statusCode ?? 500;
  const safeStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  if (safeStatus >= 500) console.error(error);
  let message = safeStatus >= 500 ? 'An unexpected server error occurred.' : error.message;
  if (error.type === 'entity.parse.failed') message = 'Malformed JSON body.';
  if (error.type === 'entity.too.large') message = 'Request body is too large.';
  const response = { error: { message } };
  // Bulk writes can partially succeed even with ordered:false. Do not imply a retry is safe.
  if (error.insertedDocs?.length) response.error.insertedCount = error.insertedDocs.length;
  if (env.nodeEnv === 'development' && safeStatus >= 500) response.error.detail = error.message;
  return res.status(safeStatus).json(response);
}
