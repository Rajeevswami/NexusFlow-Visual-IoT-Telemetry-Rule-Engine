import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { Telemetry } from '../src/models/Telemetry.js';
import {
  attachWebSocketServer,
  broadcastAlert,
  broadcastGraphStatus,
  broadcastNodeActivity,
  broadcastTelemetry,
} from '../src/services/websocket.js';
import { telemetryBus } from '../src/services/telemetryBus.js';

/**
 * WebSocket channel protocol: subscribe / unsubscribe / telemetry ingestion.
 * No database — `Telemetry.insertMany` is stubbed so the WS ingestion path can be
 * exercised end to end (validate -> ack -> persist -> telemetryBus -> broadcast).
 */

const GRAPH_ID = '64b7f9c2e1a2b3c4d5e6f7a8';
const originalInsertMany = Telemetry.insertMany;

function startServer(t) {
  const server = http.createServer();
  const wss = attachWebSocketServer(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, wss, port: server.address().port }));
  }).then((ctx) => {
    t.after(async () => {
      for (const client of ctx.wss.clients) client.terminate();
      await new Promise((resolve) => ctx.wss.close(resolve));
      await new Promise((resolve) => ctx.server.close(resolve));
      Telemetry.insertMany = originalInsertMany;
    });
    return ctx;
  });
}

/** Open a client and collect every JSON message it receives. */
function openClient(port, t) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages = [];
  socket.on('message', (raw) => {
    try { messages.push(JSON.parse(raw.toString())); } catch { /* ignore malformed */ }
  });
  t.after(() => { try { socket.terminate(); } catch { /* already closed */ } });
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve({ socket, messages }));
    socket.once('error', reject);
  });
}

const send = (socket, message) => socket.send(JSON.stringify(message));

/** Poll until `predicate(messages)` is true or time out. */
async function waitFor(predicate, messages, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(messages)) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate(messages);
}

const sampleReading = (deviceId = 'turbine-001', value = 42.5) => ({
  timestamp: new Date().toISOString(),
  metadata: { deviceId, sensorType: 'temperature', location: 'Lab' },
  value,
  unit: '°C',
});

test('only subscribed channels receive messages', async (t) => {
  const { port } = await startServer(t);
  const alpha = await openClient(port, t); // wants turbine-001 telemetry
  const bravo = await openClient(port, t); // wants alerts
  const charlie = await openClient(port, t); // subscribes to nothing

  await waitFor((m) => m.some((msg) => msg.type === 'connected'), alpha.messages);
  send(alpha.socket, { type: 'subscribe', channels: ['telemetry:turbine-001'] });
  send(bravo.socket, { type: 'subscribe', channels: ['alerts'] });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'subscribed'), alpha.messages));
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'subscribed'), bravo.messages));

  broadcastTelemetry(sampleReading('turbine-001', 55));
  broadcastTelemetry(sampleReading('turbine-999', 77)); // nobody subscribed to this device
  broadcastAlert({ graphId: GRAPH_ID, nodeId: 'sms-1', deviceId: 'turbine-001', value: 99, message: 'overheat', triggeredAt: new Date() });

  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'telemetry' && msg.data.value === 55), alpha.messages), 'alpha gets its device telemetry');
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'alert'), bravo.messages), 'bravo gets alerts');

  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(alpha.messages.filter((m) => m.type === 'telemetry').length, 1, 'alpha must not receive other devices or alerts');
  assert.equal(bravo.messages.filter((m) => m.type === 'telemetry').length, 0, 'bravo must not receive telemetry');
  assert.equal(charlie.messages.filter((m) => m.type === 'telemetry' || m.type === 'alert').length, 0, 'unsubscribed client receives nothing');
});

