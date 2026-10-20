import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => JSON.parse(readFileSync(`docs/nexus-p1-5-b/evidence/${name}`, 'utf8'));
const aggregate = read('aggregate.json');
const long = read('long-analysis.json');
const traces = read('trace-analysis.json');
const integrity = read('integrity.json');
const manifest = read('manifest.json');

test('frequency and candidate matrices contain three isolated repetitions per scenario', () => {
  assert.equal(aggregate.frequencyRuns.length, 72);
  assert.equal(aggregate.frequencySummary.length, 24);
  assert.equal(aggregate.strategyRuns.length, 36);
  assert.equal(aggregate.strategySummary.length, 12);
  for (const group of [...aggregate.frequencySummary, ...aggregate.strategySummary]) assert.equal(group.repetitions, 3);
});

test('same-target comparison separates healthy Metal from overloaded headless SwiftShader 4K', () => {
  const find = (backend, engine, width) => aggregate.frequencySummary.find(item => item.backend === backend && item.profile === 'shared60' && item.engine === engine && item.width === width);
  for (const engine of ['legacy', 'gsap']) {
    assert.ok(find('headed-metal', engine, 3840).metrics.directorHz.median > 59);
    assert.ok(find('headless-swiftshader', engine, 3840).metrics.directorHz.median < 25);
  }
});

test('candidate avoids formal oscillation in the three repeated overloaded 4K runs', () => {
  for (const engine of ['legacy', 'gsap']) {
    const group = aggregate.strategySummary.find(item => item.backend === 'headless-swiftshader' && item.engine === engine && item.width === 3840);
    assert.equal(group.metrics.downshifts.median, 1);
    assert.equal(group.metrics.probeStarts.median, 2);
    assert.equal(group.metrics.probeFailures.median, 2);
    assert.equal(group.metrics.fullRecoveries.median, 0);
  }
});

test('thirty-minute Luna run backs off, recovers after relief, and stays resource-stable', () => {
  assert.ok(long.duration.actualMs >= 1_800_000);
  assert.deepEqual(long.transitionCounts, { total: 55, downshifts: 1, probeStarts: 27, probeFailures: 26, fullRecoveries: 1 });
  assert.ok(long.recoveryAfterRelief.latencyMs > 40_000 && long.recoveryAfterRelief.latencyMs < 60_000);
  assert.equal(long.resourceSamples.total, 31);
  assert.equal(long.trends.heapUsedBytes.strictlyMonotonicIncrease, false);
  assert.equal(long.trends.domNodes.strictlyMonotonicIncrease, false);
  assert.equal(long.trends.eventListeners.strictlyMonotonicIncrease, false);
  assert.deepEqual([long.trends.activeTimeouts.first, long.trends.activeTimeouts.last], [0, 0]);
  assert.deepEqual([long.trends.activeIntervals.first, long.trends.activeIntervals.last], [3, 3]);
  assert.deepEqual([long.trends.pendingApplicationRaf.first, long.trends.pendingApplicationRaf.last], [1, 1]);
});

test('trace evidence has three repeats for all twelve same-target groups and remains non-additive', () => {
  assert.equal(traces.runs.length, 36);
  assert.equal(traces.summary.length, 12);
  for (const group of traces.summary) assert.equal(group.repetitions, 3);
  for (const run of traces.runs) assert.equal(run.interpretation.additive, false);
});

test('product diff is restricted to the explicit experimental quality isolation files', () => {
  assert.equal(integrity.onlyAllowedExperimentalProductFilesChanged, true);
  assert.equal(integrity.productDiff.length, 3);
  for (const item of integrity.protectedWorktrees) {
    assert.equal(item.actualHead, item.expectedHead);
    assert.equal(item.status, '');
  }
});

test('manifest retains all raw traces and reports with SHA-256 checksums', () => {
  assert.equal(manifest.rawFiles.filter(item => item.kind === 'raw-trace').length, 36);
  assert.ok(manifest.rawFiles.some(item => item.kind === 'long-report'));
  for (const item of manifest.rawFiles) assert.match(item.sha256, /^[0-9a-f]{64}$/);
});
