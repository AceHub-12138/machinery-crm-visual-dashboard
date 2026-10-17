import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRenderer,
  estimateMissedOpportunities,
  nearestRank,
  summarizeIntervals,
  summarizeLongTasks,
  transitionSummary,
} from './metrics.mjs';

test('nearest-rank percentiles do not interpolate away observed tail values', () => {
  assert.equal(nearestRank([10, 20, 30, 40], 0.95), 40);
  assert.equal(nearestRank([], 0.95), null);
});
test('cadence summary reports rate and p95/p99 from interval samples', () => {
  const result = summarizeIntervals([10, 10, 20, 50], 90);
  assert.equal(result.intervalCount, 4);
  assert.equal(result.rateHz, 4000 / 90);
  assert.equal(result.intervalP95Ms, 50);
  assert.equal(result.intervalP99Ms, 50);
});

test('missed opportunities use the calibrated interval instead of a fixed 60Hz constant', () => {
  const result = estimateMissedOpportunities([10, 20, 30], 10);
  assert.equal(result.estimatedMissedCallbackOpportunities, 3);
  assert.equal(result.estimatedMissedOpportunityPercent, 50);
  assert.match(result.caveat, /not .* actual displayed-frame loss/i);
});

test('long-task summary includes total blocking time above the 50ms threshold', () => {
  const result = summarizeLongTasks([{ duration: 40 }, { duration: 75 }, { duration: 100 }]);
  assert.equal(result.count, 3);
  assert.equal(result.totalBlockingTimeMs, 75);
  assert.equal(result.p99Ms, 100);
});

test('renderer classification separates SwiftShader and Metal and otherwise stays unknown', () => {
  assert.equal(classifyRenderer({ device: 'SwiftShader Device' }).acceleration, 'software');
  assert.equal(classifyRenderer({ device: 'ANGLE Metal Renderer: Apple M1 Ultra' }).acceleration, 'hardware');
  assert.equal(classifyRenderer({
    gpu: { devices: [{ deviceString: 'ANGLE Metal Renderer: Apple M1 Ultra' }] },
    commandLine: '--enable-unsafe-swiftshader',
  }).acceleration, 'hardware');
  assert.equal(classifyRenderer({ device: 'opaque' }).acceleration, 'unknown');
});

test('quality transitions are derived from the timeline rather than final state', () => {
  const result = transitionSummary([
    { elapsedMs: 0, level: 'normal' },
    { elapsedMs: 6_000, level: 'low' },
    { elapsedMs: 17_000, level: 'normal' },
    { elapsedMs: 23_000, level: 'low' },
  ]);
  assert.equal(result.downshifts, 2);
  assert.equal(result.recoveries, 1);
  assert.equal(result.transitions.length, 3);
});
