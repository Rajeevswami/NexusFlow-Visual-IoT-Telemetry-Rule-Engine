import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { connectDatabase } from '../src/config/db.js';
import { logger } from '../src/config/logger.js';
import { Device } from '../src/models/Device.js';
import { Graph } from '../src/models/Graph.js';
import { Telemetry } from '../src/models/Telemetry.js';
import { getTemplates } from '../src/data/templates.js';

/**
 * Seed / demo bootstrap.
 *
 *   npm run seed                       # devices + template graphs + history
 *   npm run bootstrap                  # the same, plus flag the primary rule active
 *
 * Safe to run repeatedly: devices and template graphs are upserted by key, and the
 * historical series is only written when the marker document is missing. Nothing a
 * user created is touched.
 *
 * `--activate` only sets `isActive` on the primary template graph. It does NOT compile
 * anything here (this process exits immediately) — the running server re-hydrates every
 * graph flagged `isActive` on its next boot, which is what makes the deployed demo come
 * back with a live rule after a restart or a free-tier sleep.
 */

const { values } = parseArgs({ options: {
  activate: { type: 'boolean', default: false },
  history: { type: 'string', default: '180' },
} });

const historyPoints = Number(values.history);
if (!Number.isInteger(historyPoints) || historyPoints < 0 || historyPoints > 5000) {
  console.error('Use --history 0..5000 (number of readings per device).');
  process.exit(1);
}

const devices = [
  { deviceId: 'turbine-001', name: 'Turbine 001', type: 'wind-turbine', location: 'Jaipur Demo Site' },
  { deviceId: 'temp-001', name: 'Ambient sensor', type: 'temperature-sensor', location: 'Jaipur Demo Site' },
];

try {
  await connectDatabase();

  for (const device of devices) {
    await Device.updateOne({ deviceId: device.deviceId }, { $set: device }, { upsert: true });
  }
  for (const template of getTemplates()) {
    await Graph.updateOne({ templateKey: template.key }, { $set: template.graph }, { upsert: true, runValidators: true });
  }

  let inserted = 0;
  const end = Date.now();
  for (const device of devices) {
    // A location marker makes repeated seeds idempotent without deleting user telemetry.
    const marker = { 'metadata.deviceId': device.deviceId, 'metadata.location': 'Seed history' };
    if (historyPoints === 0 || (await Telemetry.exists(marker))) continue;
    const readings = [];
    for (let i = 0; i < historyPoints; i += 1) {
      const timestamp = new Date(end - (historyPoints - i) * 10_000);
      const sensors = device.deviceId === 'turbine-001'
        ? [['temperature', 55 + 20 * Math.sin(i / 9), '°C'], ['vibration', 2 + Math.sin(i / 5), 'mm/s'], ['pressure', 4 + Math.cos(i / 8), 'bar']]
        : [['temperature', 28 + 4 * Math.sin(i / 12), '°C']];
      for (const [sensorType, value, unit] of sensors) {
        readings.push({ timestamp, metadata: { deviceId: device.deviceId, sensorType, location: 'Seed history' }, value: Math.round(value * 100) / 100, unit });
      }
    }
    const docs = await Telemetry.insertMany(readings, { ordered: true, lean: true });
    inserted += docs.length;
  }

  let activated = null;
  if (values.activate) {
    const primary = getTemplates()[0];
    activated = await Graph.findOneAndUpdate(
      { templateKey: primary.key },
      { $set: { isActive: true } },
      { new: true },
    ).select('_id name').lean();
  }

  logger.info({
    devices: devices.length,
    templates: getTemplates().length,
    historicalReadings: inserted,
    flaggedActive: activated ? activated.name : null,
  }, values.activate ? 'Demo bootstrap complete' : 'Seed complete');

  if (activated) {
    console.log(`\n  "${activated.name}" is flagged isActive=true.`);
    console.log('  Start the server (npm start) and it will be recompiled automatically.');
  }
} catch (error) {
  logger.fatal({ err: error }, 'Seed failed');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
