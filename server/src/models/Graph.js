import mongoose from 'mongoose';

const graphSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  // React Flow owns the node/edge shape; retain its raw JSON without stripping fields.
  nodes: { type: [mongoose.Schema.Types.Mixed], default: [] },
  edges: { type: [mongoose.Schema.Types.Mixed], default: [] },
  viewport: { type: mongoose.Schema.Types.Mixed },
  // Reserved for idempotent seeds/demo templates; ordinary user graphs leave this unset.
  templateKey: { type: String, trim: true, maxlength: 80 },
  // Mirrors "a compiled pipeline for this graph is running in this process".
  // Set by ActiveGraphManager on activate/deactivate and read by the boot-time
  // re-hydration in server.js. It is a cache of runtime state, never a source of
  // truth for correctness: a stale `true` simply re-activates the graph on boot.
  isActive: { type: Boolean, default: false, index: true },
}, { timestamps: true, minimize: false, versionKey: false });
graphSchema.index({ templateKey: 1 }, { unique: true, sparse: true });

export const Graph = mongoose.model('Graph', graphSchema);
