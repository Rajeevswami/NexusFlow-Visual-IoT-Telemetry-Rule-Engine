import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import mongoose from 'mongoose';
import { WebSocket } from 'ws';

process.env.NODE_ENV = 'test';
// The demo template points at the local mock receiver, which is exactly what this
// end-to-end run needs; private destinations must be explicitly allowed.
process.env.ALLOW_PRIVATE_WEBHOOKS = 'true';
process.env.MOCK_RECEIVER_ENABLED = 'true';
process.env.OUTBOUND_RETRY_BASE_MS = '0';
const uri = process.env.TEST_MONGODB_URI;

/**
 * End-to-end happy path, the one a reviewer will ask to see:
 *
 *   create a graph -> compile/activate it -> ingest an anomalous reading
 *   -> assert an Alert document AND a successful DeliveryLog entry, and that the
 *   alert was pushed to WebSocket subscribers.
 *
 * Skipped unless TEST_MONGODB_URI points at a disposable MongoDB 5.0+ server.
 */
test('E2E: create graph -> compile -> ingest anomaly -> Alert + DeliveryLog + WebSocket', { skip: !uri && 'Set TEST_MONGODB_URI to a MongoDB 5.0+ server' }, async (t) => {
  const { default: app } = await import('../src/app.js');
  const { ensureTelemetryCollection } = await import('../src/config/db.js');
  const { Alert } = await import('../src/models/Alert.js');
  const { DeliveryLog } = await import('../src/models/DeliveryLog.js');
  const { Graph } = await import('../src/models/Graph.js');
  const { activeGraphManager } = await import('../src/services/activeGraphManager.js');
  const { ruleExecutor } = await import('../src/services/ruleExecutor.js');
  const { outboundQueue, shutdownDeliveries } = await import('../src/services/deliveryService.js');
  const { mockSmsProvider } = await import('../src/integrations/smsService.js');

  const dbName = `nexusflow_e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const api = request(server);
  const receiver = `http://127.0.0.1:${server.address().port}/api/mock/webhook-receiver`;

  let socket;
  t.after(async () => {
    socket?.terminate();
    activeGraphManager.disposeAll();
    ruleExecutor.stop();
    await shutdownDeliveries();
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  await ensureTelemetryCollection(mongoose.connection.db, 86_400);
  await Promise.all([Alert.init(), DeliveryLog.init(), Graph.init()]);
  ruleExecutor.start();

  /* ---------------------------------------------------------- 1. create + compile */
  const graph = {
    name: 'E2E overheat rule',
    nodes: [
      { id: 'sensor', type: 'sensor', position: { x: 0, y: 0 }, data: { label: 'Sensor', config: { deviceId: 'turbine-001', sensorType: 'temperature' } } },
      // windowSize 1 makes the average equal the reading, so a single spike fires.
      { id: 'avg', type: 'movingAverage', position: { x: 260, y: 0 }, data: { label: 'Average', config: { windowSize: 1 } } },
      { id: 'limit', type: 'threshold', position: { x: 520, y: 0 }, data: { label: 'Overheat', config: { operator: '>', value: 80 } } },
      { id: 'sms', type: 'smsAlert', position: { x: 780, y: 0 }, data: { label: 'SMS', config: { phone: '+911234567890', messageTemplate: 'E2E {{deviceId}} = {{value}}{{unit}}', cooldownSeconds: 0 } } },
      { id: 'hook', type: 'webhook', position: { x: 780, y: 220 }, data: { label: 'Webhook', config: { url: receiver, method: 'POST', headers: { 'X-Source': 'e2e' }, bodyTemplate: '{"device":"{{deviceId}}","value":{{value}}}', cooldownSeconds: 0 } } },
    ],
    edges: [
      { id: 'e1', source: 'sensor', target: 'avg' },
      { id: 'e2', source: 'avg', target: 'limit' },
      { id: 'e3', source: 'limit', target: 'sms' },
      { id: 'e4', source: 'limit', target: 'hook' },
    ],
  };
  const created = await api.post('/api/graphs').send(graph);
  assert.equal(created.status, 201);
  const graphId = created.body.data._id;

  const activation = await api.post(`/api/graphs/${graphId}/compile`);
  assert.equal(activation.status, 200);
  assert.equal(activation.body.data.subscriptions, 2, 'both action branches are subscribed');
  assert.equal((await api.get('/api/graphs/active')).body.data.length, 1);

  /* ------------------------------------------------- 2. subscribe to the live feed */
  socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const messages = [];
  socket.on('message', (raw) => { try { messages.push(JSON.parse(raw.toString())); } catch { /* ignore */ } });
  socket.send(JSON.stringify({ type: 'subscribe', channels: ['alerts', `graph:${graphId}`] }));

  /* ------------------------------------------------------- 3. ingest the anomaly */
  const anomaly = {
    timestamp: new Date().toISOString(),
    metadata: { deviceId: 'turbine-001', sensorType: 'temperature', location: 'E2E' },
    value: 96.5,
    unit: '°C',
  };
  assert.equal((await api.post('/api/telemetry/batch').send([anomaly])).status, 202);

  /* ------------------------------------- 4. assert Alert + DeliveryLog + broadcast */
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if ((await Alert.countDocuments({ graphId })) === 2 && (await DeliveryLog.countDocuments({ graphId, status: 'success' })) === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const alerts = await Alert.find({ graphId }).sort({ triggeredAt: 1 }).lean();
  assert.equal(alerts.length, 2, 'one alert per action node (SMS + webhook)');
  for (const alert of alerts) {
    assert.equal(alert.deviceId, 'turbine-001');
    assert.equal(alert.value, 96.5);
    assert.equal(alert.deliveryStatus, 'success');
    assert.equal(alert.deliveryIds.length, 1);
  }
  assert.deepEqual(alerts.map((a) => a.type).sort(), ['smsAlert', 'webhook']);

  const logs = await DeliveryLog.find({ graphId }).lean();
  assert.equal(logs.length, 2);
  for (const log of logs) {
    assert.equal(log.status, 'success');
    assert.equal(log.attempts, 1);
    assert.ok(log.alertId, 'each delivery is linked back to its alert');
    assert.equal(log.completedAt instanceof Date, true);
  }
  assert.deepEqual(logs.map((l) => l.channel).sort(), ['sms', 'webhook']);
  assert.ok(mockSmsProvider.messages.some((message) => message.body.includes('96.5')), 'mock SMS received the body');

  // The webhook really arrived at the mock receiver with the rendered body.
  const inbox = await api.get('/api/mock/webhook-receiver');
  assert.equal(inbox.status, 200);
  assert.ok(inbox.body.data.some((item) => item.body.device === 'turbine-001' && item.body.value === 96.5));

  // Public projections never leak the private request snapshot or the full phone number.
  const publicLogs = (await api.get('/api/deliveries').query({ graphId })).body.data;
  assert.equal(publicLogs.length, 2);
  assert.ok(publicLogs.every((log) => log.request === undefined));
  assert.ok(publicLogs.every((log) => !log.target.includes('1234567890')));

  /* ------------------------------------------- 5. the alert reached WebSocket clients */
  const alertMessages = messages.filter((message) => message.type === 'alert');
  assert.equal(alertMessages.length, 2, 'subscribers were pushed both alerts');
  assert.ok(alertMessages.every((message) => message.data.graphId === graphId));
  assert.ok(alertMessages.some((message) => message.data.deliveryStatus === 'success'));
  const deliveryMessages = messages.filter((message) => message.type === 'delivery');
  assert.equal(deliveryMessages.length, 2, 'final delivery results were broadcast too');

  /* --------------------------------- 6. re-hydration: the rule survives a restart */
  // Simulate a process that died without running its shutdown handler (a crash, a
  // container kill, a free-tier sleep): everything in memory is gone, the database
  // still says the graph should be running.
  activeGraphManager.disposeAll();
  ruleExecutor.clear();
  assert.equal(ruleExecutor.stats().activeRoutes, 0);
  assert.equal((await Graph.findById(graphId).lean()).isActive, true, 'a crash leaves the flag set');

  const rehydrated = await activeGraphManager.hydrateActiveGraphs();
  assert.deepEqual(rehydrated, { total: 1, activated: 1, failed: 0 });
  assert.equal((await api.get('/api/graphs/active')).body.data.length, 1);
  assert.equal(ruleExecutor.stats().activeRoutes, 1);

  // ...and it evaluates again after the restart.
  assert.equal((await api.post('/api/telemetry/batch').send([{ ...anomaly, value: 99 }])).status, 202);
  const postRestart = Date.now() + 8000;
  while (Date.now() < postRestart) {
    if ((await Alert.countDocuments({ graphId })) === 4) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(await Alert.countDocuments({ graphId }), 4, 'the re-hydrated rule keeps firing');

  await outboundQueue.onIdle();
});
