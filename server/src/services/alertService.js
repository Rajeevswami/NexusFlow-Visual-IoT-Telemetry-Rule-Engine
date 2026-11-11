import { Alert } from '../models/Alert.js';

/**
 * Persist an alert raised by an action node.
 *
 * Never throws: persistence must not break the RxJS pipeline, it only means the alert
 * is not recorded.
 *
 * @param {{ graphId?: string, nodeId: string, type: string, deviceId?: string,
 *           sensorType?: string, value?: number, message: string, triggeredAt?: Date }} alert
 * @returns {Promise<object | null>} the saved document, or null when it could not be stored
 */
export async function recordAlert(alert) {
  try {
    const saved = await Alert.create({
      graphId: alert.graphId || undefined,
      nodeId: alert.nodeId,
      type: alert.type,
      deviceId: alert.deviceId ?? 'unknown',
      sensorType: alert.sensorType,
      value: alert.value,
      message: alert.message,
      triggeredAt: alert.triggeredAt ?? new Date(),
    });
    return saved.toObject();
  } catch (error) {
    console.error(`Failed to persist alert for node ${alert.nodeId}: ${error.message}`);
    return null;
  }
}

/**
 * @param {string} graphId
 * @param {number} [limit]
 */
export async function listAlerts(graphId, limit = 50) {
  return Alert.find({ graphId }).sort({ triggeredAt: -1 }).limit(Math.min(limit, 500)).lean();
}
