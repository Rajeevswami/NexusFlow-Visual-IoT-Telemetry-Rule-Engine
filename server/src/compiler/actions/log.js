import logger from '../../config/logger.js';
import { registerNode } from '../nodeRegistry.js';
import { recordAlert } from '../../services/alertService.js';
import { cooldownErrors, renderTemplate } from './template.js';

/**
 * Console action — the cheapest way to see a pipeline working during development
 * and the action used by the unit tests.
 */
export function createLogAction(config, context) {
  const prefix = String(config.label ?? '').trim() || 'log';

  return async (event) => {
    const message = renderTemplate(config.template || '${deviceId} ${sensorType} = ${value}${unit}', event);
    const result = {
      nodeId: context.nodeId,
      type: 'log',
      deviceId: event?.deviceId ?? 'unknown',
      sensorType: event?.sensorType,
      value: event?.value,
      message,
      triggeredAt: new Date(),
      delivered: true,
      dryRun: Boolean(context.dryRun),
    };

    // Dry runs collect results in memory; keep the test output quiet.
    if (!context.dryRun) {
      logger.info({ action: prefix, message }, 'Pipeline log action');
      await recordAlert({
        graphId: context.graphId,
        nodeId: context.nodeId,
        type: 'log',
        deviceId: result.deviceId,
        sensorType: result.sensorType,
        value: result.value,
        message,
        triggeredAt: result.triggeredAt,
      });
    }
    return result;
  };
}

registerNode({
  type: 'log',
  category: 'action',
  label: 'Log',
  defaults: { label: 'pipeline', template: '${deviceId} ${sensorType} = ${value}${unit}', cooldownSeconds: 0 },
  validate(config) {
    const errors = [];
    if (config.label !== undefined && String(config.label).length > 60) errors.push('label must be 60 characters or fewer.');
    errors.push(...cooldownErrors(config));
    return errors;
  },
  createAction: createLogAction,
});
