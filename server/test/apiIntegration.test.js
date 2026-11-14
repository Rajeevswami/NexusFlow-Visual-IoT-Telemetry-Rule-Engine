import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { ensureTelemetryCollection } from '../src/config/db.js';
import { attachWebSocketServer } from '../src/services/websocket.js';
import { Alert } from '../src/models/Alert.js';
import { DeliveryLog } from '../src/models/DeliveryLog.js';
import { Graph } from '../src/models/Graph.js';
import { Telemetry } from '../src/models/Telemetry.js';
import { activeGraphManager } from '../src/services/activeGraphManager.js';
import { ruleExecutor } from '../src/services/ruleExecutor.js';

/**
 * API integration tests (supertest against the real Express app + MongoDB).
 *
 * They cover the whole HTTP surface that the product depends on: telemetry ingestion
 * (single + batch), graph CRUD, compile/deactivate, alerts and deliveries — plus two
 * regression tests for lifecycle bugs found in the Day-5 audit (deleting or editing a
 * graph that is currently active).
 *
 * Skipped unless TEST_MONGODB_URI points at a disposable MongoDB 5.0+ server.
 */

const uri = process.env.TEST_MONGODB_URI;

const reading = (overrides = {}) => ({
  timestamp: new Date().toISOString(),
  metadata: { deviceId: 'turbine-001', sensorType: 'temperature', location: 'Integration test' },
  value: 91,
  unit: '°C',
  ...overrides,
});

/** A minimal but complete Sensor -> Threshold -> Log graph. */
const simpleGraph = (name = 'API integration rule') => ({
  name,
  nodes: [
    { id: 'sensor-1', type: 'sensor', position: { x: 0, y: 0 }, data: { label: 'Sensor', config: { deviceId: 'turbine-001', sensorType: 'temperature' } } },
    { id: 'threshold-1', type: 'threshold', position: { x: 300, y: 0 }, data: { label: 'Overheat', config: { operator: '>', value: 80 } } },
    { id: 'log-1', type: 'log', position: { x: 600, y: 0 }, data: { label: 'Log', config: { label: 'integration', template: '${deviceId} = ${value}' } } },
  ],
  edges: [
    { id: 'e1', source: 'sensor-1', target: 'threshold-1' },
    { id: 'e2', source: 'threshold-1', target: 'log-1' },
  ],
});

/** Boot the app on an ephemeral port with the WebSocket layer attached. */
async function startServer() {
  const server = http.createServer(app);
  const sockets = attachWebSocketServer(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, sockets };
}

async function stopServer({ server, sockets }) {
  for (const client of sockets.clients) client.terminate();
  await new Promise((resolve) => sockets.close(resolve));
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
}

