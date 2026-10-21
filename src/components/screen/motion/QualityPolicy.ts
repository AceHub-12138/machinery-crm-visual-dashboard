/** Pure policy: no DOM, rendering, clocks, timers or telemetry. P1.5-B thresholds. */
export type QualityState = 'normal' | 'low' | 'probe';
export type QualityMode = 'baseline' | 'shadow' | 'candidate';
export interface QualityEnvironment {
  pageVisible: boolean; voiceActive: boolean; reduced: boolean;
  phase: 'BOOT' | 'INTRO' | 'AMBIENT' | 'PULSE' | 'DEGRADED';
  calibration: number;
}
export interface QualitySample {
  atMs: number; targetHz: number; updateHz: number; intervalP95Ms: number;
  window: { startMs: number; endMs: number; updates: number };
  environment: QualityEnvironment;
  /** Shadow supplies the actual workload so low-quality evidence cannot pass a probe. */
  normalLoad: boolean;
  /** Scheduling availability only. Does not alter degradation/recovery thresholds. */
  probeAllowed?: boolean;
}
export interface QualityDecision {
  state: QualityState; previous: QualityState; reason: string;
  evidence: QualitySample | null; failureCount: number; nextProbeAtMs: number | null;
  lowEvidenceMs: number; severeEvidenceMs: number; probePasses: number;
}
export interface QualityPolicy {
  sample(sample: QualitySample): QualityDecision;
  interrupt(atMs: number, reason: string): QualityDecision;
}
export const candidateParameters = Object.freeze({
  completionRatio: .75, absoluteFloorHz: 45, severeCompletionRatio: .55, severeFloorHz: 30,
  abnormalP95Multiplier: 1.8, lowDurationMs: 4000, severeDurationMs: 2000,
  probePassRatio: .9, probeAbsoluteFloorHz: 52, probeP95Multiplier: 1.5, probePassWindows: 3,
  baseProbeDelayMs: 10_000, maxProbeDelayMs: 60_000,
  // New scheduling guard, not a frequency threshold: reserve a stable window after 30s deferral.
  maxProbeDeferralMs: 30_000,
});
export const probeDelayMs = (failures: number) => Math.min(60_000, 10_000 * 2 ** Math.min(3, Math.max(0, failures)));
export const effectiveTargetHz = (referenceHz: number, capHz: number | null) =>
  capHz === null ? referenceHz : Math.min(referenceHz, capHz);
export class ProbeQualityPolicy implements QualityPolicy {
  private state: QualityState = 'normal';
  private failures = 0;
  private nextProbe: number | null = null;
  private lowMs = 0; private severeMs = 0; private passes = 0;
  private lastEnd: number | null = null; private target: number | null = null; private calibration: number | null = null;
  private clearEvidence() { this.lowMs = this.severeMs = this.passes = 0; this.lastEnd = null; }
  private decision(previous: QualityState, reason: string, evidence: QualitySample | null): QualityDecision {
    return { state: this.state, previous, reason, evidence, failureCount: this.failures,
      nextProbeAtMs: this.nextProbe, lowEvidenceMs: this.lowMs, severeEvidenceMs: this.severeMs, probePasses: this.passes };
  }
  interrupt(atMs: number, reason: string): QualityDecision {
    const previous = this.state;
    if (this.state === 'probe') this.state = 'low';
    this.clearEvidence();
    if (this.state === 'low') {
      const deadline = atMs + probeDelayMs(this.failures);
      // Pauses invalidate samples, not an already scheduled opportunity. Repeated short
      // takeovers must not push the deadline forward forever. Bound clock regressions too.
      this.nextProbe = this.nextProbe === null ? deadline : Math.min(this.nextProbe, deadline);
    }
    return this.decision(previous, reason, null);
  }
  sample(s: QualitySample): QualityDecision {
    const previous = this.state, c = candidateParameters, w = s.window, e = s.environment;
    if (!e.pageVisible || e.voiceActive || e.reduced) return this.interrupt(s.atMs, 'environment-paused');
    if (![s.atMs, s.targetHz, s.updateHz, s.intervalP95Ms, w.startMs, w.endMs, w.updates].every(Number.isFinite)
      || s.targetHz <= 0 || s.updateHz < 0 || s.intervalP95Ms <= 0 || w.updates < 1
      || w.endMs - w.startMs < 1000 || w.endMs !== s.atMs || w.startMs >= w.endMs) {
      return this.interrupt(Number.isFinite(s.atMs) ? s.atMs : 0, 'invalid-or-incomplete-window');
    }
    if (this.target !== s.targetHz || this.calibration !== e.calibration) {
      const initialized = this.target !== null;
      this.target = s.targetHz; this.calibration = e.calibration;
      if (initialized) return this.interrupt(s.atMs, 'reference-recalibrated');
    }
    if (this.lastEnd !== null && w.startMs !== this.lastEnd) return this.interrupt(s.atMs, 'discontinuous-window');
    this.lastEnd = w.endMs;
    const duration = w.endMs - w.startMs, ratio = s.updateHz / s.targetHz, interval = 1000 / s.targetHz;
    if (this.state === 'normal') {
      this.lowMs = ratio < c.completionRatio && s.updateHz < c.absoluteFloorHz && s.intervalP95Ms > interval * c.abnormalP95Multiplier ? this.lowMs + duration : 0;
      this.severeMs = ratio < c.severeCompletionRatio && s.updateHz < c.severeFloorHz ? this.severeMs + duration : 0;
      if (this.severeMs >= c.severeDurationMs || this.lowMs >= c.lowDurationMs) {
        const reason = this.severeMs >= c.severeDurationMs ? 'severe-low-frequency' : 'sustained-low-frequency-and-tail';
        this.state = 'low'; this.nextProbe = s.atMs + probeDelayMs(this.failures);
        const decision = this.decision(previous, reason, s); this.clearEvidence(); return decision;
      }
    } else if (this.state === 'low' && this.nextProbe !== null && s.atMs >= this.nextProbe) {
      if (s.probeAllowed === false) return this.decision(previous, 'probe-deferred-for-recalibration', s);
      if (e.phase !== 'AMBIENT' && e.phase !== 'DEGRADED') return this.decision(previous, 'probe-deferred-until-ambient', s);
      this.state = 'probe'; this.clearEvidence();
      return this.decision(previous, 'scheduled-normal-load-probe', s);
    } else if (this.state === 'probe') {
      const pass = s.updateHz >= Math.max(c.probeAbsoluteFloorHz, s.targetHz * c.probePassRatio) && s.intervalP95Ms <= interval * c.probeP95Multiplier;
      if (!pass) {
        this.failures++; this.state = 'low'; this.nextProbe = s.atMs + probeDelayMs(this.failures);
        this.clearEvidence(); return this.decision(previous, 'normal-load-probe-failed', s);
      }
      if (!s.normalLoad) { this.passes = 0; return this.decision(previous, 'awaiting-full-normal-load', s); }
      if (++this.passes >= c.probePassWindows) {
        this.state = 'normal'; this.failures = 0; this.nextProbe = null;
        const decision = this.decision(previous, 'normal-load-probe-passed', s); this.clearEvidence(); return decision;
      }
    }
    return this.decision(previous, 'hold', s);
  }
}
