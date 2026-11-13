import logger from './logger.js';
import mongoose from 'mongoose';
import { env } from './env.js';

const collectionName = 'telemetry';
const expectedTimeSeries = {
  timeField: 'timestamp',
  metaField: 'metadata',
  granularity: 'seconds',
};

/** Create the collection before Mongoose can write any measurements to it. */
export async function ensureTelemetryCollection(db, retentionSeconds) {
  let existing = await db.listCollections({ name: collectionName }, { nameOnly: false }).next();

  if (!existing) {
    const options = { timeseries: expectedTimeSeries };
    if (retentionSeconds !== undefined) options.expireAfterSeconds = retentionSeconds;
    try {
      await db.createCollection(collectionName, options);
      logger.info('Created telemetry time-series collection.');
    } catch (error) {
      // Another app instance may have created the collection between our check and create.
      if (error.code !== 48 && error.codeName !== 'NamespaceExists') throw error;
    }
    existing = await db.listCollections({ name: collectionName }, { nameOnly: false }).next();
  }

  const actual = existing?.options?.timeseries;
  if (!actual || actual.timeField !== expectedTimeSeries.timeField || actual.metaField !== expectedTimeSeries.metaField || actual.granularity !== expectedTimeSeries.granularity) {
    throw new Error('Existing telemetry collection is not the expected time-series collection (timestamp, metadata, seconds). Refusing to modify it.');
  }

  // Retention is deliberately creation-only; silently changing it could delete existing data.
  const existingRetention = existing.options.expireAfterSeconds;
  if (retentionSeconds !== undefined && Number(existingRetention) !== retentionSeconds) {
    logger.warn('TELEMETRY_RETENTION_SECONDS differs from the existing collection. The existing retention setting was not changed.');
  }

  await db.collection(collectionName).createIndex(
    { 'metadata.deviceId': 1, timestamp: -1 },
    { name: 'device_timestamp' },
  );
}

export async function connectDatabase() {
  // Fail operations rather than buffering them indefinitely during a disconnect.
  mongoose.set('bufferCommands', false);
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 5000 });
  await ensureTelemetryCollection(mongoose.connection.db, env.telemetryRetentionSeconds);
  logger.info(`MongoDB connected: ${mongoose.connection.name}`);
}
