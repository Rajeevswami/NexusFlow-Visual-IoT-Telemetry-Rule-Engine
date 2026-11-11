import { map } from 'rxjs';
import { registerNode } from '../nodeRegistry.js';

/**
 * Linear transform: `value = value * factor + offset` (unit conversion, calibration...).
 *
 * @param {number} factor
 * @param {number} offset
 */
export function scale(factor = 1, offset = 0) {
  const k = Number(factor);
  const c = Number(offset);
  return (source$) => source$.pipe(map((event) => ({ ...event, value: Number(event.value) * k + c })));
}

registerNode({
  type: 'scale',
  category: 'math',
  label: 'Scale',
  defaults: { factor: 1, offset: 0 },
  validate(config) {
    const errors = [];
    for (const key of ['factor', 'offset']) {
      if (config[key] !== undefined && typeof config[key] !== 'number') errors.push(`${key} must be a number.`);
    }
    return errors;
  },
  createOperator: (config) => scale(config.factor, config.offset),
});
