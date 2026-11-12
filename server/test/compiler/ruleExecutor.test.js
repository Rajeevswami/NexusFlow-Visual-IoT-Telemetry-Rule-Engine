import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { telemetryBus } from '../../src/services/telemetryBus.js';
import { ruleExecutor } from '../../src/services/ruleExecutor.js';

/**
 * Rule executor: telemetryBus -> route -> compiled pipeline.
 * No database, no RxJS graph compilation — fake pipelines record what they receive.
 */

const reading = (deviceId, sensorType, value = 21) => ({
  metadata: { deviceId, sensorType, location: 'test' },
  value,
  unit: '°C',
  timestamp: new Date(),
});

/** Stand-in for a compiled pipeline: records every published reading. */
function fakeGraph(graphId, sources) {
  const received = [];
  return {
    graphId,
    sources,
    received,
    publish(item) { received.push(item); },
  };
}

beforeEach(() => {
  ruleExecutor.stop();
  telemetryBus.resetStats();
});
afterEach(() => {
  ruleExecutor.stop();
});

describe('ruleExecutor', () => {
  it('routes a reading only to the graph whose source matches deviceId + sensorType', () => {
    const alpha = fakeGraph('graph-alpha', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    const beta = fakeGraph('graph-beta', [{ deviceId: 'turbine-002', sensorType: 'temperature' }]);
    ruleExecutor.register(alpha);
    ruleExecutor.register(beta);

    const delivered = ruleExecutor.route(reading('turbine-001', 'temperature', 75));

    expect(delivered).toBe(1);
    expect(alpha.received).toHaveLength(1);
    expect(beta.received).toHaveLength(0);
    // A different sensor on the same device must not leak into the temperature graph.
    expect(ruleExecutor.route(reading('turbine-001', 'vibration', 3))).toBe(0);
    expect(alpha.received).toHaveLength(1);
  });

  it('supports multiple active graphs matching the same key simultaneously', () => {
    const one = fakeGraph('graph-1', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    const two = fakeGraph('graph-2', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    ruleExecutor.register(one);
    ruleExecutor.register(two);

    expect(ruleExecutor.route(reading('turbine-001', 'temperature'))).toBe(2);
    expect(one.received).toHaveLength(1);
    expect(two.received).toHaveLength(1);
  });

  it('matches wildcard sources without looping over every graph', () => {
    const anyDevice = fakeGraph('graph-any-device', [{ deviceId: '*', sensorType: 'temperature' }]);
    const anySensor = fakeGraph('graph-any-sensor', [{ deviceId: 'turbine-009', sensorType: '*' }]);
    const exact = fakeGraph('graph-exact', [{ deviceId: 'turbine-009', sensorType: 'temperature' }]);
    ruleExecutor.register(anyDevice);
    ruleExecutor.register(anySensor);
    ruleExecutor.register(exact);

    // turbine-009:temperature matches all three routes.
    expect(ruleExecutor.route(reading('turbine-009', 'temperature'))).toBe(3);
    // turbine-005:temperature matches only the device wildcard.
    expect(ruleExecutor.route(reading('turbine-005', 'temperature'))).toBe(1);
    // turbine-009:pressure matches only the sensor wildcard.
    expect(ruleExecutor.route(reading('turbine-009', 'pressure'))).toBe(1);

    expect(ruleExecutor.stats().wildcardSources).toBe(2);
    expect(ruleExecutor.stats().exactKeys).toBe(1);
  });

  it('stops delivering to a deactivated graph and keeps the others alive', () => {
    const staying = fakeGraph('graph-stay', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    const leaving = fakeGraph('graph-leave', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    ruleExecutor.register(staying);
    ruleExecutor.register(leaving);

    expect(ruleExecutor.route(reading('turbine-001', 'temperature'))).toBe(2);

    expect(ruleExecutor.unregister('graph-leave')).toBe(true);
    expect(ruleExecutor.unregister('graph-leave')).toBe(false); // idempotent

    expect(ruleExecutor.route(reading('turbine-001', 'temperature'))).toBe(1);
    expect(leaving.received).toHaveLength(1);
    expect(staying.received).toHaveLength(2);
    expect(ruleExecutor.stats().activeRoutes).toBe(1);
  });

  it('re-registering the same graphId replaces the old route instead of doubling delivery', () => {
    const first = fakeGraph('graph-dup', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    ruleExecutor.register(first);
    const second = fakeGraph('graph-dup', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    ruleExecutor.register(second);

    ruleExecutor.route(reading('turbine-001', 'temperature'));
    expect(first.received).toHaveLength(0);
    expect(second.received).toHaveLength(1);
    expect(ruleExecutor.stats().activeRoutes).toBe(1);
  });

  it('ignores malformed readings without throwing', () => {
    const graph = fakeGraph('graph-m', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    ruleExecutor.register(graph);

    expect(ruleExecutor.route(null)).toBe(0);
    expect(ruleExecutor.route({})).toBe(0);
    expect(ruleExecutor.route({ metadata: {} })).toBe(0);
    expect(ruleExecutor.route({ metadata: { deviceId: 'x' } })).toBe(0);
    expect(graph.received).toHaveLength(0);
  });

  it('isolates a crashing graph so the others keep receiving data', () => {
    const broken = {
      graphId: 'graph-broken',
      sources: [{ deviceId: 'turbine-001', sensorType: 'temperature' }],
      publish() { throw new Error('pipeline exploded'); },
    };
    const healthy = fakeGraph('graph-healthy', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    ruleExecutor.register(broken);
    ruleExecutor.register(healthy);

    // Telemetry bus delivery must not throw either.
    telemetryBus.ingest([reading('turbine-001', 'temperature')]);

    expect(healthy.received).toHaveLength(1);
    expect(ruleExecutor.stats().errors).toBeGreaterThan(0);
    consoleError.mockRestore();
  });

  it('tracks engine stats through the telemetry bus', () => {
    const graph = fakeGraph('graph-stats', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    ruleExecutor.register(graph);
    const routedBefore = ruleExecutor.stats().routedReadings;

    telemetryBus.ingest([
      reading('turbine-001', 'temperature'),
      reading('turbine-001', 'temperature'),
      reading('other-device', 'temperature'),
    ]);

    const bus = telemetryBus.stats();
    expect(bus.messagesProcessed).toBe(3);
    expect(bus.messagesPerSecond).toBeGreaterThanOrEqual(3);
    expect(ruleExecutor.stats().routedReadings - routedBefore).toBe(2);
    expect(graph.received).toHaveLength(2);
  });

  it('start() and stop() are idempotent and stop() disposes every route', () => {
    const graph = fakeGraph('graph-lifecycle', [{ deviceId: 'turbine-001', sensorType: 'temperature' }]);
    ruleExecutor.start();
    ruleExecutor.start();
    ruleExecutor.register(graph);
    expect(ruleExecutor.stats().started).toBe(true);

    ruleExecutor.stop();
    ruleExecutor.stop();
    expect(ruleExecutor.stats().started).toBe(false);
    expect(ruleExecutor.stats().activeRoutes).toBe(0);

    // After stop() the bus subscription is gone: ingest must not reach the graph.
    telemetryBus.ingest([reading('turbine-001', 'temperature')]);
    expect(graph.received).toHaveLength(0);
  });
});
