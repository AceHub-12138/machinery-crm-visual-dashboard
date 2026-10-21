/** Runtime-only scheduling. Startup calibration and quality thresholds are unchanged. */
export const recalibrationBudget = Object.freeze({ reserveMs: 30_000, deadlineMs: 45_000 });
export interface RecalibrationContext { active: boolean; phase: string; probe: boolean; pauseReason: string }
export interface RecalibrationHost {
  now: () => number;
  context: () => RecalibrationContext;
  measure: (done: (referenceHz: number) => void) => () => void;
  suspend: () => void;
  resume: () => void;
  apply: (referenceHz: number) => void;
  fallback: (reason: string) => void;
}
export interface RecalibrationRecord { at: number; event: string; version: number; firstRequestedAt: number; activeMs: number }
export class DeferredRecalibration {
  private version = 0;
  private pending: { version: number; firstRequestedAt: number; activeMs: number } | null = null;
  private measured: { version: number; token: number; cancel: (() => void) | null } | null = null;
  private token = 0;
  private last: number | null = null;
  private wasActive = false;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private queued = false;
  private disposed = false;
  private pauseReason = '';
  readonly records: RecalibrationRecord[] = [];
  constructor(private host: RecalibrationHost) {}
  get reserved() { return !!this.pending && this.pending.activeMs >= recalibrationBudget.reserveMs; }
  get measuring() { return this.measured !== null; }
  get waiting() { return this.pending !== null; }
  get snapshot() { return { state: this.measuring ? 'measuring' : this.pending ? this.wasActive ? 'waiting' : 'paused' : 'idle', ...this.pending, reserved: this.reserved }; }
  private record(event: string) {
    const p = this.pending;
    this.records.push({ at: this.host.now(), event, version: p?.version ?? this.version, firstRequestedAt: p?.firstRequestedAt ?? 0, activeMs: p?.activeMs ?? 0 });
    if (this.records.length > 144) this.records.shift();
  }
  request() {
    if (this.disposed) return;
    if (this.pending && !this.account()) return;
    const now = this.host.now();
    if (!Number.isFinite(now)) { this.fail('unverifiable-clock'); return; }
    if (this.pending) this.pending.version = ++this.version;
    else { this.pending = { version: ++this.version, firstRequestedAt: now, activeMs: 0 }; this.last = now; this.wasActive = this.host.context().active; }
    this.record('requested'); this.advance();
  }
  /** Call on existing Director ticks and environment events. Never consumes synchronously. */
  advance() {
    if (this.disposed || !this.pending || !this.account()) return;
    const context = this.host.context();
    if (!['BOOT', 'INTRO', 'PULSE', 'AMBIENT', 'DEGRADED'].includes(context.phase)) { this.fail('unverifiable-scene'); return; }
    if (!context.active) {
      this.clearDeadline();
      if (this.measured) { this.cancelMeasure(); this.host.resume(); }
      if (this.pauseReason !== context.pauseReason) { this.pauseReason = context.pauseReason; this.record(`paused-${context.pauseReason}`); }
      return;
    }
    this.pauseReason = '';
    if (this.deadline === null) {
      // One finite deadline, paused with the environment; requests never extend it.
      this.deadline = setTimeout(() => { this.deadline = null; if (this.pending && this.account()) this.advance(); }, Math.max(0, recalibrationBudget.deadlineMs - this.pending.activeMs));
    }
    if (!this.queued) {
      this.queued = true;
      queueMicrotask(() => { this.queued = false; this.consume(); });
    }
  }
  private account() {
    if (!this.pending) return false;
    const now = this.host.now();
    if (!Number.isFinite(now) || this.last !== null && now < this.last) { this.fail('unverifiable-clock'); return false; }
    if (this.last !== null && this.wasActive) this.pending.activeMs += now - this.last;
    this.last = now; this.wasActive = this.host.context().active;
    if (this.pending.activeMs >= recalibrationBudget.deadlineMs) { this.fail('active-deadline-exceeded'); return false; }
    return true;
  }
  private consume() {
    if (this.disposed || !this.pending || !this.account()) return;
    const context = this.host.context();
    if (!context.active || this.measured || context.probe || !['AMBIENT', 'DEGRADED'].includes(context.phase)) return;
    const attempt = { version: this.pending.version, token: ++this.token, cancel: null as (() => void) | null };
    this.measured = attempt; this.record('started');
    try {
      this.host.suspend();
      if (this.measured !== attempt) return;
      attempt.cancel = this.host.measure(hz => this.complete(attempt.token, attempt.version, hz));
      // Also handles synchronous completion or an environment takeover during setup.
      if (this.measured !== attempt) attempt.cancel();
    } catch { this.fail('measurement-exception'); }
  }
  private complete(token: number, version: number, hz: number) {
    if (this.disposed || this.measured?.token !== token || !this.pending || !this.account()) return;
    const context = this.host.context();
    if (!context.active) { this.advance(); return; }
    if (context.probe || !['AMBIENT', 'DEGRADED'].includes(context.phase)) { this.fail('unverifiable-completion-state'); return; }
    this.cancelMeasure();
    if (version !== this.pending.version) {
      this.record('discarded-stale-version'); this.host.resume(); this.advance(); return;
    }
    if (!Number.isFinite(hz) || hz <= 0) { this.fail('invalid-or-timed-out-measurement'); return; }
    const completed = this.pending;
    try { this.host.apply(hz); } catch { this.fail('apply-exception'); return; }
    // Director may reject a reference below its supported floor or a broken policy.
    if (this.pending !== completed) return;
    this.record('applied'); this.pending = null; this.clearDeadline(); this.last = null; this.wasActive = false;
    this.host.resume();
  }
  private clearDeadline() { if (this.deadline !== null) clearTimeout(this.deadline); this.deadline = null; }
  private cancelMeasure() { const attempt = this.measured; this.measured = null; this.token++; attempt?.cancel?.(); }
  cancel(reason: string) {
    if (this.pending) this.record(reason);
    this.pending = null; this.last = null; this.wasActive = false; this.pauseReason = '';
    this.clearDeadline(); this.cancelMeasure(); this.host.resume();
  }
  private fail(reason: string) { this.cancel(`fallback-${reason}`); this.host.fallback(`recalibration-${reason}`); }
  dispose() { this.disposed = true; this.cancel('disposed'); }
}
