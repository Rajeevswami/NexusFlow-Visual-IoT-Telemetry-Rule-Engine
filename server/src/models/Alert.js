import mongoose from 'mongoose';

/**
 * Alerts raised by action nodes of a compiled pipeline.
 * Stored in a normal collection (not time-series) because alerts are low volume,
 * are read by id/graph and are kept for auditing.
 */
const alertSchema = new mongoose.Schema({
  graphId: { type: mongoose.Schema.Types.ObjectId, ref: 'Graph', index: true },
  nodeId: { type: String, required: true, trim: true },
  type: { type: String, required: true, trim: true },
  deviceId: { type: String, required: true, trim: true, index: true },
  sensorType: { type: String, trim: true },
  value: { type: Number },
  message: { type: String, required: true },
  triggeredAt: { type: Date, default: Date.now },
  // Additive Day-4 audit links. Older alerts remain valid and display "not tracked".
  deliveryIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryLog' }], default: [] },
  deliveryStatus: { type: String, enum: ['pending', 'success', 'failed'], default: undefined },
}, { timestamps: false, versionKey: false });
alertSchema.index({ triggeredAt: -1 });

export const Alert = mongoose.model('Alert', alertSchema);
