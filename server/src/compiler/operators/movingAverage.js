import { bufferCount, map } from 'rxjs';
import { registerNode } from '../nodeRegistry.js';

/**
 * Sliding-window average.
 *
 * `bufferCount(windowSize, 1)` emits a new buffer on every event (startOffset = 1), so the
 * average updates on each reading once the window is full.
 *
 * @param {number} windowSize number of readings in the window (>= 1)
 * @returns {(source$: import('rxjs').Observable<object>) => import('rxjs').Observable<object>}
 */
export function movingAverage(windowSize = 5) {
  const size = Math.max(1, Math.floor(Number(windowSize) || 1));
  return (source$) => source$.pipe(
    bufferCount(size, 1),
    map((events) => {
      const sum = events.reduce((total, event) => total + Number(event.value), 0);
      const last = events[events.length - 1];
      return {
        ...last,
        value: sum / events.length,
        // Extra context for actions/UI: the raw window that produced this average.
        samples: events.length,
        window: events.map((event) => event.value),
      };
    }),
  );
}

registerNode({
  type: 'movingAverage',
  category: 'math',
  label: 'Moving Average',
  defaults: { windowSize: 5 },
  validate(config) {
    const errors = [];
    const { windowSize } = config;
    if (windowSize !== undefined && (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 1000)) {
      errors.push('windowSize must be an integer between 1 and 1000.');
    }
    return errors;
  },
  createOperator: (config) => movingAverage(config.windowSize),
});
