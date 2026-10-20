import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] ?? '.review/p1-5-b/headless-swiftshader/long-candidate60/report.json';
const report = JSON.parse(readFileSync(file, 'utf8'));
if (!report.finishedAt || report.results.length !== 1) throw new Error('Long-run report is incomplete or ambiguous');
const run = report.results[0];

function linearSlope(rows, selector) {
  const points = rows.map(row => ({ x: row.elapsedMs / 60_000, y: selector(row) })).filter(point => Number.isFinite(point.y));
  if (points.length < 2) return null;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  return denominator ? points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0) / denominator : null;
}

function trend(rows, selector) {
  const values = rows.map(selector).filter(Number.isFinite);
  let increases = 0, decreases = 0;
  for (let index = 1; index < values.length; index++) {
    if (values[index] > values[index - 1]) increases++;
    if (values[index] < values[index - 1]) decreases++;
  }
  return {
    samples: values.length,
    first: values[0] ?? null,
    last: values.at(-1) ?? null,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    slopePerMinute: linearSlope(rows, selector),
    increases,
    decreases,
    strictlyMonotonicIncrease: values.length > 1 && increases === values.length - 1,
  };
}

const transitions = run.policyTransitions.map((transition, index, all) => ({
  index: index + 1,
  atMs: transition.atMs,
  atMinutes: transition.atMs / 60_000,
  sincePreviousMs: index ? transition.atMs - all[index - 1].atMs : transition.atMs,
  from: transition.from,
  to: transition.to,
  reason: transition.reason,
  updateHz: transition.updateHz,
  intervalP95Ms: transition.intervalP95Ms,
}));
const reliefAtMs = run.loadRelief?.appliedAtMs ?? null;
const recovery = run.policyTransitions.find(transition => transition.to === 'normal' && reliefAtMs != null && transition.atMs >= reliefAtMs);
const timed = run.resourceTimeline.filter(row => row.label === 'timed');
const preRelief = reliefAtMs == null ? timed : timed.filter(row => row.elapsedMs < reliefAtMs);
const postRelief = reliefAtMs == null ? [] : timed.filter(row => row.elapsedMs >= reliefAtMs);

const analysis = {
  source: file,
  generatedAt: new Date().toISOString(),
  duration: run.duration,
  engine: run.engine,
  backend: run.backend,
  initialViewport: { width: run.width, height: run.height },
  loadRelief: run.loadRelief,
  transitionCounts: {
    total: transitions.length,
    downshifts: transitions.filter(item => item.from === 'normal' && item.to === 'low').length,
    probeStarts: transitions.filter(item => item.to === 'probe').length,
    probeFailures: transitions.filter(item => item.reason === 'normal-load-probe-failed').length,
    fullRecoveries: transitions.filter(item => item.to === 'normal').length,
  },
  transitions,
  intervalsBetweenSwitchesMs: transitions.slice(1).map(item => item.sincePreviousMs),
  recoveryAfterRelief: recovery ? { atMs: recovery.atMs, latencyMs: recovery.atMs - reliefAtMs } : null,
  resourceSamples: { total: timed.length, preRelief: preRelief.length, postRelief: postRelief.length },
  trends: {
    heapUsedBytes: trend(timed, row => row.heap.usedSize),
    domNodes: trend(timed, row => row.dom.nodes),
    eventListeners: trend(timed, row => row.dom.jsEventListeners),
    activeTimeouts: trend(timed, row => row.timers.activeTimeouts),
    activeIntervals: trend(timed, row => row.timers.activeIntervals),
    pendingApplicationRaf: trend(timed, row => row.timers.pendingApplicationRaf),
    gsapLiveScenes: trend(timed, row => row.gsapAudit?.liveScenes),
    gsapLiveTimelines: trend(timed, row => row.gsapAudit?.liveTimelines),
  },
  preReliefTrends: {
    heapUsedBytes: trend(preRelief, row => row.heap.usedSize),
    domNodes: trend(preRelief, row => row.dom.nodes),
    eventListeners: trend(preRelief, row => row.dom.jsEventListeners),
    activeTimeouts: trend(preRelief, row => row.timers.activeTimeouts),
    activeIntervals: trend(preRelief, row => row.timers.activeIntervals),
    pendingApplicationRaf: trend(preRelief, row => row.timers.pendingApplicationRaf),
  },
  postReliefTrends: {
    heapUsedBytes: trend(postRelief, row => row.heap.usedSize),
    domNodes: trend(postRelief, row => row.dom.nodes),
    eventListeners: trend(postRelief, row => row.dom.jsEventListeners),
    activeTimeouts: trend(postRelief, row => row.timers.activeTimeouts),
    activeIntervals: trend(postRelief, row => row.timers.activeIntervals),
    pendingApplicationRaf: trend(postRelief, row => row.timers.pendingApplicationRaf),
  },
  postRunGc: run.postRunGc,
  pageErrors: run.errors,
  networkFailures: run.networkFailures,
  interpretationRules: {
    heap: 'Natural heap samples may rise and fall with GC. A positive raw slope alone is not a leak; inspect monotonicity, DOM/listener/timer counts, and post-run forced-GC state together.',
    timers: 'Cumulative scheduled/fired counters naturally rise. Leak assessment uses active timeout/interval and pending RAF counts.',
    recovery: 'Viewport reduction retains all visual modules; it is a controlled load reduction, not a proposed production quality cut.',
  },
};
writeFileSync('.review/p1-5-b/long-analysis.json', JSON.stringify(analysis, null, 2));
console.log(JSON.stringify({ durationMs: analysis.duration.actualMs, transitions: analysis.transitionCounts, relief: analysis.loadRelief, recovery: analysis.recoveryAfterRelief, resourceSamples: analysis.resourceSamples, trends: analysis.trends }, null, 2));
