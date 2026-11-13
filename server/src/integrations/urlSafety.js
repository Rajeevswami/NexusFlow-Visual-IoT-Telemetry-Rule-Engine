import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { env } from '../config/env.js';

export class DeliveryError extends Error {
  constructor(message, { responseCode = null, retryable = false } = {}) {
    super(message);
    this.name = 'DeliveryError';
    this.responseCode = responseCode;
    this.retryable = retryable;
  }
}

/** Includes IPv6, mapped IPv4, link-local metadata, multicast and reserved addresses. */
export function isPrivateAddress(address) {
  try {
    let parsed = ipaddr.parse(address.replace(/^\[|\]$/g, '').split('%')[0]);
    if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    return parsed.range() !== 'unicast';
  } catch { return true; }
}

/**
 * Resolve once, reject if ANY answer is private, then pin that answer into the agents.
 * Pinning closes the DNS-rebinding gap between validation and connection. The original
 * hostname remains in axios for Host headers and TLS certificate/SNI verification.
 * The explicit local-testing escape hatch is the ONLY way to reach private addresses.
 */
export async function resolveWebhookUrl(rawUrl, { allowPrivate = env.allowPrivateWebhooks, lookup = dnsLookup } = {}) {
  let url;
  try { url = new URL(String(rawUrl)); } catch { throw new DeliveryError('Invalid webhook URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new DeliveryError('Webhook URL must use http or https.');
  if (url.username || url.password) throw new DeliveryError('Credentials in webhook URLs are not allowed; use an Authorization header.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!allowPrivate && (hostname === 'localhost' || hostname.endsWith('.localhost')
    || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname === 'metadata.google.internal')) {
    throw new DeliveryError('Private webhook destinations are blocked (SSRF protection).');
  }
  let addresses;
  try {
    if (ipaddr.isValid(hostname)) addresses = [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv6' ? 6 : 4 }];
    else addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch { throw new DeliveryError('Webhook hostname could not be resolved.', { retryable: true }); }
  if (!addresses.length || (!allowPrivate && addresses.some(({ address }) => isPrivateAddress(address)))) {
    throw new DeliveryError('Private webhook destinations are blocked (SSRF protection).');
  }
  const pinned = addresses[0];
  const lookupPinned = (_hostname, options, callback) => {
    if (options?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
    else callback(null, pinned.address, pinned.family);
  };
  return {
    url: url.toString(),
    addresses,
    httpAgent: new http.Agent({ keepAlive: false, lookup: lookupPinned }),
    httpsAgent: new https.Agent({ keepAlive: false, lookup: lookupPinned }),
  };
}

export function validateHeaderObject(headers) {
  if (headers === undefined) return;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw new DeliveryError('Webhook headers must be a key/value object.');
  const entries = Object.entries(headers);
  if (entries.length > 20) throw new DeliveryError('At most 20 webhook headers are allowed.');
  for (const [key, value] of entries) {
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,80}$/.test(key)
      || /^(host|connection|content-length|transfer-encoding|upgrade|proxy-connection|keep-alive|te|trailer)$/i.test(key)) {
      throw new DeliveryError('Invalid or reserved webhook header name.');
    }
    if (typeof value !== 'string' || value.length > 2048 || /[\r\n\0]/.test(value)) throw new DeliveryError('Webhook header values must be single-line strings (max 2048 characters).');
  }
}
