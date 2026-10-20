import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { median } from './stats.mjs';
import { simulateLoadModel } from './quality-policy.mjs';

const formal = JSON.parse(readFileSync('docs/nexus-p1-5-a/evidence/formal-results.json', 'utf8'));
const timelines = JSON.parse(readFileSync('docs/nexus-p1-5-a/evidence/time-series.json', 'utf8'));

function load(points) {
  return {
    updateHz: median(points.map(point => point.directorUpdateHz).filter(Number.isFinite)),
    intervalP95Ms: median(points.map(point => point.engineIntervalP95Ms).filter(Number.isFinite)),
  };
}

const results = [];
for (const item of formal) {
  const timeline = timelines.find(candidate => candidate.backend === item.backend && candidate.id === item.id)?.points ?? [];
  const normalPoints = timeline.filter(point => point.level === 'normal');
  const lowPoints = timeline.filter(point => point.level === 'low');
  const normalLoad = load(normalPoints);
  const lowLoad = lowPoints.length ? load(lowPoints) : normalLoad;
  const browserRafReferenceHz = item.calibration.rateHz;
  const engineConfiguredCapHz = item.engine === 'gsap' ? 60 : browserRafReferenceHz;
  const noRelief = simulateLoadModel({ durationMs: 180_000, normalLoad, lowLoad, browserRafReferenceHz, engineConfiguredCapHz });
  const relief = simulateLoadModel({ durationMs: 180_000, reliefAtMs: 60_000, normalLoad, lowLoad, relievedNormalLoad: lowLoad, browserRafReferenceHz, engineConfiguredCapHz });
  results.push({
    backend: item.backend,
    id: item.id,
    engine: item.engine,
    width: item.viewport.width,
    browserRafReferenceHz,
    engineConfiguredCapHz,
    sourceLoads: { normalLoad, lowLoad },
    oldPolicy: { downshifts: item.qualityTransitions.downshifts, recoveries: item.qualityTransitions.recoveries },
    candidateNoRelief: {
      finalMode: noRelief.finalMode,
      fullRecoveries: noRelief.transitions.filter(transition => transition.to === 'normal').length,
      probeStarts: noRelief.transitions.filter(transition => transition.to === 'probe').length,
      probeFailures: noRelief.transitions.filter(transition => transition.reason === 'normal-load-probe-failed').length,
      transitions: noRelief.transitions,
    },
    candidateWithModeledRelief: {
      finalMode: relief.finalMode,
      fullRecoveries: relief.transitions.filter(transition => transition.to === 'normal').length,
      recoveryAtMs: relief.transitions.find(transition => transition.to === 'normal')?.atMs ?? null,
      transitions: relief.transitions,
    },
  });
}
mkdirSync('.review/p1-5-b', { recursive: true });
writeFileSync('.review/p1-5-b/history-replay.json', JSON.stringify({ source: 'P1.5-A committed one-second timelines', generatedAt: new Date().toISOString(), results }, null, 2));
console.log(JSON.stringify(results.map(item => ({ backend: item.backend, id: item.id, old: item.oldPolicy, candidate: { final: item.candidateNoRelief.finalMode, recoveries: item.candidateNoRelief.fullRecoveries, probes: item.candidateNoRelief.probeStarts }, relief: { final: item.candidateWithModeledRelief.finalMode, recoveryAtMs: item.candidateWithModeledRelief.recoveryAtMs } })), null, 2));
