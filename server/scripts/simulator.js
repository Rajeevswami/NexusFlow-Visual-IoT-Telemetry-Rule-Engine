import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const { values } = parseArgs({ options: {
  devices: { type: 'string', default: process.env.SIMULATOR_DEVICES ?? '10' },
  interval: { type: 'string', default: process.env.SIMULATOR_INTERVAL_MS ?? '1000' },
  url: { type: 'string', default: process.env.SIMULATOR_URL ?? 'http://localhost:5000' },
} });
const devices = Number(values.devices);
const interval = Number(values.interval);
if (!Number.isInteger(devices) || devices < 1 || devices > 10_000 || !Number.isInteger(interval) || interval < 50) {
  console.error('Use --devices 1..10000 and --interval (milliseconds) >= 50.');
  process.exit(1);
}
const baseUrl = new URL(values.url);
if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('The URL must use HTTP or HTTPS.');
const endpoint = new URL('/api/telemetry/batch', baseUrl);
const rounded = (value) => Math.round(value * 100) / 100;
let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });

console.log(`Simulating ${devices} devices (3 readings each) every ${interval} ms -> ${endpoint}`);
console.log('Press Ctrl+C to stop.');
while (running) {
  const start = Date.now();
  const timestamp = new Date().toISOString();
  const readings = [];
  for (let i = 1; i <= devices; i += 1) {
    const deviceId = `turbine-${String(i).padStart(3, '0')}`;
    const location = `Site ${Math.ceil(i / 10)}`;
    const anomaly = Math.random() < 0.04;
    for (const [sensorType, value, unit] of [
      ['temperature', anomaly ? 85 + Math.random() * 20 : 45 + Math.random() * 25, '°C'],
      ['vibration', 0.5 + Math.random() * 4, 'mm/s'],
      ['pressure', 2 + Math.random() * 6, 'bar'],
    ]) {
      readings.push({ timestamp, metadata: { deviceId, sensorType, location }, value: rounded(value), unit });
    }
  }

  let accepted = 0;
  try {
    for (let i = 0; i < readings.length; i += 1000) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(readings.slice(i, i + 1000)),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error?.message ?? 'request failed'}`);
      accepted += body.accepted;
    }
    console.log(`${timestamp}  accepted ${accepted} readings`);
  } catch (error) {
    console.error(`${timestamp}  accepted ${accepted} readings before error: ${error.message}`);
  }
  if (running) await sleep(Math.max(0, interval - (Date.now() - start)));
}
console.log('Simulator stopped.');
