import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dispersion } from './stats.mjs';

const root = '.review/p1-5-b';
const backends = ['headless-swiftshader', 'headed-metal', 'headed-swiftshader'];
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const roundStats = stats => Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number.isFinite(value) ? Number(value.toFixed(4)) : value]));

function segmentMetrics(result, phase) {
  const points = result.series.filter(point => point.phase === phase);
  const director = points.map(point => point.directorUpdateHz).filter(Number.isFinite);
  const callback = points.map(point => point.engineCallbackHz).filter(Number.isFinite);
  const p95 = points.map(point => point.engineIntervalP95Ms).filter(Number.isFinite);
  const callbackTotalMs = points.reduce((sum, point) => sum + (point.callbackTotalMs ?? 0), 0);
  const estimatedUpdates = director.reduce((sum, value) => sum + value, 0);
  return {
    directorHz: director.length ? director.reduce((sum, value) => sum + value, 0) / director.length : null,
    engineCallbackHz: callback.length ? callback.reduce((sum, value) => sum + value, 0) / callback.length : null,
    intervalP95Ms: p95.length ? p95.reduce((sum, value) => sum + value, 0) / p95.length : null,
    callbackCostPerEstimatedUpdateMs: estimatedUpdates > 0 ? callbackTotalMs / estimatedUpdates : null,
    samples: points.length,
  };
}

const frequencyRuns = [], strategyRuns = [], inputs = [];
for (const backend of backends) {
  for (const profile of ['shared60', 'native']) {
    const file = `${root}/${backend}/frequency-${profile}/report.json`;
    const report = read(file); inputs.push(file);
    if (!report.finishedAt || report.results.length !== 12) throw new Error(`Incomplete frequency report: ${file}`);
    for (const result of report.results) {
      if (result.series.some(point => point.qualityAutomation !== 'external-experiment')) throw new Error(`Unisolated frequency point: ${file}:${result.id}`);
      frequencyRuns.push({
        backend, renderer: report.rendererClassification.backend, profile, engine: result.engine, width: result.width, repetition: result.repetition,
        calibrationHz: result.calibration.rateHz,
        browserRafProxyHz: result.metrics.browserRafProxy.rateHz,
        engineCallbackHz: result.metrics.engineCallbacks.rateHz,
        directorHz: result.metrics.motionDirector.meanHz,
        callbackCostPerEstimatedUpdateMs: result.metrics.callbackCostPerEstimatedDirectorUpdateMs,
        intervalP95Ms: result.metrics.engineCallbacks.intervalP95Ms,
        intervalP99Ms: result.metrics.engineCallbacks.intervalP99Ms,
        taskSeconds: result.mainThreadCdpDelta.TaskDuration,
        scriptSeconds: result.mainThreadCdpDelta.ScriptDuration,
        layoutSeconds: result.mainThreadCdpDelta.LayoutDuration,
        recalcStyleSeconds: result.mainThreadCdpDelta.RecalcStyleDuration,
        ambient: segmentMetrics(result, 'ambient'),
        pulse: segmentMetrics(result, 'pulse-window'),
        longTasks: result.metrics.longTasks.count,
        pageErrors: result.errors.length,
      });
    }
  }
  const file = `${root}/${backend}/strategy-candidate60/report.json`;
  const report = read(file); inputs.push(file);
  if (!report.finishedAt || report.results.length !== 12) throw new Error(`Incomplete strategy report: ${file}`);
  for (const result of report.results) {
    if (result.series.some(point => point.qualityAutomation !== 'external-experiment')) throw new Error(`Unisolated strategy point: ${file}:${result.id}`);
    strategyRuns.push({
      backend, renderer: report.rendererClassification.backend, engine: result.engine, width: result.width, repetition: result.repetition,
      directorHz: result.metrics.motionDirector.meanHz,
      downshifts: result.policyTransitions.filter(item => item.from === 'normal' && item.to === 'low').length,
      probeStarts: result.policyTransitions.filter(item => item.to === 'probe').length,
      probeFailures: result.policyTransitions.filter(item => item.reason === 'normal-load-probe-failed').length,
      fullRecoveries: result.policyTransitions.filter(item => item.to === 'normal').length,
      rejectedPulsesLow: result.pulseRequests.filter(item => item.rejectedBecauseLow).length,
      transitionTimeline: result.policyTransitions,
      finalPolicyMode: result.series.at(-1)?.policy?.mode ?? result.policyTransitions.at(-1)?.to ?? 'normal',
      longTasks: result.metrics.longTasks.count,
      pageErrors: result.errors.length,
    });
  }
}

function group(rows, keys, metrics) {
  const groups = new Map();
  for (const row of rows) {
    const id = keys.map(key => row[key]).join('|');
    const group = groups.get(id) ?? { ...Object.fromEntries(keys.map(key => [key, row[key]])), repetitions: 0, metrics: {} };
    group.repetitions++;
    for (const metric of metrics) {
      const values = group.metrics[metric] ?? [];
      values.push(row[metric]); group.metrics[metric] = values;
    }
    groups.set(id, group);
  }
  return [...groups.values()].map(group => ({ ...group, metrics: Object.fromEntries(Object.entries(group.metrics).map(([metric, values]) => [metric, roundStats(dispersion(values))])) }));
}

const frequencySummary = group(frequencyRuns, ['backend', 'renderer', 'profile', 'engine', 'width'], [
  'calibrationHz', 'browserRafProxyHz', 'engineCallbackHz', 'directorHz', 'callbackCostPerEstimatedUpdateMs', 'intervalP95Ms', 'intervalP99Ms',
  'taskSeconds', 'scriptSeconds', 'layoutSeconds', 'recalcStyleSeconds', 'longTasks', 'pageErrors',
]);
const strategySummary = group(strategyRuns, ['backend', 'renderer', 'engine', 'width'], [
  'directorHz', 'downshifts', 'probeStarts', 'probeFailures', 'fullRecoveries', 'rejectedPulsesLow', 'longTasks', 'pageErrors',
]);

const output = {
  generatedAt: new Date().toISOString(),
  inputReports: inputs,
  excludedFailedOrDryRuns: [
    'frequency shared60 captures made before cumulative-deadline scheduler repair',
    'strategy captures made before qualityExperiment=external isolation',
    'short frequency-candidate60 and strategy-shared60 tool-validation directories',
  ],
  frequencyRuns, frequencySummary, strategyRuns, strategySummary,
  historyReplay: read(`${root}/history-replay.json`),
};
mkdirSync(root, { recursive: true });
writeFileSync(`${root}/aggregate.json`, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ frequencyRuns: frequencyRuns.length, frequencyGroups: frequencySummary.length, strategyRuns: strategyRuns.length, strategyGroups: strategySummary.length, allIsolated: true }, null, 2));
