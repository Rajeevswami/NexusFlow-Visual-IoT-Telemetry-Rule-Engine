import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Graph } from '../../src/models/Graph.js';
import { activeGraphManager } from '../../src/services/activeGraphManager.js';
import { ruleExecutor } from '../../src/services/ruleExecutor.js';

/**
 * Boot-time re-hydration (Day 5).
 *
 * A server restart must not silently stop the rules: on boot every graph flagged
 * `isActive` is recompiled and activated again. The Graph model is stubbed so the
 * suite runs without a database — the point under test is the lifecycle, not MongoDB.
 */

const sample = JSON.parse(readFileSync(fileURLToPath(new URL('../../samples/turbine-graph.json', import.meta.url)), 'utf8'));
const ID_A = '64b7f9c2e1a2b3c4d5e6f7a8';
const ID_B = '64b7f9c2e1a2b3c4d5e6f7b9';
const ID_C = '64b7f9c2e1a2b3c4d5e6f7c0';

/** A graph that cannot compile: a cycle built from category-valid edges. */
const broken = {
  name: 'Broken',
  nodes: [
    { id: 'a', type: 'sensor', position: { x: 0, y: 0 }, data: { config: {} } },
    { id: 'b', type: 'movingAverage', position: { x: 0, y: 0 }, data: { config: { windowSize: 3 } } },
    { id: 'c', type: 'threshold', position: { x: 0, y: 0 }, data: { config: { operator: '>', value: 1 } } },
  ],
  edges: [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'b', target: 'c' },
    { id: 'e3', source: 'c', target: 'b' },
  ],
};

/**
 * Serve documents through the model, plus the flags written by the manager.
 * @param {Record<string, object>} docs id -> graph document
 * @param {string[]} [inactive] ids that are NOT flagged isActive
 */
function stubGraphs(docs, inactive = []) {
  const flags = new Map(Object.keys(docs).map((id) => [id, !inactive.includes(id)]));
  const writes = [];
  Graph.find = () => ({
    select: () => ({
      lean: async () => Object.entries(docs)
        .filter(([id]) => flags.get(id))
        .map(([id, doc]) => ({ _id: id, name: doc.name })),
    }),
  });
  Graph.findById = (id) => ({
    lean: async () => (docs[id] ? { ...docs[id], _id: id } : null),
  });
  Graph.updateOne = async (filter, update) => {
    writes.push({ id: String(filter._id), isActive: update.$set?.isActive });
    if (update.$set?.isActive === false) flags.set(String(filter._id), false);
    return { acknowledged: true };
  };
  return { flags, writes };
}

afterEach(() => {
  activeGraphManager.disposeAll();
  ruleExecutor.stop();
  vi.restoreAllMocks();
});

describe('active graph re-hydration', () => {
  it('recompiles every graph flagged isActive on boot', async () => {
    const { writes } = stubGraphs({ [ID_A]: sample, [ID_B]: sample });

    const summary = await activeGraphManager.hydrateActiveGraphs();

    expect(summary).toEqual({ total: 2, activated: 2, failed: 0 });
    expect(activeGraphManager.list().map((entry) => entry.graphId).sort()).toEqual([ID_A, ID_B].sort());
    // Every pipeline is really live, not just remembered.
    expect(ruleExecutor.stats().activeRoutes).toBe(2);
    expect(ruleExecutor.stats().started).toBe(true);
    expect(writes.every((write) => write.isActive === true)).toBe(true);
  });

  it('reports an empty engine when no graph was running', async () => {
    stubGraphs({ [ID_A]: sample }, [ID_A]);

    expect(await activeGraphManager.hydrateActiveGraphs()).toEqual({ total: 0, activated: 0, failed: 0 });
    expect(activeGraphManager.list()).toHaveLength(0);
    expect(ruleExecutor.stats().activeRoutes).toBe(0);
  });

  it('keeps going when one graph no longer compiles and flags it inactive', async () => {
    const { flags, writes } = stubGraphs({ [ID_A]: sample, [ID_B]: broken, [ID_C]: sample });

    const summary = await activeGraphManager.hydrateActiveGraphs();

    expect(summary).toEqual({ total: 3, activated: 2, failed: 1 });
    expect(activeGraphManager.list()).toHaveLength(2);
    expect(flags.get(ID_B)).toBe(false);
    expect(writes.some((write) => write.id === ID_B && write.isActive === false)).toBe(true);
  });

  it('skips documents that were deleted while the server was down', async () => {
    stubGraphs({ [ID_A]: sample, [ID_C]: sample });
    Graph.findById = (id) => ({
      lean: async () => (id === ID_C ? { ...sample, _id: id } : null), // ID_A is gone
    });

    const summary = await activeGraphManager.hydrateActiveGraphs();

    expect(summary).toEqual({ total: 2, activated: 1, failed: 1 });
    expect(activeGraphManager.list().map((entry) => entry.graphId)).toEqual([ID_C]);
  });

  it('a graceful shutdown keeps the flag so a restart brings the rule back', async () => {
    const { flags } = stubGraphs({ [ID_A]: sample });

    await activeGraphManager.hydrateActiveGraphs();
    expect(activeGraphManager.list()).toHaveLength(1);

    // What server.js calls on SIGTERM: in-memory only, no database write.
    activeGraphManager.disposeAll();
    ruleExecutor.stop();
    expect(activeGraphManager.list()).toHaveLength(0);
    expect(flags.get(ID_A)).toBe(true);

    // Boot again.
    expect(await activeGraphManager.hydrateActiveGraphs()).toEqual({ total: 1, activated: 1, failed: 0 });
    expect(ruleExecutor.stats().activeRoutes).toBe(1);
  });

  it('an explicit deactivate clears the flag so the rule stays off after a restart', async () => {
    const { flags } = stubGraphs({ [ID_A]: sample });
    await activeGraphManager.hydrateActiveGraphs();

    expect(activeGraphManager.deactivate(ID_A)).toBe(true);
    expect(flags.get(ID_A)).toBe(false);
    expect(await activeGraphManager.hydrateActiveGraphs()).toEqual({ total: 0, activated: 0, failed: 0 });
    expect(activeGraphManager.list()).toHaveLength(0);
  });

  it('activating twice replaces the pipeline instead of leaking a subscription', async () => {
    stubGraphs({ [ID_A]: sample });
    await activeGraphManager.activate(ID_A);
    await activeGraphManager.activate(ID_A);

    expect(activeGraphManager.list()).toHaveLength(1);
    expect(activeGraphManager.get(ID_A).subscriptions).toBe(1);
    expect(ruleExecutor.stats().activeRoutes).toBe(1);
  });
});
