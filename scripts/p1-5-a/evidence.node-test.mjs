import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => JSON.parse(readFileSync(`docs/nexus-p1-5-a/evidence/${file}`, 'utf8'));
const comparison = read('comparison.json');
const formal = read('formal-results.json');
const series = read('time-series.json');
const traces = read('trace-summary.json');
const backends = read('backend-records.json');
const integrity = read('product-integrity.json');
const manifest = read('evidence-manifest.json');

test('formal matrix covers two backends, two engines, and two resolutions exactly once', () => {
  assert.equal(formal.length, 8);
  const ids = formal.map(item => `${item.backend}:${item.id}`).sort();
  assert.deepEqual(ids, [
    'headed:gsap-1920', 'headed:gsap-3840', 'headed:legacy-1920', 'headed:legacy-3840',
    'headless:gsap-1920', 'headless:gsap-3840', 'headless:legacy-1920', 'headless:legacy-3840',
  ]);
});

test('all formal windows are approximately sixty seconds with at least sixty timeline points', () => {
  for (const item of formal) {
    assert.ok(item.duration.actualMs >= 59_000 && item.duration.actualMs <= 62_000, `${item.backend}:${item.id}`);
    assert.ok(item.sampleCounts.timeSeries >= 60, `${item.backend}:${item.id}`);
  }
});

test('fixture, random conditions, and renderer classifications are comparable and explicit', () => {
  assert.equal(backends.headless.fixture.normalizedSha256, backends.headed.fixture.normalizedSha256);
  assert.deepEqual(backends.headless.rendererClassification, { acceleration: 'software', backend: 'SwiftShader', confidence: 'high' });
  assert.deepEqual(backends.headed.rendererClassification, { acceleration: 'hardware', backend: 'ANGLE Metal', confidence: 'high' });
});

test('RAF, GSAP ticker estimate, and MotionDirector update fields remain distinct', () => {
  const gsapMetal = comparison.find(item => item.backend === 'headed' && item.engine === 'gsap' && item.width === 3840);
  assert.ok(gsapMetal.browserRafProxyHz > 95);
  assert.ok(gsapMetal.engineCallbackHz > 95);
  assert.ok(gsapMetal.gsapTickerListenerHzEstimate > 55 && gsapMetal.gsapTickerListenerHzEstimate < 65);
  assert.ok(gsapMetal.motionDirectorUpdateHz > 55 && gsapMetal.motionDirectorUpdateHz < 65);
});

test('quality timeline preserves software 4K oscillation instead of only an average', () => {
  for (const engine of ['legacy', 'gsap']) {
    const item = comparison.find(row => row.backend === 'headless' && row.engine === engine && row.width === 3840);
    assert.equal(item.downshifts, 4);
    assert.equal(item.recoveries, 3);
    const timeline = series.find(row => row.backend === 'headless' && row.id === `${engine}-3840`);
    assert.ok(timeline.points.some(point => point.level === 'normal'));
    assert.ok(timeline.points.some(point => point.level === 'low'));
  }
});

test('page and HTTP errors are zero while teardown RSC aborts remain explicitly classified', () => {
  let aborts = 0;
  for (const item of formal) {
    assert.equal(item.networkClassification.pageErrors, 0);
    assert.equal(item.networkClassification.httpFailures, 0);
    assert.equal(item.networkClassification.otherNetworkFailures, 0);
    aborts += item.networkClassification.abortedRscPrefetches;
  }
  assert.equal(aborts, 10);
});

test('all eight trace summaries retain non-additive cost caveats', () => {
  assert.equal(traces.length, 8);
  for (const item of traces) {
    assert.equal(item.interpretation.additive, false);
    assert.match(item.interpretation.warning, /not be summed|must not be summed/i);
  }
});

test('product files match P1.4 and protected worktrees remain at their requested commits', () => {
  assert.equal(integrity.productFilesMatchBaseline, true);
  assert.ok(integrity.p14EvidenceStillTracked > 0);
  for (const item of integrity.protectedWorktrees) {
    assert.equal(item.actualHead, item.expectedHead);
    assert.equal(item.status, '');
  }
});

test('raw evidence manifest covers trace and screenshot phases with SHA-256 values', () => {
  assert.ok(manifest.rawEvidence.filter(item => item.path.endsWith('.trace.json.gz')).length === 8);
  assert.ok(manifest.rawEvidence.filter(item => item.path.endsWith('.png')).length === 16);
  for (const item of manifest.rawEvidence) assert.match(item.sha256, /^[0-9a-f]{64}$/);
});
