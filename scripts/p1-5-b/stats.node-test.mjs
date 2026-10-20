import test from 'node:test';
import assert from 'node:assert/strict';
import { dispersion, median } from './stats.mjs';

test('median and dispersion report robust center and spread for repeated runs', () => {
  assert.equal(median([1, 2, 100]), 2);
  assert.deepEqual(dispersion([1, 2, 3, 100]), { count: 4, median: 2, p25: 1, p75: 3, iqr: 2, min: 1, max: 100, mad: 1 });
});

test('dispersion keeps unavailable samples explicit', () => {
  assert.deepEqual(dispersion([]), { count: 0, median: null, p25: null, p75: null, iqr: null, min: null, max: null, mad: null });
});
