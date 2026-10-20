export const DEFAULT_CANDIDATE = Object.freeze({
  completionRatio: 0.75,
  absoluteFloorHz: 45,
  severeCompletionRatio: 0.55,
  severeFloorHz: 30,
  abnormalP95Multiplier: 1.8,
  lowDurationMs: 4_000,
  severeDurationMs: 2_000,
  probePassRatio: 0.9,
  probeAbsoluteFloorHz: 52,
  probeP95Multiplier: 1.5,
  probePassWindows: 3,
  baseProbeDelayMs: 10_000,
  maxProbeDelayMs: 60_000,
});

export function effectiveTargetHz(browserRafReferenceHz, engineConfiguredCapHz) {
  const values = [browserRafReferenceHz, engineConfiguredCapHz].filter(value => Number.isFinite(value) && value > 0);
  return values.length ? Math.min(...values) : null;
}

export function probeDelayMs(failureCount, config = DEFAULT_CANDIDATE) {
  return Math.min(config.maxProbeDelayMs, config.baseProbeDelayMs * (2 ** Math.max(0, failureCount)));
}

export class ProbeBackoffPolicy {
  constructor({ browserRafReferenceHz, engineConfiguredCapHz, config = DEFAULT_CANDIDATE }) {
    this.config = { ...DEFAULT_CANDIDATE, ...config };
    this.targetHz = effectiveTargetHz(browserRafReferenceHz, engineConfiguredCapHz);
    if (!this.targetHz) throw new Error('A positive browser RAF reference or engine cap is required');
    this.mode = 'normal';
    this.lowEvidenceMs = 0;
    this.severeEvidenceMs = 0;
    this.probePasses = 0;
    this.probeFailures = 0;
    this.nextProbeAtMs = null;
    this.transitions = [];
    this.lastAtMs = null;
  }

  transition(to, atMs, reason, sample = {}) {
    if (to === this.mode) return null;
    const entry = { atMs, from: this.mode, to, reason, ...sample };
    this.mode = to;
    this.lowEvidenceMs = 0;
    this.severeEvidenceMs = 0;
    this.probePasses = 0;
    if (to === 'low') this.nextProbeAtMs = atMs + probeDelayMs(this.probeFailures, this.config);
    if (to === 'normal') { this.probeFailures = 0; this.nextProbeAtMs = null; }
    this.transitions.push(entry);
    return entry;
  }

  sample({ atMs, updateHz, intervalP95Ms, paused = false }) {
    const deltaMs = this.lastAtMs == null ? 0 : Math.max(0, atMs - this.lastAtMs);
    this.lastAtMs = atMs;
    const targetIntervalMs = 1000 / this.targetHz;
    const completion = Number.isFinite(updateHz) ? updateHz / this.targetHz : null;
    const base = { atMs, mode: this.mode, targetHz: this.targetHz, completionRatio: completion, updateHz, intervalP95Ms, paused };
    if (paused || !Number.isFinite(updateHz) || !Number.isFinite(intervalP95Ms)) return { ...base, action: 'hold', reason: paused ? 'paused' : 'insufficient-sample' };

    if (this.mode === 'normal') {
      const low = completion < this.config.completionRatio && updateHz < this.config.absoluteFloorHz && intervalP95Ms > targetIntervalMs * this.config.abnormalP95Multiplier;
      const severe = completion < this.config.severeCompletionRatio && updateHz < this.config.severeFloorHz;
      this.lowEvidenceMs = low ? this.lowEvidenceMs + deltaMs : 0;
      this.severeEvidenceMs = severe ? this.severeEvidenceMs + deltaMs : 0;
      if (this.severeEvidenceMs >= this.config.severeDurationMs) {
        const transition = this.transition('low', atMs, 'severe-low-frequency', base);
        return { ...base, action: 'enter-low', transition };
      }
      if (this.lowEvidenceMs >= this.config.lowDurationMs) {
        const transition = this.transition('low', atMs, 'sustained-low-frequency-and-tail', base);
        return { ...base, action: 'enter-low', transition };
      }
      return { ...base, action: 'hold', lowEvidenceMs: this.lowEvidenceMs, severeEvidenceMs: this.severeEvidenceMs };
    }

    if (this.mode === 'low') {
      if (this.nextProbeAtMs != null && atMs >= this.nextProbeAtMs) {
        const transition = this.transition('probe', atMs, 'scheduled-normal-load-probe', base);
        return { ...base, action: 'start-probe', transition };
      }
      return { ...base, action: 'hold', nextProbeAtMs: this.nextProbeAtMs };
    }

    const passFloor = Math.max(this.config.probeAbsoluteFloorHz, this.targetHz * this.config.probePassRatio);
    const pass = updateHz >= passFloor && intervalP95Ms <= targetIntervalMs * this.config.probeP95Multiplier;
    if (!pass) {
      this.probeFailures++;
      const transition = this.transition('low', atMs, 'normal-load-probe-failed', { ...base, requiredHz: passFloor });
      return { ...base, action: 'probe-failed', transition, probeFailures: this.probeFailures, nextProbeAtMs: this.nextProbeAtMs };
    }
    this.probePasses++;
    if (this.probePasses >= this.config.probePassWindows) {
      const transition = this.transition('normal', atMs, 'normal-load-probe-passed', { ...base, requiredHz: passFloor });
      return { ...base, action: 'recover-normal', transition };
    }
    return { ...base, action: 'probe-pass-window', probePasses: this.probePasses, requiredHz: passFloor };
  }
}

export function simulateLoadModel({ durationMs, sampleMs = 1_000, normalLoad, lowLoad, reliefAtMs = Infinity, relievedNormalLoad = normalLoad, browserRafReferenceHz, engineConfiguredCapHz, config }) {
  const policy = new ProbeBackoffPolicy({ browserRafReferenceHz, engineConfiguredCapHz, config });
  const timeline = [];
  for (let atMs = 0; atMs <= durationMs; atMs += sampleMs) {
    const normal = atMs >= reliefAtMs ? relievedNormalLoad : normalLoad;
    const load = policy.mode === 'low' ? lowLoad : normal;
    const result = policy.sample({ atMs, updateHz: load.updateHz, intervalP95Ms: load.intervalP95Ms });
    timeline.push({ ...result, observedLoad: policy.mode === 'low' ? 'low' : 'normal' });
  }
  return { targetHz: policy.targetHz, transitions: policy.transitions, timeline, finalMode: policy.mode, probeFailures: policy.probeFailures };
}
