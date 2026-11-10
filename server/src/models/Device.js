import mongoose from 'mongoose';

const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, required: true, trim: true },
  location: { type: String, required: true, trim: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

export const Device = mongoose.model('Device', deviceSchema);
