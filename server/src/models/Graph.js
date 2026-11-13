import mongoose from 'mongoose';

const graphSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  // React Flow owns the node/edge shape; retain its raw JSON without stripping fields.
  nodes: { type: [mongoose.Schema.Types.Mixed], default: [] },
  edges: { type: [mongoose.Schema.Types.Mixed], default: [] },
  viewport: { type: mongoose.Schema.Types.Mixed },
  // Reserved for idempotent seeds/demo templates; ordinary user graphs leave this unset.
  templateKey: { type: String, trim: true, maxlength: 80 },
}, { timestamps: true, minimize: false, versionKey: false });
graphSchema.index({ templateKey: 1 }, { unique: true, sparse: true });

export const Graph = mongoose.model('Graph', graphSchema);
