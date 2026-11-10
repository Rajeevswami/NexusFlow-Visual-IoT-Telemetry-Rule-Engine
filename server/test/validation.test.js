import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { batchSchema, readingSchema, telemetryQuerySchema } from '../src/validation/telemetry.js';
import { graphSchema } from '../src/validation/graph.js';

const reading = {
  timestamp: '2026-01-01T12:00:00.000Z',
  metadata: { deviceId: 'turbine-001', sensorType: 'temperature', location: 'Site 1' },
  value: 42.5,
  unit: '°C',
};

test('reading validation accepts extra numeric measurements and converts time', () => {
  const result = readingSchema.parse({ ...reading, humidity: 48 });
  assert.ok(result.timestamp instanceof Date);
  assert.equal(result.humidity, 48);
  assert.ok(readingSchema.parse({ ...reading, timestamp: undefined }).timestamp instanceof Date);
});

test('invalid readings, batches and query ranges are rejected', () => {
  assert.equal(readingSchema.safeParse({ ...reading, humidity: '48' }).success, false);
  assert.equal(readingSchema.safeParse({ ...reading, timestamp: 'invalid' }).success, false);
  assert.equal(readingSchema.safeParse({ ...reading, '$bad': 1 }).success, false);
  assert.equal(batchSchema.safeParse(Array(1001).fill(reading)).success, false);
  assert.equal(telemetryQuerySchema.safeParse({ from: '2026-01-02T00:00:00Z', to: '2026-01-01T00:00:00Z' }).success, false);
});

test('graph validation retains React Flow fields and rejects dangling edges', () => {
  const node = { id: 'a', position: { x: 0, y: 0 }, data: { label: 'Sensor' }, type: 'nexus' };
  const valid = graphSchema.parse({ name: '  Flow  ', nodes: [node], edges: [] });
  assert.equal(valid.name, 'Flow');
  assert.equal(valid.nodes[0].type, 'nexus');
  assert.equal(graphSchema.safeParse({ name: 'x', nodes: [node], edges: [{ id: 'e', source: 'a', target: 'missing' }] }).success, false);
});

test('HTTP validation, missing routes and health work without a database', async () => {
  const invalid = await request(app).post('/api/telemetry').send({ value: 'not a number' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.message, 'Validation failed.');
  const malformed = await request(app).post('/api/telemetry').set('Content-Type', 'application/json').send('{');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.message, 'Malformed JSON body.');
  assert.equal((await request(app).get('/missing')).status, 404);
  const health = await request(app).get('/api/health');
  assert.equal(health.status, 503);
  assert.equal(health.body.database, 'disconnected');
});
