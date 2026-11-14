import mongoose from 'mongoose';
import { parseArgs } from 'node:util';
import { connectDatabase } from '../src/config/db.js';
import { logger } from '../src/config/logger.js';
import { env } from '../src/config/env.js';

/**
 * Time-series storage report.
 *
 * Compares the `telemetry` time-series collection with an ordinary collection
 * (`telemetry_regular`) holding exactly the same documents, using the server's own
 * `collStats`/`dbStats` numbers:
 *
 *   document count | data size | storage size | average object size
 *
 * Usage
 *   npm run storage-report                        # every telemetry document
 *   npm run storage-report -- --limit 100000      # cap the copied sample
 *   npm run storage-report -- --regular telemetry_regular --keep
 *
 * Why this matters: a time-series collection stores measurements in internal buckets
 * keyed by metaField, so repeated metadata (deviceId, sensorType, location) is written
 * once per bucket instead of once per document. The savings are what makes long
 * retention affordable.
 */

const { values } = parseArgs({ options: {
  limit: { type: 'string', default: '0' },
  regular: { type: 'string', default: 'telemetry_regular' },
  keep: { type: 'boolean', default: false },
  batch: { type: 'string', default: '1000' },
} });

const limit = Number(values.limit);
const batchSize = Number(values.batch);
const regularName = String(values.regular);
if (!Number.isInteger(limit) || limit < 0 || limit > 10_000_000) {
  console.error('Use --limit 0 (all documents) or a positive count up to 10000000.');
  process.exit(1);
}
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
  console.error('Use --batch 1..1000.');
  process.exit(1);
}

const bytes = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(3)} GiB`;
};

const ratio = (a, b) => (b > 0 ? `${(a / b).toFixed(2)}x` : 'n/a');
const row = (label, a, b) => `  ${label.padEnd(24)} ${String(a).padStart(16)} ${String(b).padStart(16)}`;

async function stats(db, name) {
  const info = await db.command({ collStats: name, scale: 1 });
  return {
    count: info.count ?? 0,
    size: info.size ?? 0,
    storageSize: info.storageSize ?? 0,
    avgObjSize: info.avgObjSize ?? (info.count ? info.size / info.count : 0),
    nindexes: info.nindexes ?? 0,
    totalIndexSize: info.totalIndexSize ?? 0,
    capped: Boolean(info.capped),
  };
}

try {
  await connectDatabase();
  const db = mongoose.connection.db;

  const timeSeries = await stats(db, 'telemetry');
  const tsInfo = (await db.listCollections({ name: 'telemetry' }, { nameOnly: false }).next())?.options?.timeseries ?? null;

  /* ------------------------------------------- copy the same data into a normal collection */
  const cursor = db.collection('telemetry').find({}, { batchSize }).sort({ timestamp: 1, _id: 1 });
  const target = db.collection(regularName);
  await target.drop().catch(() => {}); // idempotent: always compare a fresh copy
  let copied = 0;
  let buffer = [];
  for await (const document of cursor) {
    buffer.push(document);
    if (buffer.length >= batchSize) {
      await target.insertMany(buffer, { ordered: false });
      copied += buffer.length;
      buffer = [];
      if (limit && copied >= limit) break;
    }
  }
  if (buffer.length) {
    await target.insertMany(buffer, { ordered: false });
    copied += buffer.length;
  }

  // A regular collection is only comparable if it is indexed like the time-series one.
  await target.createIndex({ 'metadata.deviceId': 1, timestamp: -1 }, { name: 'device_timestamp' });

  const regular = await stats(db, regularName);
  const savings = timeSeries.storageSize > 0
    ? (100 * (1 - timeSeries.storageSize / regular.storageSize))
    : 0;

  console.log('---------------- NexusFlow storage report ----------------');
  console.log(`  telemetry collection    time-series${tsInfo ? ` (timeField ${tsInfo.timeField}, metaField ${tsInfo.metaField}, granularity ${tsInfo.granularity})` : ''}`);
  console.log(`  comparison collection   ${regularName} (ordinary collection, same documents)`);
  console.log('');
  console.log(`  ${'metric'.padEnd(24)} ${'time-series'.padStart(16)} ${'regular'.padStart(16)}`);
  console.log(row('documents', timeSeries.count.toLocaleString(), regular.count.toLocaleString()));
  console.log(row('data size', bytes(timeSeries.size), bytes(regular.size)));
  console.log(row('storage size', bytes(timeSeries.storageSize), bytes(regular.storageSize)));
  console.log(row('avg object size', bytes(timeSeries.avgObjSize), bytes(regular.avgObjSize)));
  console.log(row('indexes', `${timeSeries.nindexes} (${bytes(timeSeries.totalIndexSize)})`, `${regular.nindexes} (${bytes(regular.totalIndexSize)})`));
  console.log('');
  console.log(`  documents copied        ${copied.toLocaleString()}${limit ? ` (capped at ${limit.toLocaleString()})` : ''}`);
  console.log(`  storage size ratio      ${ratio(timeSeries.storageSize, regular.storageSize)}  (time-series / regular)`);
  console.log(`  storage saving          ${savings.toFixed(1)}%`);
  console.log('----------------------------------------------------------');
  console.log(JSON.stringify({
    storage: 'telemetry-vs-regular',
    timeSeries: { count: timeSeries.count, size: timeSeries.size, storageSize: timeSeries.storageSize, avgObjSize: Math.round(timeSeries.avgObjSize), nindexes: timeSeries.nindexes },
    regular: { collection: regularName, count: regular.count, size: regular.size, storageSize: regular.storageSize, avgObjSize: Math.round(regular.avgObjSize), nindexes: regular.nindexes },
    storageSizeRatio: Number(ratio(timeSeries.storageSize, regular.storageSize).replace('x', '')),
    storageSavingPercent: Number(savings.toFixed(1)),
    documentsCopied: copied,
  }));

  if (!values.keep) await target.drop().catch(() => {});
  else console.log(`  kept ${regularName} for inspection.`);
} catch (error) {
  logger.fatal({ err: error }, 'Storage report failed');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
