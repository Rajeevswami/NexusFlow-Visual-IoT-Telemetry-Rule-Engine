/**
 * Create an Error carrying an HTTP status code, recognised by the central error middleware.
 *
 * @param {number} status HTTP status code
 * @param {string} message human-readable message returned to the client
 * @param {object} [extra] additional fields (for example `details`)
 */
export function httpError(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}
