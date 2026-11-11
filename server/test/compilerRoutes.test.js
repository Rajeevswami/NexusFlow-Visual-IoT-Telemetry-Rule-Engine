import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { Graph } from '../src/models/Graph.js';
import { activeGraphManager } from '../src/services/activeGraphManager.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * HTTP tests for the Day 2 compile endpoints.
 *
 * `Graph.findById` is stubbed so the routing, validation, status codes, response shape and
 * disposal logic can be tested without a database. Use the vitest suite and
 * `TEST_MONGODB_URI=... npm test` for the real database paths.
 */

const ID_A = '64b7f9c2e1a2b3c4d5e6f7a8';
const ID_B = '64b7f9c2e1a2b3c4d5e6f7b9';
const sample = JSON.parse(readFileSync(fileURLToPath(new URL('../samples/turbine-graph.json', import.meta.url)), 'utf8'));
const originalFindById = Graph.findById;

/** Serve the given documents (by id) through the model. */
function stubGraphs(docs) {
  Graph.findById = (id) => ({
    lean: async () => {
      const doc = docs[id];
      return doc ? { ...doc, _id: id } : null;
    },
  });
}

test('compile, list, test and deactivate a graph', async (t) => {
  stubGraphs({ [ID_A]: sample });

  t.after(() => {
    Graph.findById = originalFindById;
    activeGraphManager.disposeAll();
  });

  // Unknown id -> 404.
  assert.equal((await request(app).post(`/api/graphs/${ID_B}/compile`)).status, 404);
  // Bad id -> 400.
  assert.equal((await request(app).post('/api/graphs/not-an-id/compile')).status, 400);

  // Compile + activate.
  const compiled = await request(app).post(`/api/graphs/${ID_A}/compile`);
  assert.equal(compiled.status, 200);
  assert.equal(compiled.body.data.graphId, ID_A);
  assert.equal(compiled.body.data.nodeCount, 4);
  assert.equal(compiled.body.data.edgeCount, 3);
  assert.equal(compiled.body.data.sources[0].key, 'turbine-001:temperature');
  assert.equal(compiled.body.data.subscriptions, 1);

  // Listed as active.
  const active = await request(app).get('/api/graphs/active');
  assert.equal(active.status, 200);
  assert.equal(active.body.data.length, 1);
  assert.equal(active.body.data[0].name, 'Turbine overheat rule');

  // Dry run: 5-reading window, so six values produce two alerts.
  const dryRun = await request(app).post(`/api/graphs/${ID_A}/test`).send({ values: [70, 85, 90, 95, 99, 100] });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.data.dryRun, true);
  assert.equal(dryRun.body.data.delivered, 6);
  assert.equal(dryRun.body.data.alertCount, 2);
  assert.equal(dryRun.body.data.alerts[0].type, 'smsAlert');
  assert.equal(Number(dryRun.body.data.alerts[0].value.toFixed(2)), 87.8);

  // Bad test payloads.
  assert.equal((await request(app).post(`/api/graphs/${ID_A}/test`).send({ values: [] })).status, 400);
  assert.equal((await request(app).post(`/api/graphs/${ID_A}/test`).send({ values: [1, 2, 'x'] })).status, 400);
  assert.equal((await request(app).post(`/api/graphs/${ID_B}/test`).send({ values: [1] })).status, 404);

  // Deactivate twice: first ok, then 404.
  assert.equal((await request(app).post(`/api/graphs/${ID_A}/deactivate`)).status, 200);
  assert.equal((await request(app).post(`/api/graphs/${ID_A}/deactivate`)).status, 404);
  assert.equal((await request(app).get('/api/graphs/active')).body.data.length, 0);
});

test('recompiling replaces the previous pipeline instead of leaking it', async (t) => {
  stubGraphs({ [ID_A]: sample });
  t.after(() => {
    Graph.findById = originalFindById;
    activeGraphManager.disposeAll();
  });

  await request(app).post(`/api/graphs/${ID_A}/compile`);
  await request(app).post(`/api/graphs/${ID_A}/compile`);
  const active = await request(app).get('/api/graphs/active');
  assert.equal(active.body.data.length, 1, 'recompiling must not create a second entry');
  assert.equal(active.body.data[0].subscriptions, 1);
});

test('compiling an invalid graph returns 400 with the validator issues', async (t) => {
  stubGraphs({
    [ID_B]: {
      name: 'broken',
      nodes: [
        { id: 'a', type: 'sensor', position: { x: 0, y: 0 }, data: { config: {} } },
        { id: 'b', type: 'movingAverage', position: { x: 0, y: 0 }, data: { config: { windowSize: 3 } } },
        { id: 'c', type: 'threshold', position: { x: 0, y: 0 }, data: { config: { operator: '>', value: 1 } } },
      ],
      // a -> b -> c -> b : a genuine loop built from category-valid edges.
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
        { id: 'e3', source: 'c', target: 'b' },
      ],
    },
  });
  t.after(() => {
    Graph.findById = originalFindById;
    activeGraphManager.disposeAll();
  });

  const response = await request(app).post(`/api/graphs/${ID_B}/compile`);
  assert.equal(response.status, 400);
  assert.equal(response.body.error.message, 'Graph is not valid.');
  const codes = response.body.error.details.map((issue) => issue.code);
  assert.ok(codes.includes('cycle'), `expected a cycle error, got ${codes.join(', ')}`);
  assert.ok(codes.includes('too_many_inputs'), 'node b has two inputs');

  // An edge into a source node is rejected with a dedicated message.
  const intoSource = await request(app).post('/api/graphs/validate').send({
    nodes: [
      { id: 's1', type: 'sensor', position: { x: 0, y: 0 }, data: { config: {} } },
      { id: 's2', type: 'sensor', position: { x: 0, y: 0 }, data: { config: {} } },
    ],
    edges: [{ id: 'e1', source: 's1', target: 's2' }],
  });
  assert.equal(intoSource.status, 200);
  assert.ok(intoSource.body.errors.some((issue) => issue.code === 'source_has_input'));
});

test('POST /api/graphs/validate checks raw JSON without saving', async () => {
  const valid = await request(app).post('/api/graphs/validate').send(sample);
  assert.equal(valid.status, 200);
  assert.equal(valid.body.valid, true);
  assert.equal(valid.body.summary.nodeCount, 4);

  const invalid = await request(app).post('/api/graphs/validate').send({ nodes: [{ id: 'a', type: 'nope' }], edges: [] });
  assert.equal(invalid.status, 200);
  assert.equal(invalid.body.valid, false);
  assert.ok(invalid.body.errors.some((issue) => issue.code === 'unknown_type'));

  // Malformed bodies are 400, not 200.
  assert.equal((await request(app).post('/api/graphs/validate').send({ nodes: [] })).status, 400);
  assert.equal((await request(app).post('/api/graphs/validate').send({ nope: true })).status, 400);
});
