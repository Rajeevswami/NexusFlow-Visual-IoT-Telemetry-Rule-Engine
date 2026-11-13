import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { Telemetry } from '../src/models/Telemetry.js';
mongoose.set('bufferCommands', false);
import app from '../src/app.js';
import { env } from '../src/config/env.js';

test('hardening: security headers, size limits, consistent errors and optional ingestion key', async () => {
  const health = await request(app).get('/api/health');
  assert.ok(health.headers['x-content-type-options']);
  assert.ok(health.headers['x-request-id']);
  assert.equal(health.headers['x-powered-by'], undefined);
  const missing = await request(app).get('/api/not-a-route');
  assert.equal(missing.status, 404); assert.equal(missing.body.error.code, 'NOT_FOUND');
  const malformed = await request(app).post('/api/telemetry').set('Content-Type', 'application/json').send('{bad');
  assert.equal(malformed.status, 400); assert.equal(malformed.body.error.code, 'INVALID_JSON');
  const large = await request(app).post('/api/telemetry').send({ unit: 'x'.repeat(1024 * 1024 + 100) });
  assert.equal(large.status, 413); assert.equal(large.body.error.code, 'PAYLOAD_TOO_LARGE');
  const previous = env.ingestApiKey;
  const originalInsert = Telemetry.insertMany;
  try {
    env.ingestApiKey = 'test-ingestion-key';
    const reading = { metadata: { deviceId: 'd', sensorType: 'temperature', location: 'test' }, value: 1, unit: 'C' };
    assert.equal((await request(app).post('/api/telemetry').send(reading)).status, 401);
    assert.equal((await request(app).post('/api/telemetry').set('x-api-key', 'wrong').send(reading)).status, 401);
    // Stub only persistence: authentication and the real HTTP ingestion handler still run.
    Telemetry.insertMany = async (docs) => docs;
    const authenticated = await request(app).post('/api/telemetry').set('x-api-key', 'test-ingestion-key').send(reading);
    assert.equal(authenticated.status, 202);
    assert.equal((await request(app).get('/api/templates')).status, 200);
  } finally { env.ingestApiKey = previous; Telemetry.insertMany = originalInsert; }
});
