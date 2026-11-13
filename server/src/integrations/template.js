import { DeliveryError } from './urlSafety.js';

/**
 * JSON-aware {{placeholder}} rendering. A placeholder inside a JSON string is escaped;
 * outside a string it becomes a JSON value. Never concatenate untrusted device ids into
 * executable JSON. Legacy Day-2 ${placeholder} message templates remain supported.
 */
export function renderJsonTemplate(template, event = {}) {
  const when = event.timestamp ? new Date(event.timestamp) : new Date();
  const values = {
    deviceId: event.deviceId ?? 'unknown', sensorType: event.sensorType ?? '',
    value: Number.isFinite(Number(event.value)) ? Number(event.value) : null,
    unit: event.unit ?? '', timestamp: when.toISOString(),
    message: event.message ?? `Alert: ${event.deviceId ?? 'unknown'} = ${event.value ?? 'n/a'}`,
    graphId: event.graphId ?? null, nodeId: event.nodeId ?? null, alertId: event.alertId ?? null,
  };
  if (template === undefined || template === '') return values;
  if (typeof template !== 'string' || template.length > 16_384) throw new DeliveryError('Body template must be a string of at most 16384 characters.');
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < template.length;) {
    const match = template.slice(i).match(/^\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/);
    if (match) {
      const key = match[1];
      if (!Object.hasOwn(values, key)) throw new DeliveryError(`Unknown template placeholder: ${key}.`);
      const json = JSON.stringify(values[key]);
      result += inString ? json.slice(1, -1) : json;
      i += match[0].length;
      continue;
    }
    const char = template[i++];
    result += char;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
  }
  try {
    const parsed = JSON.parse(result);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new DeliveryError('Body template must render to a JSON object.'); }
}
