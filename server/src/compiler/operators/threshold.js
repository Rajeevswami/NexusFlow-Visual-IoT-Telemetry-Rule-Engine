import { filter } from 'rxjs';
import { registerNode } from '../nodeRegistry.js';

/** Supported comparison operators (mirrored by the client dropdown). */
export const THRESHOLD_OPERATORS = ['>', '>=', '<', '<=', '==', '!='];

const comparators = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

/**
 * Pass through only the events that satisfy `value <operator> threshold`.
 *
 * @param {string} operator one of THRESHOLD_OPERATORS
 * @param {number} value threshold
 */
export function threshold(operator = '>', value = 0) {
  const compare = comparators[operator];
  if (!compare) throw new Error(`Unsupported threshold operator "${operator}".`);
  const limit = Number(value);
  return (source$) => source$.pipe(filter((event) => compare(Number(event.value), limit)));
}

registerNode({
  type: 'threshold',
  category: 'math',
  label: 'Threshold',
  defaults: { operator: '>', value: 80 },
  validate(config) {
    const errors = [];
    if (config.operator !== undefined && !THRESHOLD_OPERATORS.includes(config.operator)) {
      errors.push(`operator must be one of ${THRESHOLD_OPERATORS.join(', ')}.`);
    }
    if (config.value !== undefined && typeof config.value !== 'number') {
      errors.push('value must be a number.');
    }
    return errors;
  },
  createOperator: (config) => threshold(config.operator, config.value),
});
