import mongoose from 'mongoose';

const telemetrySchema = new mongoose.Schema({
  timestamp: { type: Date, required: true },
  metadata: {
    deviceId: { type: String, required: true },
    sensorType: { type: String, required: true },
    location: { type: String, required: true },
  },
  value: { type: Number, required: true },
  unit: { type: String, required: true },
}, {
  collection: 'telemetry',
  // Extra numeric measurements are validated at the API boundary.
  strict: false,
  versionKey: false,
  // The native driver must create the time-series collection before any writes.
  autoCreate: false,
  autoIndex: false,
});

export const Telemetry = mongoose.model('Telemetry', telemetrySchema);
