import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { attachWebSocketServer, broadcastEdgeActivity } from '../src/services/websocket.js';

test('edge activity is throttled to at most 10 Hz with a trailing event', async (t) => {
  const server = http.createServer();
  const wss = attachWebSocketServer(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
  const messages = [];
  socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ type: 'subscribe', channels: ['graph:g'] }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  for (let i = 0; i < 100; i += 1) broadcastEdgeActivity({ graphId: 'g', edgeId: 'e', timestamp: new Date(), tone: i === 99 ? 'alert' : 'data' });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const events = messages.filter((message) => message.type === 'edge_activity');
  assert.ok(events.length >= 1 && events.length <= 3);
  assert.equal(events.at(-1).data.tone, 'alert');
  assert.equal(events[0].data.edgeId, 'e');
  socket.terminate();
  for (const client of wss.clients) client.terminate();
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => server.close(resolve));
});
