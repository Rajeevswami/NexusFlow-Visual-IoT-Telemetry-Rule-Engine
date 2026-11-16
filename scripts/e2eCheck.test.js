import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const { WebSocketServer } = require('ws');

// Contract fixtures test the checker itself, NOT MongoDB, the real rule engine,
// outbound providers, browser behavior or restart persistence.
for (const scenario of ['success', 'failed webhook', 'activation error']) {
  test(`E2E checker contract: ${scenario}`, { timeout: 25_000 }, async () => {
    let graph;
    let active = false;
    let deleted = false;
    let locationPresent = false;
    const graphId = '123456789012345678901234';
    const alerts = [];
    const deliveries = [];
    const inbox = [];
    const server = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : undefined;
      const url = new URL(req.url, 'http://localhost');
      let response = {};
      if (url.pathname === '/api/health') response = { status: 'ok' };
      else if (url.pathname === '/api/graphs' && req.method === 'POST') {
        graph = body;
        response = { data: { _id: graphId } };
      } else if (url.pathname === '/api/graphs/active') response = { data: active ? [{ graphId }] : [] };
      else if (url.pathname.endsWith('/compile')) {
        if (scenario === 'activation error') {
          res.statusCode = 500;
          response = { error: { message: 'fixture activation failure' } };
        } else active = true;
      } else if (url.pathname.endsWith('/deactivate')) active = false;
      else if (url.pathname === `/api/graphs/${graphId}`) {
        if (req.method === 'DELETE') deleted = true;
        response = { data: graph };
      } else if (url.pathname === '/api/telemetry/batch') {
        locationPresent = body.every(r => Boolean(r.metadata.location));
        response = { accepted: body.length };
        if (active) {
          const device = body[0].metadata.deviceId;
          for (let i = 0; i < 4; i++) {
            alerts.push({ _id: `alert-${i}`, graphId });
            deliveries.push({ _id: `delivery-${i}`, graphId, channel: i % 2 ? 'webhook' : 'sms', status: scenario === 'failed webhook' && i % 2 ? 'failed' : 'success' });
          }
          inbox.push({ body: { device } });
          for (const socket of sockets.clients) {
            for (const type of ['telemetry', 'node_activity', 'edge_activity', 'alert', 'delivery']) {
              socket.send(JSON.stringify({ type, data: { graphId, metadata: { deviceId: device } } }));
            }
          }
        }
      } else if (url.pathname === '/api/alerts') response = { data: alerts };
      else if (url.pathname === '/api/deliveries') response = { data: deliveries };
      else if (url.pathname === '/api/mock/webhook-receiver') response = { data: inbox };
      else res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(response));
    });
    const sockets = new WebSocketServer({ server, path: '/ws' });
    sockets.on('connection', socket => socket.on('message', () => socket.send(JSON.stringify({ type: 'subscribed' }))));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let child;
    try {
      const result = await new Promise((resolve, reject) => {
        child = spawn(process.execPath, [new URL('./e2eCheck.js', import.meta.url).pathname], {
          env: { ...process.env, E2E_URL: `http://127.0.0.1:${server.address().port}` },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', data => { output += data; });
        child.stderr.on('data', data => { output += data; });
        child.on('error', reject);
        child.on('exit', code => resolve({ code, output }));
      });
      assert.equal(result.code, scenario === 'success' ? 0 : 1, result.output);
      assert.ok(deleted, 'checker cleans up its graph on success or failure');
      if (scenario === 'activation error') assert.match(result.output, /FAIL 4 Anomaly ingestion — blocked/);
      else assert.ok(locationPresent, 'checker includes required metadata.location');
      if (scenario === 'success') assert.match(result.output, /PASS 6 Deactivate/);
      if (scenario === 'failed webhook') {
        assert.match(result.output, /FAIL 5 Alerts, deliveries and live events/);
        assert.doesNotMatch(result.output, /PASS 5/);
      }
    } finally {
      child?.kill();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise(resolve => sockets.close(resolve));
      await new Promise(resolve => server.close(resolve));
    }
  });
}
