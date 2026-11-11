import { registerNode } from '../nodeRegistry.js';

const WILDCARD = '*';

/** Stable key used to look up a source node's Subject. */
export function sensorKey(config = {}) {
  return `${config.deviceId || WILDCARD}:${config.sensorType || WILDCARD}`;
}

const matches = (configured, actual) => !configured || configured === WILDCARD || configured === actual;

/** Does an incoming telemetry reading belong to this sensor node? */
export function sensorMatches(reading, config = {}) {
  const metadata = reading?.metadata ?? {};
  return matches(config.deviceId, metadata.deviceId) && matches(config.sensorType, metadata.sensorType);
}

registerNode({
  type: 'sensor',
  category: 'source',
  label: 'Sensor Source',
  defaults: { deviceId: 'turbine-001', sensorType: 'temperature' },
  subjectKey: sensorKey,
  matches: sensorMatches,
  validate(config) {
    const errors = [];
    for (const key of ['deviceId', 'sensorType']) {
      if (config[key] !== undefined) {
        const value = String(config[key]).trim();
        if (value === '') errors.push(`${key} must not be empty.`);
        else if (value.length > 120) errors.push(`${key} must be 120 characters or fewer.`);
      }
    }
    return errors;
  },
});
