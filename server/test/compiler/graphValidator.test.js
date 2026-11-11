import { describe, expect, it } from 'vitest';
import { validateGraph } from '../../src/compiler/index.js';

const source = (id, overrides = {}) => ({
  id,
  type: 'sensor',
  position: { x: 0, y: 0 },
  data: { config: { deviceId: 'turbine-001', sensorType: 'temperature' } },
  ...overrides,
});
const movingAverage = (id, windowSize = 3) => ({ id, type: 'movingAverage', position: { x: 0, y: 0 }, data: { config: { windowSize } } });
const threshold = (id = 'threshold-1') => ({ id, type: 'threshold', position: { x: 0, y: 0 }, data: { config: { operator: '>', value: 80 } } });
const logNode = (id = 'log-1') => ({ id, type: 'log', position: { x: 0, y: 0 }, data: { config: {} } });
const edge = (sourceId, targetId, id = `${sourceId}->${targetId}`) => ({ id, source: sourceId, target: targetId });

describe('graphValidator', () => {
  it('accepts the sample turbine graph', () => {
    const result = validateGraph({
      nodes: [source('sensor-1'), movingAverage('average-1', 5), threshold('threshold-1'), { id: 'sms-1', type: 'smsAlert', position: { x: 0, y: 0 }, data: { config: { phone: '+911234567890' } } }],
      edges: [edge('sensor-1', 'average-1'), edge('average-1', 'threshold-1'), edge('threshold-1', 'sms-1')],
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(4);
  });

  it('reports unknown node types', () => {
    const result = validateGraph({ nodes: [{ id: 'n1', type: 'quantumFlux', data: {} }], edges: [] });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('unknown_type');
  });

  it('reports missing nodes referenced by an edge', () => {
    const result = validateGraph({ nodes: [source('sensor-1'), movingAverage('average-1')], edges: [edge('sensor-1', 'ghost')] });
    expect(result.errors.map((error) => error.code)).toContain('missing_target');
  });

  it('reports duplicate node and edge ids', () => {
    const result = validateGraph({
      nodes: [source('sensor-1'), source('sensor-1')],
      edges: [edge('sensor-1', 'sensor-1')],
    });
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(['duplicate_node', 'self_connection']));
  });

  it('rejects a cycle', () => {
    const result = validateGraph({
      nodes: [source('sensor-1'), movingAverage('average-1'), movingAverage('average-2')],
      edges: [edge('sensor-1', 'average-1'), edge('average-1', 'average-2'), edge('average-2', 'average-1')],
    });
    const cycle = result.errors.find((error) => error.code === 'cycle');
    expect(cycle).toBeDefined();
    expect(cycle.message).toContain('average-1');
  });

  it('rejects input into a source and output from an action', () => {
    const intoSource = validateGraph({ nodes: [source('sensor-1'), source('sensor-2')], edges: [edge('sensor-1', 'sensor-2')] });
    expect(intoSource.errors.map((error) => error.code)).toContain('source_has_input');

    const fromAction = validateGraph({ nodes: [source('sensor-1'), logNode('log-1'), movingAverage('average-1')], edges: [edge('sensor-1', 'log-1'), edge('log-1', 'average-1')] });
    expect(fromAction.errors.map((error) => error.code)).toContain('action_has_output');
  });

  it('requires at least one source and warns without an action', () => {
    const noSource = validateGraph({ nodes: [movingAverage('average-1')], edges: [] });
    expect(noSource.errors.map((error) => error.code)).toContain('no_source');

    const noAction = validateGraph({ nodes: [source('sensor-1'), movingAverage('average-1')], edges: [edge('sensor-1', 'average-1')] });
    expect(noAction.ok).toBe(true);
    expect(noAction.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(['no_action', 'dangling_output']));
  });

  it('flags configuration errors per node type', () => {
    const result = validateGraph({ nodes: [source('sensor-1'), { id: 'average-1', type: 'movingAverage', data: { config: { windowSize: 0 } } }], edges: [edge('sensor-1', 'average-1')] });
    expect(result.errors.some((error) => error.code === 'invalid_config' && error.nodeId === 'average-1')).toBe(true);
  });

  it('rejects non-object graphs', () => {
    expect(validateGraph(null).ok).toBe(false);
    expect(validateGraph({ nodes: 'nope' }).errors[0].code).toBe('invalid_nodes');
    expect(validateGraph({ nodes: [] }).errors[0].code).toBe('empty_graph');
  });
});
