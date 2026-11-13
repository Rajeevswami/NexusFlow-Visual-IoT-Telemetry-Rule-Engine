import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.ALLOW_PRIVATE_WEBHOOKS = 'true';
process.env.MOCK_RECEIVER_ENABLED = 'true';
process.env.OUTBOUND_RETRY_BASE_MS = '0';
const uri = process.env.TEST_MONGODB_URI;

test('Day 4 E2E: turbine rule -> alert -> queued webhook/SMS -> audited delivery', { skip: !uri && 'Set TEST_MONGODB_URI to a MongoDB 5.0+ server' }, async () => {
  const { default: app } = await import('../src/app.js');
  const { ensureTelemetryCollection } = await import('../src/config/db.js');
  const { Graph } = await import('../src/models/Graph.js');
  const { Alert } = await import('../src/models/Alert.js');
  const { DeliveryLog } = await import('../src/models/DeliveryLog.js');
  const { activeGraphManager } = await import('../src/services/activeGraphManager.js');
  const { ruleExecutor } = await import('../src/services/ruleExecutor.js');
  const { shutdownDeliveries, outboundQueue } = await import('../src/services/deliveryService.js');
  const { mockSmsProvider } = await import('../src/integrations/smsService.js');
  const { getTemplates } = await import('../src/data/templates.js');
  const dbName = `nexusflow_day4_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const receiver = `http://127.0.0.1:${server.address().port}/api/mock/webhook-receiver`;
  try {
    await ensureTelemetryCollection(mongoose.connection.db, 86400);
    await Promise.all([Alert.init(), DeliveryLog.init(), Graph.init()]);
    ruleExecutor.start();
    const template = getTemplates()[0].graph;
    template.nodes.find((node) => node.type === 'movingAverage').data.config.windowSize = 1;
    template.nodes.find((node) => node.type === 'webhook').data.config.url = receiver;
    template.nodes.filter((node) => ['webhook', 'smsAlert'].includes(node.type)).forEach((node) => { node.data.config.cooldownSeconds = 30; });
    const created = await request(app).post('/api/graphs').send(template);
    assert.equal(created.status, 201);
    const id = created.body.data._id;
    assert.equal((await request(app).post(`/api/graphs/${id}/compile`)).status, 200);
    const reading = { metadata: { deviceId: 'turbine-001', sensorType: 'temperature', location: 'E2E' }, value: 96, unit: '°C' };
    assert.equal((await request(app).post('/api/telemetry/batch').send([reading, { ...reading, value: 98 }])).status, 202);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if ((await DeliveryLog.countDocuments({ graphId: id, status: 'success' })) === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const logs = await DeliveryLog.find({ graphId: id }).lean();
    assert.equal(logs.length, 2, 'cooldown suppresses the second spike per action/device');
    assert.ok(logs.every((log) => log.status === 'success' && log.attempts === 1 && log.alertId));
    assert.equal(await Alert.countDocuments({ graphId: id }), 2);
    const received = await request(app).get('/api/mock/webhook-receiver');
    assert.equal(received.status, 200); assert.equal(received.body.data.length, 1);
    assert.equal(received.body.data[0].body.device, 'turbine-001');
    assert.equal(received.body.data[0].body.value, 96);
    assert.equal(received.body.data[0].headers.Authorization, undefined);
    assert.ok(mockSmsProvider.messages.length > 0);
    const publicLogs = await request(app).get('/api/deliveries').query({ graphId: id, status: 'success' });
    assert.equal(publicLogs.body.data.length, 2);
    assert.ok(publicLogs.body.data.every((log) => !log.request && !log.target.includes('1234567890')));
    // A failed audit can be retried manually; the atomic claim returns pending immediately.
    const failed = await DeliveryLog.create({ graphId: id, nodeId: 'retry-test', channel: 'webhook', target: receiver,
      status: 'failed', attempts: 3, error: 'previous outage', request: { url: receiver, method: 'POST', headers: {}, body: { retried: true } } });
    const retry = await request(app).post(`/api/deliveries/${failed._id}/retry`);
    assert.equal(retry.status, 202); assert.equal(retry.body.data.status, 'pending');
    assert.equal((await request(app).post(`/api/deliveries/${failed._id}/retry`)).status, 409);
    while (outboundQueue.size) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal((await DeliveryLog.findById(failed._id)).status, 'success');
    assert.equal((await DeliveryLog.findById(failed._id)).attempts, 4);
  } finally {
    activeGraphManager.disposeAll(); ruleExecutor.stop(); await shutdownDeliveries();
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
});
