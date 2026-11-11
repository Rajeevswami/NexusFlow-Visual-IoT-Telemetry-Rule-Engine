import { Subject, take } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { movingAverage } from '../../src/compiler/operators/movingAverage.js';
import { threshold } from '../../src/compiler/operators/threshold.js';
import { scale } from '../../src/compiler/operators/scale.js';

const event = (value, extra = {}) => ({ deviceId: 'turbine-001', sensorType: 'temperature', unit: '°C', value, ...extra });

/**
 * Push values through an operator and return every emission.
 *
 * `expected` uses `take()` instead of completing the Subject: `bufferCount` flushes its
 * partial window on completion, which never happens in production (source Subjects are hot).
 *
 * @param {(source$: any) => any} operator
 * @param {number[]} values
 * @param {number} expected how many emissions to wait for
 */
function collect(operator, values, expected) {
  const subject = new Subject();
  const results = [];
  const subscription = subject.pipe(operator, take(expected)).subscribe((next) => results.push(next));
  for (const value of values) subject.next(event(value));
  subscription.unsubscribe();
  return results;
}

describe('movingAverage', () => {
  it('emits one average per reading once the window is full', () => {
    expect(collect(movingAverage(3), [10, 20, 30, 40], 2).map((result) => result.value)).toEqual([20, 30]);
  });

  it('keeps the metadata of the newest reading and records the window', () => {
    const results = collect(movingAverage(2), [4, 8], 1);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ deviceId: 'turbine-001', sensorType: 'temperature', unit: '°C', value: 6, samples: 2, window: [4, 8] });
  });

  it('supports a window of one (pass-through)', () => {
    expect(collect(movingAverage(1), [7, 9], 2).map((result) => result.value)).toEqual([7, 9]);
  });

  it('rounds nothing and keeps fractional averages', () => {
    expect(collect(movingAverage(3), [70, 85, 90], 1)[0].value).toBeCloseTo(81.6667, 4);
  });
});

describe('threshold', () => {
  it('passes only values matching the operator', () => {
    expect(collect(threshold('>', 80), [70, 81, 80, 95], 2).map((result) => result.value)).toEqual([81, 95]);
    expect(collect(threshold('>=', 80), [70, 80, 95], 2).map((result) => result.value)).toEqual([80, 95]);
    expect(collect(threshold('<', 80), [70, 80, 95], 1).map((result) => result.value)).toEqual([70]);
    expect(collect(threshold('<=', 80), [70, 80, 95], 2).map((result) => result.value)).toEqual([70, 80]);
    expect(collect(threshold('==', 80), [70, 80, 95], 1).map((result) => result.value)).toEqual([80]);
    expect(collect(threshold('!=', 80), [70, 80, 95], 2).map((result) => result.value)).toEqual([70, 95]);
  });

  it('rejects unsupported operators', () => {
    expect(() => threshold('~', 1)).toThrow(/Unsupported threshold operator/);
  });
});

describe('scale', () => {
  it('applies factor and offset', () => {
    expect(collect(scale(2, 1), [0, 5], 2).map((result) => result.value)).toEqual([1, 11]);
  });
});

describe('operator composition', () => {
  it('chains movingAverage then threshold like the compiler does', () => {
    const results = collect((source$) => source$.pipe(movingAverage(3), threshold('>', 80)), [70, 85, 90, 95], 2);
    // windows: [70,85,90] -> 81.67 (fires), [85,90,95] -> 90 (fires)
    expect(results.map((result) => Number(result.value.toFixed(2)))).toEqual([81.67, 90]);
  });
});