test('API integration: telemetry, graphs, engine, alerts and deliveries', { skip: !uri && 'Set TEST_MONGODB_URI to a MongoDB 5.0+ server' }, async (t) => {
  const dbName = `nexusflow_api_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
  const started = await startServer();
  const api = request(started.server);

  t.after(async () => {
    activeGraphManager.disposeAll();
    ruleExecutor.stop();
    await stopServer(started);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  await ensureTelemetryCollection(mongoose.connection.db, 86_400);
  await Promise.all([Alert.init(), DeliveryLog.init(), Graph.init()]);
  ruleExecutor.start();

  // ------------------------------------------------------------ telemetry ingest
  const single = await api.post('/api/telemetry').send(reading({ value: 96 }));
  assert.equal(single.status, 202);
  assert.equal(single.body.accepted, 1);
  assert.equal(await Telemetry.countDocuments({}), 1);

  const batch = await api.post('/api/telemetry/batch').send([
    reading({ value: 97 }),
    reading({ value: 98, metadata: { deviceId: 'turbine-002', sensorType: 'vibration', location: 'Integration test' } }),
  ]);
  assert.equal(batch.status, 202);
  assert.equal(batch.body.accepted, 2);
  assert.equal(await Telemetry.countDocuments({}), 3);

  // Validation is enforced on the hot path too.
  assert.equal((await api.post('/api/telemetry').send({ value: 'not-a-number' })).status, 400);
  assert.equal((await api.post('/api/telemetry/batch').send([])).status, 400);
  assert.equal((await api.post('/api/telemetry/batch').send(Array(1001).fill(reading()))).status, 400);

  // Historical reads + aggregation.
  const history = await api.get('/api/telemetry').query({ deviceId: 'turbine-001', limit: 10 });
  assert.equal(history.status, 200);
  assert.equal(history.body.data.length, 2);
  const stats = await api.get('/api/telemetry/stats').query({ deviceId: 'turbine-001', window: '5m' });
  assert.equal(stats.status, 200);
  assert.equal(stats.body.data.buckets.length, 1);
  assert.equal(stats.body.data.buckets[0].count, 2);

  // ---------------------------------------------------------------- graph CRUD
  const created = await api.post('/api/graphs').send(simpleGraph());
  assert.equal(created.status, 201);
  const graphId = created.body.data._id;
  assert.equal((await api.get(`/api/graphs/${graphId}`)).body.data.name, 'API integration rule');
  assert.ok((await api.get('/api/graphs')).body.data.some((graph) => graph._id === graphId));
  const updated = await api.put(`/api/graphs/${graphId}`).send(simpleGraph('Renamed rule'));
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.name, 'Renamed rule');
  assert.equal((await api.get(`/api/graphs/not-an-id`)).status, 400);
  assert.equal((await api.get('/api/graphs/64b7f9c2e1a2b3c4d5e6f7a8')).status, 404);

  // ------------------------------------------------------- compile / deactivate
  const compiled = await api.post(`/api/graphs/${graphId}/compile`);
  assert.equal(compiled.status, 200);
  assert.equal(compiled.body.data.nodeCount, 3);
  assert.equal(compiled.body.data.edgeCount, 2);
  assert.deepEqual(compiled.body.data.sources[0], {
    nodeId: 'sensor-1', type: 'sensor', deviceId: 'turbine-001', sensorType: 'temperature', key: 'turbine-001:temperature',
  });

  const active = await api.get('/api/graphs/active');
  assert.equal(active.body.data.length, 1);
  assert.equal(active.body.data[0].graphId, graphId);
  assert.equal((await Graph.findById(graphId).lean()).isActive, true, 'activation flags the document');

  // Activating the same graph twice replaces the pipeline instead of leaking it.
  assert.equal((await api.post(`/api/graphs/${graphId}/compile`)).status, 200);
  assert.equal((await api.get('/api/graphs/active')).body.data.length, 1);
  assert.equal((await api.get('/api/graphs/active')).body.data[0].subscriptions, 1);

  // An invalid graph cannot be compiled, and the running one is untouched.
  const broken = await api.post('/api/graphs').send({
    name: 'Broken',
    nodes: [
      { id: 'a', type: 'sensor', position: { x: 0, y: 0 }, data: { config: {} } },
      { id: 'b', type: 'movingAverage', position: { x: 0, y: 0 }, data: { config: { windowSize: 3 } } },
    ],
    edges: [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'a' }],
  });
  const brokenId = broken.body.data._id;
  const rejected = await api.post(`/api/graphs/${brokenId}/compile`);
  assert.equal(rejected.status, 400);
  assert.ok(rejected.body.error.details.some((issue) => issue.code === 'cycle'));
  assert.equal((await api.get('/api/graphs/active')).body.data.length, 1);

  // ------------------------------------------------- alerts and delivery audit
  const spike = await api.post('/api/telemetry/batch').send([reading({ value: 99 })]);
  assert.equal(spike.status, 202);
  // Ingestion fans out on the next tick; give the pipeline a moment to settle.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const alerts = await api.get('/api/alerts').query({ deviceId: 'turbine-001' });
  assert.equal(alerts.status, 200);
  assert.ok(alerts.body.data.length >= 1, 'the threshold rule fired and was persisted');
  assert.equal(alerts.body.data[0].type, 'log');
  assert.equal(alerts.body.data[0].nodeId, 'log-1');

  const engine = await api.get('/api/engine/status');
  assert.equal(engine.status, 200);
  assert.equal(engine.body.data.activeGraphs, 1);
  assert.ok(engine.body.data.messagesProcessed >= 4);
  assert.ok(engine.body.data.alertsFired >= 1);

  // --------------------------------------------------- lifecycle regressions
  // Editing an active graph must stop the stale pipeline (it is compiled from the
  // saved JSON, so leaving it running would silently evaluate the old rule).
  await api.put(`/api/graphs/${graphId}`).send(simpleGraph('Renamed rule'));
  assert.equal((await api.get('/api/graphs/active')).body.data.length, 0);
  assert.equal((await Graph.findById(graphId).lean()).isActive, false);

  // Re-activate, then delete: the pipeline must be disposed too.
  assert.equal((await api.post(`/api/graphs/${graphId}/compile`)).status, 200);
  assert.equal((await api.delete(`/api/graphs/${graphId}`)).status, 204);
  assert.equal((await api.get('/api/graphs/active')).body.data.length, 0, 'deleting a graph stops its pipeline');
  assert.equal(ruleExecutor.stats().activeRoutes, 0);

  // Telemetry for a graph that no longer exists must not raise anything.
  await api.post('/api/telemetry/batch').send([reading({ value: 99 })]);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal((await api.get('/api/alerts').query({ graphId })).body.data.length, 0);

  // Deliveries endpoint stays usable (empty audit trail for this run).
  const deliveries = await api.get('/api/deliveries');
  assert.equal(deliveries.status, 200);
  assert.equal(deliveries.body.data.length, 0);
  assert.equal((await api.get('/api/deliveries').query({ status: 'nope' })).status, 400);
  assert.equal((await api.post('/api/deliveries/64b7f9c2e1a2b3c4d5e6f7a8/retry')).status, 404);

  // The broken graph is still there and can be deleted.
  assert.equal((await api.delete(`/api/graphs/${brokenId}`)).status, 204);
});

test('API integration: WebSocket ingestion follows the same pipeline as HTTP', { skip: !uri && 'Set TEST_MONGODB_URI to a MongoDB 5.0+ server' }, async (t) => {
  const dbName = `nexusflow_ws_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
  const started = await startServer();
  const api = request(started.server);
  let socket;

  t.after(async () => {
    socket?.terminate();
    activeGraphManager.disposeAll();
    ruleExecutor.stop();
    await stopServer(started);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  await ensureTelemetryCollection(mongoose.connection.db, 86_400);
  ruleExecutor.start();

  const created = await api.post('/api/graphs').send(simpleGraph('WebSocket rule'));
  const graphId = created.body.data._id;
  assert.equal((await api.post(`/api/graphs/${graphId}/compile`)).status, 200);

  socket = new (await import('ws')).WebSocket(`ws://127.0.0.1:${started.server.address().port}/ws`);
  await once(socket, 'open');
  const acked = once(socket, 'message');
  socket.send(JSON.stringify({ type: 'telemetry', data: reading({ value: 95 }) }));
  assert.equal(JSON.parse((await acked)[0].toString()).type, 'ack');

  // The reading is durable and the rule saw it.
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && (await Telemetry.countDocuments({})) === 0) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(await Telemetry.countDocuments({}), 1);
  assert.ok((await api.get('/api/alerts')).body.data.length >= 1);

  // Malformed frames are answered with an error, not a crash.
  const invalid = once(socket, 'message');
  socket.send(JSON.stringify({ type: 'telemetry', data: { value: 'nope' } }));
  assert.equal(JSON.parse((await invalid)[0].toString()).type, 'error');
});
