import { describe, expect, it, vi } from 'vitest';
import { compileGraph, GraphValidationError } from '../../src/compiler/streamCompiler.js';
import { nodeRegistry } from '../../src/compiler/nodeRegistry.js';

const sourceNode = (id = 'sensor-1', config = { deviceId: 'turbine-001', sensorType: 'temperature' }) => ({ id, type: 'sensor', position: { x: 0, y: 0 }, data: { config } });
const averageNode = (id = 'average-1', windowSize = 3) => ({ id, type: 'movingAverage', position: { x: 0, y: 0 }, data: { config: { windowSize } } });
const thresholdNode = (id = 'threshold-1', operator = '>', value = 80) => ({ id, type: 'threshold', position: { x: 0, y: 0 }, data: { config: { operator, value } } });
const logAction = (id = 'log-1') => ({ id, type: 'log', position: { x: 0, y: 0 }, data: { config: { label: 'test' } } });
const smsAction = (id = 'sms-1') => ({ id, type: 'smsAlert', position: { x: 0, y: 0 }, data: { config: { phone: '+911234567890', messageTemplate: 'ALERT ${deviceId} = ${value}${unit}' } } });
const link = (source, target) => ({ id: `${source}->${target}`, source, target });

/** Sensor -> MovingAverage(3) -> Threshold(>80) -> Log */
const linearGraph = {
  nodes: [sourceNode(), averageNode(), thresholdNode(), logAction()],
  edges: [link('sensor-1', 'average-1'), link('average-1', 'threshold-1'), link('threshold-1', 'log-1')],
};

describe('streamCompiler', () => {
  it('registers the built-in node types', () => {
    expect(nodeRegistry.types().sort()).toEqual(['log', 'movingAverage', 'scale', 'sensor', 'smsAlert', 'threshold', 'webhook']);
  });

  it('fires the log action when the moving average crosses the threshold', async () => {
    const compiled = compileGraph(linearGraph, { graphId: 'test', dryRun: true });
    compiled.pushValues([70, 85, 90, 95]);
    await new Promise((resolve) => setImmediate(resolve));

    const alerts = compiled.getAlerts();
    // window [70,85,90] -> 81.67 (fires), window [85,90,95] -> 90 (fires)
    expect(alerts).toHaveLength(2);
    expect(alerts.map((alert) => Number(alert.value.toFixed(2)))).toEqual([81.67, 90]);
    expect(alerts[0]).toMatchObject({ type: 'log', nodeId: 'log-1', deviceId: 'turbine-001', delivered: true, dryRun: true });
    compiled.dispose();
  });

  it('does not fire below the threshold', async () => {
    const compiled = compileGraph(linearGraph, { dryRun: true });
    compiled.pushValues([10, 20, 30, 40]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(compiled.getAlerts()).toEqual([]);
    compiled.dispose();
  });

  it('keeps metadata and renders the SMS template', async () => {
    const compiled = compileGraph({
      nodes: [sourceNode(), thresholdNode('threshold-1', '>', 50), smsAction()],
      edges: [link('sensor-1', 'threshold-1'), link('threshold-1', 'sms-1')],
    }, { dryRun: true });
    compiled.pushValues([{ value: 60, unit: '°C' }]);
    await new Promise((resolve) => setImmediate(resolve));

    const [alert] = compiled.getAlerts();
    expect(alert.message).toBe('ALERT turbine-001 = 60°C');
    expect(alert.to).toBe('+911234567890');
    compiled.dispose();
  });

  it('supports branching with share(): one source feeding two actions', async () => {
    const compiled = compileGraph({
      nodes: [sourceNode(), thresholdNode('threshold-1', '>', 50), logAction('log-1'), smsAction('sms-1')],
      edges: [link('sensor-1', 'threshold-1'), link('threshold-1', 'log-1'), link('threshold-1', 'sms-1')],
    }, { dryRun: true });

    expect(compiled.subscriptions).toHaveLength(2);
    compiled.pushValues([55]);
    await new Promise((resolve) => setImmediate(resolve));

    const alerts = compiled.getAlerts();
    expect(alerts.map((alert) => alert.type).sort()).toEqual(['log', 'smsAlert']);
    compiled.dispose();
  });

  it('routes readings by deviceId and sensorType', async () => {
    const compiled = compileGraph({
      nodes: [sourceNode('sensor-a', { deviceId: 'turbine-001', sensorType: 'temperature' }), logAction('log-a')],
      edges: [link('sensor-a', 'log-a')],
    }, { dryRun: true });

    compiled.publish({ metadata: { deviceId: 'turbine-001', sensorType: 'temperature' }, value: 10, unit: '°C' });
    compiled.publish({ metadata: { deviceId: 'turbine-002', sensorType: 'temperature' }, value: 99, unit: '°C' });
    compiled.publish({ metadata: { deviceId: 'turbine-001', sensorType: 'vibration' }, value: 99, unit: 'mm/s' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(compiled.getAlerts()).toHaveLength(1);
    compiled.dispose();
  });

  it('exposes source summaries for the compile response', () => {
    const compiled = compileGraph(linearGraph, { graphId: 'abc', dryRun: true });
    expect(compiled.sources).toEqual([{ nodeId: 'sensor-1', type: 'sensor', deviceId: 'turbine-001', sensorType: 'temperature', key: 'turbine-001:temperature' }]);
    expect(compiled.nodeCount).toBe(4);
    expect(compiled.edgeCount).toBe(3);
    compiled.dispose();
  });

  it('refuses to compile an invalid graph', () => {
    expect(() => compileGraph({ nodes: [averageNode()], edges: [] }, { dryRun: true })).toThrow(GraphValidationError);
    const invalid = { nodes: [sourceNode(), averageNode()], edges: [link('sensor-1', 'average-1'), link('average-1', 'sensor-1')] };
    expect(() => compileGraph(invalid, { dryRun: true })).toThrow(/not valid/);
  });

  it('dispose() unsubscribes and stops the pipeline', async () => {
    const compiled = compileGraph(linearGraph, { dryRun: true });
    expect(compiled.disposed).toBe(false);
    compiled.dispose();
    expect(compiled.disposed).toBe(true);
    expect(compiled.subscriptions).toHaveLength(0);
    // Pushing after disposal must be a no-op, not a crash.
    expect(compiled.pushValues([100, 100, 100])).toBe(0);
    compiled.dispose(); // idempotent
  });

  it('never lets a failing action kill the pipeline', async () => {
    const compiled = compileGraph({
      nodes: [sourceNode(), logAction('log-1')],
      edges: [link('sensor-1', 'log-1')],
    }, { dryRun: true, onAlert: () => { throw new Error('listener exploded'); } });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    compiled.pushValues([1, 2]);
    await new Promise((resolve) => setImmediate(resolve));
    // Both events were still delivered to the action.
    expect(compiled.getAlerts()).toHaveLength(2);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
    compiled.dispose();
  });
});
