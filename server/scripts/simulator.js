import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const { values } = parseArgs({ options: {
  devices: { type: 'string', default: process.env.SIMULATOR_DEVICES ?? '10' },
  interval: { type: 'string', default: process.env.SIMULATOR_INTERVAL_MS ?? '1000' },
  url: { type: 'string', default: process.env.SIMULATOR_URL ?? 'http://localhost:5000' },
  transport: { type: 'string', default: process.env.SIMULATOR_TRANSPORT ?? 'http' }, // http | ws | both
  'ws-url': { type: 'string', default: process.env.SIMULATOR_WS_URL ?? '' },
  spikes: { type: 'string', default: process.env.SIMULATOR_SPIKES ?? '0.04' }, // P(temperature anomaly) per reading
} });
const devices = Number(values.devices);
const interval = Number(values.interval);
const spikeRate = Number(values.spikes);
const transport = String(values.transport).toLowerCase();
if (!Number.isInteger(devices) || devices < 1 || devices > 10_000 || !Number.isInteger(interval) || interval < 50) {
  console.error('Use --devices 1..10000 and --interval (milliseconds) >= 50.');
  process.exit(1);
}
if (!['http', 'ws', 'both'].includes(transport)) {
  console.error('Use --transport http | ws | both.');
  process.exit(1);
}
if (!Number.isFinite(spikeRate) || spikeRate < 0 || spikeRate > 1) {
  console.error('Use --spikes between 0 and 1 (probability of an anomaly spike).');
  process.exit(1);
}
const baseUrl = new URL(values.url);
if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('The URL must use HTTP or HTTPS.');
const endpoint = new URL('/api/telemetry/batch', baseUrl);
const wsEndpoint = values['ws-url']
  ? new URL(values['ws-url'])
  : new URL(`/ws`, `${baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${baseUrl.host}`);
const useHttp = transport === 'http' || transport === 'both';
const useWs = transport === 'ws' || transport === 'both';
let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });

/* ------------------------------------------------------------ WebSocket sender */
let socket = null;
let socketReady = false;
let wsAccepted = 0;
let wsErrors = 0;
let reconnectDelay = 500;

function connectWs() {
  if (!useWs || !running) return;
  socket = new WebSocket(wsEndpoint);
  socket.on('open', () => {
    socketReady = true;
    reconnectDelay = 500;
    console.log(`WebSocket connected -> ${wsEndpoint}`);
  });
  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'ack') wsAccepted += message.data?.accepted ?? 1;
      else if (message.type === 'error') { wsErrors += 1; console.error(`WS error: ${message.data?.message}`); }
    } catch { /* ignore malformed frames */ }
  });
  socket.on('error', (error) => console.error(`WebSocket error: ${error.message}`));
  socket.on('close', () => {
    socketReady = false;
    if (!running) return;
    setTimeout(connectWs, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
  });
}

function sendWs(readings) {
  if (!socketReady || socket.readyState !== WebSocket.OPEN) return 0;
  let sent = 0;
  for (const reading of readings) {
    socket.send(JSON.stringify({ type: 'telemetry', data: reading }));
    sent += 1;
  }
  return sent;
}

/* ------------------------------------------------------------------- main loop */
const roundedValue = (value) => Math.round(value * 100) / 100;
console.log(`Simulating ${devices} devices (3 readings each) every ${interval} ms (spike chance ${spikeRate})`);
console.log(`  HTTP: ${useHttp ? endpoint : 'disabled'}   WS: ${useWs ? wsEndpoint : 'disabled'}`);
console.log('Press Ctrl+C to stop.');
if (useWs) connectWs();

while (running) {
  const start = Date.now();
  const timestamp = new Date().toISOString();
  const readings = [];
  for (let i = 1; i <= devices; i += 1) {
    const deviceId = `turbine-${String(i).padStart(3, '0')}`;
    const location = `Site ${Math.ceil(i / 10)}`;
    const anomaly = Math.random() < spikeRate;
    for (const [sensorType, value, unit] of [
      ['temperature', anomaly ? 85 + Math.random() * 20 : 45 + Math.random() * 25, '°C'],
      ['vibration', 0.5 + Math.random() * 4, 'mm/s'],
      ['pressure', 2 + Math.random() * 6, 'bar'],
    ]) {
      readings.push({ timestamp, metadata: { deviceId, sensorType, location }, value: roundedValue(value), unit });
    }
  }

  let accepted = 0;
  if (useHttp) {
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
    } catch (error) {
      console.error(`${timestamp}  accepted ${accepted} readings before error: ${error.message}`);
    }
  }
  if (useWs) sendWs(readings);

  const parts = [];
  if (useHttp) parts.push(`HTTP accepted ${accepted}`);
  if (useWs) parts.push(`WS sent ${readings.length} (acked ${wsAccepted}${wsErrors ? `, ${wsErrors} errors` : ''})`);
  console.log(`${timestamp}  ${parts.join('  |  ')}`);
  if (running) await sleep(Math.max(0, interval - (Date.now() - start)));
}
if (socket) socket.close();
console.log('Simulator stopped.');
