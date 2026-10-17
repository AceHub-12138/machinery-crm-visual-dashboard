import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const reviewRoot = path.resolve('.review/p1-5-a');
const evidenceRoot = path.resolve('docs/nexus-p1-5-a/evidence');
mkdirSync(evidenceRoot, { recursive: true });

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeFileSync(path.join(evidenceRoot, file), JSON.stringify(value, null, 2));
const round = value => Number.isFinite(value) ? Number(value.toFixed(3)) : value;
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

function calibratedPulses(result) {
  return result.pulseRequests.map(request => {
    const next = result.qualityTimeline.find(row => row.elapsedMs > request.observedAtMs && row.elapsedMs <= request.observedAtMs + 1_500);
    const accepted = request.beforeLevel === 'normal' && request.beforeState !== 'PULSE';
    return {
      ...request,
      accepted,
      rejectionReason: accepted ? null : request.beforeLevel !== 'normal' ? 'motion-level-not-normal' : 'pulse-already-active',
      nextObservedState: next?.state ?? 'unknown',
      acceptanceMethod: 'Derived from unchanged synchronous trigger preconditions; next one-second sample retained as corroborating observation because stage dataset updates on draw.',
    };
  });
}

const backends = {};
const timeSeries = [];
const formalResults = [];
for (const backend of ['headless', 'headed']) {
  const source = readJson(path.join(reviewRoot, backend, 'benchmark.json'));
  backends[backend] = {
    environment: source.environment,
    rendererClassification: source.rendererClassification,
    fixture: source.fixture,
    methodology: source.methodology,
  };
  for (const result of source.formalResults) {
    const pulses = calibratedPulses(result);
    const networkClassification = {
      pageErrors: result.errors.length,
      httpFailures: result.networkFailures.filter(item => Number.isFinite(item.status) && item.status >= 400).length,
      abortedRscPrefetches: result.networkFailures.filter(item => item.error === 'net::ERR_ABORTED' && item.url.includes('_rsc=')).length,
      otherNetworkFailures: result.networkFailures.filter(item => !(item.error === 'net::ERR_ABORTED' && item.url.includes('_rsc=')) && !(Number.isFinite(item.status) && item.status >= 400)).length,
      interpretation: 'RSC ERR_ABORTED entries are retained raw. They are hidden engine-link prefetches cancelled during page/context teardown, not HTTP failures.',
    };
    const calibrated = {
      backend,
      id: result.id,
      engine: result.engine,
      engineType: result.engineType,
      viewport: result.viewport,
      headless: result.headless,
      duration: result.duration,
      calibration: result.calibration,
      sampleCounts: result.sampleCounts,
      metrics: result.metrics,
      mainThreadCdpDelta: result.mainThreadCdpDelta,
      qualityPolicy: result.qualityPolicy,
      qualityTransitions: result.qualityTransitions,
      pulseRequests: pulses,
      resonanceRejectedBecauseLow: pulses.filter(request => request.rejectionReason === 'motion-level-not-normal').length,
      rendererClassification: result.rendererClassification,
      webgl: result.webgl,
      errors: result.errors,
      networkFailures: result.networkFailures,
      networkClassification,
    };
    formalResults.push(calibrated);
    timeSeries.push({ backend, id: result.id, points: result.qualityTimeline });
  }
}

const comparison = formalResults.map(result => ({
  backend: result.backend,
  renderer: result.rendererClassification.backend,
  headless: result.headless,
  engine: result.engine,
  width: result.viewport.width,
  height: result.viewport.height,
  durationMs: result.duration.actualMs,
  browserRafProxyHz: round(result.metrics.browserRafProxy.rateHz),
  engineCallbackHz: round(result.metrics.engineClock.rateHz),
  gsapTickerListenerHzEstimate: round(result.metrics.gsapTicker?.observedListenerUpdateHzEstimate ?? null),
  motionDirectorUpdateHz: round(result.metrics.motionDirector.meanHz),
  intervalP95Ms: round(result.metrics.engineClock.intervalP95Ms),
  intervalP99Ms: round(result.metrics.engineClock.intervalP99Ms),
  missedCallbackOpportunityPercent: round(result.metrics.missedCallbackOpportunities.estimatedMissedOpportunityPercent),
  longTasks: result.metrics.longTasks.count,
  totalBlockingTimeMs: round(result.metrics.longTasks.totalBlockingTimeMs),
  taskDurationSeconds: round(result.mainThreadCdpDelta.TaskDuration),
  scriptDurationSeconds: round(result.mainThreadCdpDelta.ScriptDuration),
  layoutDurationSeconds: round(result.mainThreadCdpDelta.LayoutDuration),
  recalcStyleDurationSeconds: round(result.mainThreadCdpDelta.RecalcStyleDuration),
  downshifts: result.qualityTransitions.downshifts,
  recoveries: result.qualityTransitions.recoveries,
  resonanceRejectedBecauseLow: result.resonanceRejectedBecauseLow,
}));

const traceSummary = readJson(path.join(reviewRoot, 'trace-summary.json'));
writeJson('backend-records.json', backends);
writeJson('formal-results.json', formalResults);
writeJson('comparison.json', comparison);
writeJson('time-series.json', timeSeries);
writeJson('trace-summary.json', traceSummary);

const rawFiles = [];
for (const backend of ['headless', 'headed']) {
  for (const engine of ['legacy', 'gsap']) for (const width of [1920, 3840]) {
    for (const suffix of ['formal.json', 'trace-metadata.json', 'visual.json', 'ambient.png', 'pulse.png', 'trace.json.gz']) {
      const file = path.join(reviewRoot, backend, `${engine}-${width}-${suffix}`.replace('-trace.json.gz', '.trace.json.gz'));
      if (!existsSync(file)) continue;
      rawFiles.push({
        path: path.relative(process.cwd(), file),
        bytes: statSync(file).size,
        sha256: sha256(file),
        phase: suffix.includes('trace') ? 'trace' : suffix.endsWith('.png') || suffix === 'visual.json' ? 'visual' : 'formal',
      });
    }
  }
  for (const fileName of ['benchmark.json', 'trace-summary.json']) {
    const file = path.join(reviewRoot, backend, fileName);
    if (existsSync(file)) rawFiles.push({ path: path.relative(process.cwd(), file), bytes: statSync(file).size, sha256: sha256(file), phase: fileName.startsWith('trace') ? 'trace' : 'formal' });
  }
}
writeJson('evidence-manifest.json', {
  generatedAt: new Date().toISOString(),
  baselines: {
    p14: 'df69d71f5b0cafcdab70a18f8e11be9f92cd163d',
    gsapPoc: '1f9e9cd6d78e12f85eee47d087c87191f90a0460',
    p13: '10a5e0b283b6ecae664cc64d44f7a9e88fb061f1',
  },
  committedEvidence: ['backend-records.json', 'formal-results.json', 'comparison.json', 'time-series.json', 'trace-summary.json', 'product-integrity.json'],
  rawEvidence: rawFiles,
  preservation: 'P1.4 evidence lives under docs/nexus-p1-4 and was not overwritten. P1.5-A raw traces/screenshots live only under .review/p1-5-a.',
});
console.log(JSON.stringify({ formalResults: formalResults.length, timeSeries: timeSeries.length, traces: traceSummary.length, rawFiles: rawFiles.length }, null, 2));
