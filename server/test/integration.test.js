import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import mongoose from 'mongoose';
import request from 'supertest';
import { WebSocket } from 'ws';
import app from '../src/app.js';
import { ensureTelemetryCollection } from '../src/config/db.js';
import { attachWebSocketServer } from '../src/services/websocket.js';

const uri = process.env.TEST_MONGODB_URI;
test('MongoDB time-series, telemetry, graph CRUD and WebSockets', { skip: !uri && 'Set TEST_MONGODB_URI to a MongoDB 5.0+ server' }, async () => {
  // Never touch the configured database: use a unique throwaway database.
  const dbName = `nexusflow_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
  let server;
  let sockets;
  let socket;
  try {
    await ensureTelemetryCollection(mongoose.connection.db, 86400);
    await ensureTelemetryCollection(mongoose.connection.db, 86400); // restart is safe
    const info = await mongoose.connection.db.listCollections({ name: 'telemetry' }).next();
    assert.equal(info.options.timeseries.timeField, 'timestamp');
    assert.equal(info.options.timeseries.metaField, 'metadata');
    assert.equal(info.options.timeseries.granularity, 'seconds');
    assert.equal(info.options.expireAfterSeconds, 86400);
    const indexes = await mongoose.connection.db.collection('telemetry').indexes();
    assert.ok(indexes.some((index) => index.key['metadata.deviceId'] === 1 && index.key.timestamp === -1));

    server = http.createServer(app);
    sockets = attachWebSocketServer(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
    const connected = once(socket, 'message');
    assert.equal(JSON.parse((await connected)[0].toString()).type, 'connected');

    const reading = {
      timestamp: new Date().toISOString(),
      metadata: { deviceId: 'device-1', sensorType: 'temperature', location: 'test' },
      value: 86, unit: '°C', humidity: 45,
    };
    const broadcast = once(socket, 'message');
    const single = await request(server).post('/api/telemetry').send(reading);
    assert.equal(single.status, 202);
    assert.equal(single.body.accepted, 1);
    const event = JSON.parse((await broadcast)[0].toString());
    assert.equal(event.type, 'telemetry');
    assert.equal(event.data.value, 86);
    const batch = await request(server).post('/api/telemetry/batch').send([reading, { ...reading, value: 90 }]);
    assert.equal(batch.status, 202);
    assert.equal(batch.body.accepted, 2);
    const query = await request(server).get('/api/telemetry').query({ deviceId: 'device-1', limit: 2 });
    assert.equal(query.status, 200);
    assert.equal(query.body.data.length, 2);
    assert.equal(query.body.data[0].humidity, 45);
    assert.equal((await request(server).get('/api/health')).status, 200);

    const graph = { name: 'Test', nodes: [{ id: 'a', position: { x: 5, y: 10 }, data: { label: 'Sensor' } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const created = await request(server).post('/api/graphs').send(graph);
    assert.equal(created.status, 201);
    const id = created.body.data._id;
    assert.equal((await request(server).get('/api/graphs')).body.data[0]._id, id);
    assert.equal((await request(server).get(`/api/graphs/${id}`)).body.data.nodes[0].data.label, 'Sensor');
    assert.equal((await request(server).put(`/api/graphs/${id}`).send({ ...graph, name: 'Updated' })).body.data.name, 'Updated');
    assert.equal((await request(server).delete(`/api/graphs/${id}`)).status, 204);
    assert.equal((await request(server).get(`/api/graphs/${id}`)).status, 404);
  } finally {
    if (socket) socket.terminate();
    if (sockets) {
      for (const client of sockets.clients) client.terminate();
      await new Promise((resolve) => sockets.close(resolve));
    }
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
