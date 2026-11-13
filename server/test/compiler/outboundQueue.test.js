import { describe, expect, it } from 'vitest';
import { BoundedQueue, GraphRateLimiter } from '../../src/services/outboundQueue.js';
import { compileGraph } from '../../src/compiler/streamCompiler.js';

describe('outbound safeguards', () => {
  it('bounds concurrency and queue size', async () => {
    const queue = new BoundedQueue({ concurrency: 2, limit: 3 });
    let active = 0; let peak = 0; const releases = [];
    const task = () => new Promise((resolve) => { active += 1; peak = Math.max(peak, active); releases.push(() => { active -= 1; resolve(); }); });
    const jobs = [queue.enqueue(task), queue.enqueue(task), queue.enqueue(task)];
    await expect(queue.enqueue(task)).rejects.toThrow(/full/);
    await Promise.resolve(); expect(queue.active).toBe(2); expect(peak).toBe(2);
    releases.shift()(); await jobs[0]; await new Promise((resolve) => setImmediate(resolve));
    expect(queue.active).toBe(2);
    while (releases.length) releases.shift()();
    await Promise.all(jobs); expect(queue.size).toBe(0);
  });
  it('limits each graph independently in a rolling minute', () => {
    const limiter = new GraphRateLimiter(2, 1000);
    expect(limiter.take('a', 0)).toBe(true); expect(limiter.take('a', 1)).toBe(true);
    expect(limiter.take('a', 2)).toBe(false); expect(limiter.take('b', 2)).toBe(true);
    expect(limiter.take('a', 1000)).toBe(true);
  });
  it('emits real edge ids only when activity is enabled', async () => {
    const graph = { nodes: [
      { id: 's', type: 'sensor', position: { x: 0, y: 0 }, data: { config: { deviceId: 'd', sensorType: 'temperature' } } },
      { id: 'l', type: 'log', position: { x: 1, y: 0 }, data: { config: {} } },
    ], edges: [{ id: 'saved-edge-id', source: 's', target: 'l' }] };
    const edges = []; const nodes = [];
    const compiled = compileGraph(graph, { graphId: 'g', dryRun: true, trackActivity: true, onActivity: (a) => nodes.push(a), onEdgeActivity: (a) => edges.push(a) });
    compiled.pushValues([90]); await new Promise((resolve) => setImmediate(resolve));
    expect(edges).toHaveLength(1); expect(edges[0]).toMatchObject({ graphId: 'g', edgeId: 'saved-edge-id' });
    expect(nodes[0]).toMatchObject({ graphId: 'g', nodeId: 's', value: 90 });
    compiled.dispose();
    const off = compileGraph(graph, { dryRun: true, onEdgeActivity: () => { throw new Error('must be off'); } });
    off.pushValues([90]); await new Promise((resolve) => setImmediate(resolve)); off.dispose();
  });
});
