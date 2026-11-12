/**
 * Render an action message template.
 *
 * Supported placeholders: ${value}, ${deviceId}, ${sensorType}, ${unit}, ${timestamp}, ${date}
 * Unknown placeholders are left untouched so no information is silently lost.
 *
 * @param {string} template
 * @param {{ value?: number, deviceId?: string, sensorType?: string, unit?: string, timestamp?: Date | string }} event
 * @returns {string}
 */
export function renderTemplate(template, event = {}) {
  if (typeof template !== 'string' || template.trim() === '') return defaultMessage(event);
  const when = event.timestamp ? new Date(event.timestamp) : new Date();
  const values = {
    value: formatNumber(event.value),
    deviceId: event.deviceId ?? 'unknown-device',
    sensorType: event.sensorType ?? 'unknown-sensor',
    unit: event.unit ?? '',
    timestamp: when.toISOString(),
    date: when.toISOString().slice(0, 10),
  };
  return template.replace(/\$\{\s*(\w+)\s*\}/g, (match, key) => (key in values ? String(values[key]) : match));
}

/**
 * Shared validation for the optional `cooldownSeconds` action setting
 * (0 = disabled, max 24 h). Enforced centrally by the stream compiler.
 * @param {{ cooldownSeconds?: unknown }} config
 * @returns {string[]} human-readable issues
 */
export function cooldownErrors(config) {
  const { cooldownSeconds } = config;
  if (cooldownSeconds === undefined) return [];
  if (typeof cooldownSeconds !== 'number' || !Number.isFinite(cooldownSeconds)
    || !Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 86_400) {
    return ['cooldownSeconds must be an integer between 0 and 86400 (24 h).'];
  }
  return [];
}

export function defaultMessage(event = {}) {
  const unit = event.unit ? ` ${event.unit}` : '';
  return `Alert: ${event.deviceId ?? 'unknown-device'} ${event.sensorType ?? ''} = ${formatNumber(event.value)}${unit}`.trim();
}

function formatNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
