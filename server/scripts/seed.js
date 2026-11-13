import mongoose from 'mongoose';
import { connectDatabase } from '../src/config/db.js';
import { logger } from '../src/config/logger.js';
import { Device } from '../src/models/Device.js';
import { Graph } from '../src/models/Graph.js';
import { Telemetry } from '../src/models/Telemetry.js';
import { getTemplates } from '../src/data/templates.js';

try {
  await connectDatabase();
  const devices = [
    { deviceId: 'turbine-001', name: 'Turbine 001', type: 'wind-turbine', location: 'Jaipur Demo Site' },
    { deviceId: 'temp-001', name: 'Ambient sensor', type: 'temperature-sensor', location: 'Jaipur Demo Site' },
  ];
  for (const device of devices) await Device.updateOne({ deviceId: device.deviceId }, { $set: device }, { upsert: true });
  for (const template of getTemplates()) {
    await Graph.updateOne({ templateKey: template.key }, { $set: template.graph }, { upsert: true, runValidators: true });
  }
  let inserted = 0;
  const end = Date.now();
  for (const device of devices) {
    // A location marker makes repeated seeds idempotent without deleting user telemetry.
    const marker = { 'metadata.deviceId': device.deviceId, 'metadata.location': 'Seed history' };
    if (await Telemetry.exists(marker)) continue;
    const readings = [];
    for (let i = 0; i < 180; i += 1) {
      const timestamp = new Date(end - (180 - i) * 10_000);
      const sensors = device.deviceId === 'turbine-001'
        ? [['temperature', 55 + 20 * Math.sin(i / 9), '°C'], ['vibration', 2 + Math.sin(i / 5), 'mm/s'], ['pressure', 4 + Math.cos(i / 8), 'bar']]
        : [['temperature', 28 + 4 * Math.sin(i / 12), '°C']];
      for (const [sensorType, value, unit] of sensors) readings.push({ timestamp,
        metadata: { deviceId: device.deviceId, sensorType, location: 'Seed history' }, value: Math.round(value * 100) / 100, unit });
    }
    const docs = await Telemetry.insertMany(readings, { ordered: true, lean: true });
    inserted += docs.length;
  }
  logger.info({ devices: devices.length, templates: getTemplates().length, historicalReadings: inserted }, 'Seed complete');
} catch (error) {
  logger.fatal({ err: error }, 'Seed failed');
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
