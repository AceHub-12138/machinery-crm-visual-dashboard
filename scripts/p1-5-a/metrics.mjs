export const nearestRank = (values, percentile) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
};

export const mean = values => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : null;

export function summarizeIntervals(intervals, measuredMs) {
  const elapsed = intervals.reduce((sum, value) => sum + value, 0);
  return {
    intervalCount: intervals.length,
    measuredMs,
    rateHz: elapsed > 0 ? intervals.length * 1000 / elapsed : null,
    intervalMeanMs: mean(intervals),
    intervalP50Ms: nearestRank(intervals, 0.5),
    intervalP95Ms: nearestRank(intervals, 0.95),
    intervalP99Ms: nearestRank(intervals, 0.99),
    intervalMaxMs: intervals.length ? Math.max(...intervals) : null,
  };
}

export function summarizeDurations(durations) {
  return {
    count: durations.length,
    totalMs: durations.reduce((sum, value) => sum + value, 0),
    meanMs: mean(durations),
    p95Ms: nearestRank(durations, 0.95),
    p99Ms: nearestRank(durations, 0.99),
    maxMs: durations.length ? Math.max(...durations) : null,
  };
}

export function summarizeLongTasks(entries) {
  return {
    count: entries.length,
    totalDurationMs: entries.reduce((sum, entry) => sum + entry.duration, 0),
    totalBlockingTimeMs: entries.reduce((sum, entry) => sum + Math.max(0, entry.duration - 50), 0),
    p95Ms: nearestRank(entries.map(entry => entry.duration), 0.95),
    p99Ms: nearestRank(entries.map(entry => entry.duration), 0.99),
    maxMs: entries.length ? Math.max(...entries.map(entry => entry.duration)) : null,
  };
}

export function estimateMissedOpportunities(intervals, referenceIntervalMs) {
  if (!Number.isFinite(referenceIntervalMs) || referenceIntervalMs <= 0) {
    return { available: false, reason: 'No reliable browser scheduling reference interval' };
  }
  let missed = 0;
  for (const interval of intervals) missed += Math.max(0, Math.round(interval / referenceIntervalMs) - 1);
  const observed = intervals.length;
  return {
    available: true,
    referenceIntervalMs,
    observedCallbacks: observed,
    estimatedMissedCallbackOpportunities: missed,
    estimatedMissedOpportunityPercent: observed + missed > 0 ? missed * 100 / (observed + missed) : null,
    caveat: 'Callback scheduling proxy only; this is not compositor presentation telemetry or actual displayed-frame loss.',
  };
}

export function classifyRenderer(gpuInfo, webglInfo = {}) {
  const devices = gpuInfo?.gpu?.devices ?? gpuInfo?.devices ?? [];
  const rendererEvidence = [
    ...devices.flatMap(device => [device.deviceString, device.vendorString, device.driverVendor]),
    gpuInfo?.device,
    gpuInfo?.auxAttributes?.glRenderer,
    gpuInfo?.auxAttributes?.glImplementationParts,
    ...(Array.isArray(webglInfo) ? webglInfo : [webglInfo]).flatMap(info => [info?.unmaskedRenderer, info?.renderer, info?.unmaskedVendor]),
  ].filter(Boolean).join(' ').toLowerCase();
  // Actual renderer/device evidence takes precedence over a command-line flag
  // that merely enables SwiftShader as an allowed fallback.
  if (rendererEvidence.includes('metal renderer') || rendererEvidence.includes('angle metal')) {
    return { acceleration: 'hardware', backend: 'ANGLE Metal', confidence: 'high' };
  }
  if (rendererEvidence.includes('swiftshader') || rendererEvidence.includes('swangle')) {
    return { acceleration: 'software', backend: 'SwiftShader', confidence: 'high' };
  }
  return { acceleration: 'unknown', backend: 'unknown', confidence: 'unknown' };
}

export function transitionSummary(series) {
  const transitions = [];
  for (let index = 1; index < series.length; index++) {
    if (series[index].level !== series[index - 1].level) {
      transitions.push({
        elapsedMs: series[index].elapsedMs,
        from: series[index - 1].level,
        to: series[index].level,
        directorUpdateHz: series[index].directorUpdateHz,
        engineCallbackHz: series[index].engineCallbackHz,
        browserRafProxyHz: series[index].browserRafProxyHz,
        engineIntervalP95Ms: series[index].engineIntervalP95Ms,
      });
    }
  }
  return {
    transitions,
    downshifts: transitions.filter(item => item.from === 'normal' && item.to === 'low').length,
    recoveries: transitions.filter(item => item.from === 'low' && item.to === 'normal').length,
    consecutiveDownshifts: transitions.filter(item => item.to === 'low').length,
    consecutiveRecoveries: transitions.filter(item => item.to === 'normal').length,
  };
}