test('unsubscribe stops delivery on that channel', async (t) => {
  const { port } = await startServer(t);
  const client = await openClient(port, t);
  await waitFor((m) => m.some((msg) => msg.type === 'connected'), client.messages);

  send(client.socket, { type: 'subscribe', channels: ['alerts', `graph:${GRAPH_ID}`] });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'subscribed'), client.messages));

  broadcastAlert({ graphId: GRAPH_ID, nodeId: 'sms-1', deviceId: 'turbine-001', value: 99, message: 'first', triggeredAt: new Date() });
  assert.ok(await waitFor((m) => m.filter((msg) => msg.type === 'alert').length === 1, client.messages));

  send(client.socket, { type: 'unsubscribe', channels: ['alerts'] });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'unsubscribed'), client.messages));

  // Still subscribed to `graph:<id>`: an alert for THIS graph keeps arriving on the
  // graph channel (deduplicated per socket), and node activity/status come through.
  broadcastAlert({ graphId: GRAPH_ID, nodeId: 'sms-1', deviceId: 'turbine-001', value: 98, message: 'second', triggeredAt: new Date() });
  broadcastNodeActivity({ graphId: GRAPH_ID, nodeId: 'threshold-1', value: 98, timestamp: new Date() });
  broadcastGraphStatus(GRAPH_ID, 'active');

  assert.ok(await waitFor((m) => m.filter((msg) => msg.type === 'alert').length === 2, client.messages), 'graph channel still delivers alerts');
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'node_activity'), client.messages), 'node_activity delivered');
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'graph_status' && msg.data.status === 'active'), client.messages));

  // An alert for a different graph reaches nobody here: `alerts` was left and the
  // other graph channel was never subscribed.
  broadcastAlert({ graphId: '64b7f9c2e1a2b3c4d5e6f7b9', nodeId: 'sms-1', deviceId: 'turbine-001', value: 97, message: 'other graph', triggeredAt: new Date() });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(client.messages.filter((msg) => msg.type === 'alert').length, 2, 'alerts from other graphs stay silent');
});

test('clients can push telemetry over WebSocket through the same pipeline', async (t) => {
  Telemetry.insertMany = async (docs) => docs; // no database in this suite
  const { port } = await startServer(t);
  const watcher = await openClient(port, t);
  await waitFor((m) => m.some((msg) => msg.type === 'connected'), watcher.messages);
  send(watcher.socket, { type: 'subscribe', channels: ['telemetry:turbine-007'] });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'subscribed'), watcher.messages));

  const ingester = await openClient(port, t);
  await waitFor((m) => m.some((msg) => msg.type === 'connected'), ingester.messages);

  send(ingester.socket, { type: 'telemetry', data: sampleReading('turbine-007', 61.5) });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'ack' && msg.data.accepted === 1), ingester.messages), 'ingestion is acked');
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'telemetry' && msg.data.value === 61.5), watcher.messages), 'ingested reading is broadcast');

  // The reading also went through the bus (rule engine input).
  assert.ok(telemetryBus.stats().messagesProcessed > 0);
});

test('malformed messages are rejected without crashing the server', async (t) => {
  const { port } = await startServer(t);
  const client = await openClient(port, t);
  await waitFor((m) => m.some((msg) => msg.type === 'connected'), client.messages);

  client.socket.send('this is not json');
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'error' && /Invalid JSON/.test(msg.data.message)), client.messages));

  send(client.socket, { type: 'subscribe', channels: [42, 'not a channel'] });
  assert.ok(await waitFor((m) => m.filter((msg) => msg.type === 'error').length >= 2, client.messages));

  send(client.socket, { type: 'telemetry', data: { value: 'hot' } });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'error' && /Invalid telemetry payload/.test(msg.data.message)), client.messages));

  send(client.socket, { type: 'nope' });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'error' && /Unknown message type/.test(msg.data.message)), client.messages));

  // Still alive and usable afterwards.
  send(client.socket, { type: 'ping' });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'pong'), client.messages), 'server survives malformed input');
});

test('throttles devices sending faster than ~20 msg/s on the broadcast path', async (t) => {
  const { port } = await startServer(t);
  const client = await openClient(port, t);
  await waitFor((m) => m.some((msg) => msg.type === 'connected'), client.messages);
  send(client.socket, { type: 'subscribe', channels: ['telemetry:turbine-fast'] });
  assert.ok(await waitFor((m) => m.some((msg) => msg.type === 'subscribed'), client.messages));

  // 60 readings in a tight loop: server-side evaluation sees all of them (the bus
  // counter proves it), but the client must receive far fewer thanks to sampling.
  for (let i = 0; i < 60; i += 1) broadcastTelemetry(sampleReading('turbine-fast', i));
  await new Promise((resolve) => setTimeout(resolve, 400));

  const delivered = client.messages.filter((msg) => msg.type === 'telemetry').length;
  assert.ok(delivered > 0, 'some telemetry must get through');
  assert.ok(delivered < 60, `hot device must be sampled, got ${delivered}/60`);
});
