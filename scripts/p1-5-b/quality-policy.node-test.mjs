import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CANDIDATE, ProbeBackoffPolicy, effectiveTargetHz, probeDelayMs, simulateLoadModel } from './quality-policy.mjs';

test('effective target is bounded by calibrated browser RAF and engine cap', () => {
  assert.equal(effectiveTargetHz(100, 60), 60);
  assert.equal(effectiveTargetHz(60, 100), 60);
  assert.equal(effectiveTargetHz(100, null), 100);
});

test('probe backoff doubles and is capped', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(count => probeDelayMs(count)), [10_000, 20_000, 40_000, 60_000, 60_000]);
});

test('serious low frequency protects the page before the legacy five-second threshold', () => {
  const policy = new ProbeBackoffPolicy({ browserRafReferenceHz: 60, engineConfiguredCapHz: 60 });
  policy.sample({ atMs: 0, updateHz: 20, intervalP95Ms: 50 });
  policy.sample({ atMs: 1_000, updateHz: 20, intervalP95Ms: 50 });
  const result = policy.sample({ atMs: 2_000, updateHz: 20, intervalP95Ms: 50 });
  assert.equal(result.action, 'enter-low');
  assert.equal(policy.mode, 'low');
});

test('healthy low-mode cadence alone cannot recover normal quality', () => {
  const simulation = simulateLoadModel({
    durationMs: 90_000,
    normalLoad: { updateHz: 21, intervalP95Ms: 50 },
    lowLoad: { updateHz: 60, intervalP95Ms: 16.7 },
    browserRafReferenceHz: 60,
    engineConfiguredCapHz: 60,
  });
  assert.equal(simulation.finalMode, 'low');
  assert.equal(simulation.transitions.filter(item => item.to === 'normal').length, 0);
  assert.ok(simulation.transitions.some(item => item.reason === 'normal-load-probe-failed'));
});

test('repeated failed probes back off instead of periodic normal/low oscillation', () => {
  const simulation = simulateLoadModel({
    durationMs: 180_000,
    normalLoad: { updateHz: 21, intervalP95Ms: 50 },
    lowLoad: { updateHz: 60, intervalP95Ms: 16.7 },
    browserRafReferenceHz: 60,
    engineConfiguredCapHz: 60,
  });
  const starts = simulation.transitions.filter(item => item.to === 'probe').map(item => item.atMs);
  const gaps = starts.slice(1).map((time, index) => time - starts[index]);
  assert.ok(gaps[1] > gaps[0]);
  assert.ok(Math.max(...gaps) <= DEFAULT_CANDIDATE.maxProbeDelayMs + 2_000);
});

test('normal-load probe recovers after the modeled load improves', () => {
  const simulation = simulateLoadModel({
    durationMs: 120_000,
    reliefAtMs: 35_000,
    normalLoad: { updateHz: 21, intervalP95Ms: 50 },
    relievedNormalLoad: { updateHz: 59, intervalP95Ms: 16.8 },
    lowLoad: { updateHz: 60, intervalP95Ms: 16.7 },
    browserRafReferenceHz: 60,
    engineConfiguredCapHz: 60,
  });
  const recovery = simulation.transitions.find(item => item.reason === 'normal-load-probe-passed');
  assert.ok(recovery);
  assert.ok(recovery.atMs >= 35_000);
  assert.equal(simulation.finalMode, 'normal');
});

test('paused samples do not accumulate degradation evidence or switch mode', () => {
  const policy = new ProbeBackoffPolicy({ browserRafReferenceHz: 60, engineConfiguredCapHz: 60 });
  policy.sample({ atMs: 0, updateHz: 20, intervalP95Ms: 50 });
  policy.sample({ atMs: 30_000, updateHz: 0, intervalP95Ms: 1_000, paused: true });
  assert.equal(policy.mode, 'normal');
  const resumed = policy.sample({ atMs: 31_000, updateHz: 60, intervalP95Ms: 16.7 });
  assert.equal(resumed.action, 'hold');
  assert.equal(policy.mode, 'normal');
});
