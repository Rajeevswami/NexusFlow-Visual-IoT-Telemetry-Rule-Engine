import { timingSafeEqual } from 'node:crypto';

/** Preserve just enough of a phone number to identify the destination. */
export function maskPhone(value) {
  const text = String(value ?? '');
  return text.length <= 4 ? '****' : `${text.startsWith('+') ? '+' : ''}******${text.slice(-4)}`;
}
export function maskEmail(value) {
  const text = String(value ?? '');
  const at = text.indexOf('@');
  return at < 1 ? '[masked email]' : `${text[0]}***${text.slice(at)}`;
}
/** URLs can contain credentials or secret query parameters. Never log or expose those. */
export function safeUrl(value) {
  try {
    const url = new URL(String(value));
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch { return '[invalid URL]'; }
}
export function safeTarget(channel, target) {
  if (channel === 'sms') return maskPhone(target);
  if (channel === 'email') return maskEmail(target);
  return safeUrl(target);
}
export function safeHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    /^(authorization|proxy-authorization|x-api-key|api-key|cookie|set-cookie|x-auth-token)$/i.test(key)
      ? '[REDACTED]' : String(value).replace(/[\r\n]+/g, ' ').slice(0, 256),
  ]));
}
export function safeError(error) {
  // Axios errors often embed the complete URL, auth config and response body.
  const code = typeof error?.code === 'string' ? error.code.slice(0, 64) : undefined;
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'Request timed out after 5000 ms.';
  if (error?.name === 'DeliveryError') return String(error.message).slice(0, 300);
  if (code) return `Outbound request failed (${code}).`;
  return 'Outbound request failed.';
}
export function secretEquals(actual, expected) {
  const a = Buffer.from(String(actual ?? ''));
  const b = Buffer.from(String(expected ?? ''));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
