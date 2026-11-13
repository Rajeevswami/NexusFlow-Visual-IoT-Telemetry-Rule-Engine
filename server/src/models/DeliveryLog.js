import mongoose from 'mongoose';

const deliveryLogSchema = new mongoose.Schema({
  alertId: { type: mongoose.Schema.Types.ObjectId, ref: 'Alert', index: true },
  graphId: { type: mongoose.Schema.Types.ObjectId, ref: 'Graph' },
  nodeId: { type: String, required: true, maxlength: 200 },
  channel: { type: String, enum: ['sms', 'webhook', 'email'], required: true },
  target: { type: String, required: true, maxlength: 4096 },
  status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
  attempts: { type: Number, default: 0, min: 0 },
  responseCode: { type: Number, default: null },
  error: { type: String, default: null, maxlength: 300 },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  // Private retry snapshot. Never returned by the public API or written to logs.
  // Protect this collection with MongoDB access control/encryption in a real deployment.
  request: { type: mongoose.Schema.Types.Mixed, select: false },
}, { versionKey: false });
deliveryLogSchema.index({ graphId: 1, createdAt: -1 });
deliveryLogSchema.index({ status: 1, createdAt: -1 });
export const DeliveryLog = mongoose.model('DeliveryLog', deliveryLogSchema);

/** Explicit public projection: no auth headers, URL query strings or full phone numbers. */
export function deliveryDto(document) {
  const item = document.toObject ? document.toObject() : document;
  const { request, target, ...publicFields } = item;
  let safe = target;
  if (item.channel === 'sms') safe = `${String(target).slice(0, 1)}******${String(target).slice(-4)}`;
  else if (item.channel === 'email') {
    const at = String(target).indexOf('@');
    safe = at > 0 ? `${target[0]}***${target.slice(at)}` : '[masked email]';
  } else {
    try { const url = new URL(target); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; safe = url.toString(); }
    catch { safe = '[invalid URL]'; }
  }
  return { ...publicFields, target: safe };
}
