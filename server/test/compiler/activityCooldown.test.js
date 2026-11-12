import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileGraph } from '../../src/compiler/streamCompiler.js';

/**
 * Day 3 compiler features: optional per-node activity taps and the alert cooldown
 * that stops action nodes from spamming during a sustained spike.
 */

const sourceNode = (id = 'sensor-1', config = { deviceId: 'turbine-001', sensorType: 'temperature' }) => ({ id, type: 'sensor', position: { x: 0, y: 0 }, data: { config } });
const thresholdNode = (id = 'threshold-1', operator = '>', value = 80) => ({ id, type: 'threshold', position: { x: 0, y: 0 }, data: { config: { operator, value } } });
const logAction = (id = 'log-1', config = { label: 'test' }) => ({ id, type: 'log', position: { x: 0, y: 0 }, data: { config } });
const link = (source, target) => ({ id: `${source}->${target}`, source, target });

const overheatGraph = (actionConfig = { label: 'test' }) => ({
  nodes: [sourceNode(), thresholdNode(), logAction('log-1', actionConfig)],
  edges: [link('sensor-1', 'threshold-1'), link('threshold-1', 'log-1')],
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('compileGraph activity taps', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits { graphId, nodeId, value } per node when trackActivity is enabled', async () => {
    const activity = [];
    const compiled = compileGraph(overheatGraph(), {
      graphId: 'g-1',
      dryRun: true,
      trackActivity: true,
      onActivity: (event) => activity.push(event),
    });

    compiled.pushValues([95]);
    await settle();

    const nodeIds = activity.map((event) => event.nodeId);
    // The source, threshold and action nodes all report; the threshold blocks 50 but passes 95.
    expect(nodeIds).toContain('sensor-1');
    expect(nodeIds).toContain('threshold-1');
    expect(nodeIds).toContain('log-1');
    for (const event of activity) {
      expect(event.graphId).toBe('g-1');
      expect(typeof event.value).toBe('number');
      expect(event.timestamp).toBeInstanceOf(Date);
    }
    compiled.dispose();
  });

  it('does not call onActivity when trackActivity is off (production default)', async () => {
    const onActivity = vi.fn();
    const compiled = compileGraph(overheatGraph(), { graphId: 'g-1', dryRun: true, onActivity });
    compiled.pushValues([95, 96, 97]);
    await settle();
    expect(onActivity).not.toHaveBeenCalled();
    compiled.dispose();
  });

  it('a throwing activity listener never breaks the pipeline', async () => {
    const compiled = compileGraph(overheatGraph(), {
      graphId: 'g-1',
      dryRun: true,
      trackActivity: true,
      onActivity: () => { throw new Error('listener exploded'); },
    });
    compiled.pushValues([95]);
    await settle();
    // The alert still fired despite the failing listener.
    expect(compiled.getAlerts()).toHaveLength(1);
    compiled.dispose();
  });
});

describe('action cooldown', () => {
  it('fires once per cooldown window instead of on every reading', async () => {
    const compiled = compileGraph(overheatGraph({ label: 'test', cooldownSeconds: 30 }), { graphId: 'g-1', dryRun: true });

    compiled.pushValues([95, 96, 97, 98]); // all above the threshold
    await settle();
    expect(compiled.getAlerts()).toHaveLength(1); // first fires, the rest are suppressed

    compiled.dispose();
  });

  it('cooldown 0 (default) fires on every matching reading', async () => {
    const compiled = compileGraph(overheatGraph({ label: 'test' }), { graphId: 'g-1', dryRun: true });
    compiled.pushValues([95, 96, 97]);
    await settle();
    expect(compiled.getAlerts()).toHaveLength(3);
    compiled.dispose();
  });

  it('keys the cooldown per device so one device cannot silence another', async () => {
    const graph = {
      nodes: [
        // Wildcard source so readings from any device reach the pipeline.
        sourceNode('sensor-1', { deviceId: '*', sensorType: 'temperature' }),
        thresholdNode(),
        logAction('log-1', { label: 'test', cooldownSeconds: 60 }),
      ],
      edges: [link('sensor-1', 'threshold-1'), link('threshold-1', 'log-1')],
    };
    const compiled = compileGraph(graph, { graphId: 'g-1', dryRun: true });

    compiled.pushValues([
      { deviceId: 'turbine-001', value: 95 },
      { deviceId: 'turbine-001', value: 96 }, // suppressed (same device, inside window)
      { deviceId: 'turbine-002', value: 97 }, // different device: fires
    ]);
    await settle();

    const alerts = compiled.getAlerts();
    expect(alerts).toHaveLength(2);
    expect(alerts.map((alert) => alert.deviceId)).toEqual(['turbine-001', 'turbine-002']);
    compiled.dispose();
  });

  it('rejects an out-of-range cooldownSeconds during validation', () => {
    expect(() => compileGraph(overheatGraph({ label: 'test', cooldownSeconds: -1 }), { dryRun: true })).toThrow(/not valid/);
    expect(() => compileGraph(overheatGraph({ label: 'test', cooldownSeconds: 999_999 }), { dryRun: true })).toThrow(/not valid/);
  });
});
