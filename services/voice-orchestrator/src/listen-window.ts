/** One bounded listen lease. Duplicate reports never extend a timer; only a
 * VAD candidate start (misfires restore the remainder) pauses the remaining time, with a 16s speech watchdog. */
export type ListenAction = "ready" | "speech_start" | "misfire" | "duck" | "pause";
export type InputLease = { sessionId: string; listenId: string; screenId?: string; turnId?: string; attemptId?: string; sentenceIndex?: number };
type ListenOptions = {
  progress?: (remainingMs: number, paused: boolean, opened: boolean) => void;
  timeoutMs: number; expire: (missingReport: boolean) => void;
  setTimer: (fn: () => void, ms: number) => unknown; clearTimer: (handle: unknown) => void;
};
export class ListenWindow {
  readonly lease: InputLease;
  readonly mode: "listening" | "followup";
  private readonly options: ListenOptions;
  private timer: unknown = null;
  private remaining: number;
  private since = 0;
  private opened = false;
  private speaking = false;
  private ended = false;
  constructor(lease: InputLease, mode: "listening" | "followup", options: ListenOptions) {
    this.lease = lease; this.mode = mode; this.options = options;
    this.remaining = options.timeoutMs;
    this.arm(options.timeoutMs + 1000, true);
  }
  private arm(ms: number, missingReport = false): void {
    if (this.timer !== null) this.options.clearTimer(this.timer);
    this.since = Date.now();
    this.timer = this.options.setTimer(() => { this.stop(); this.options.expire(missingReport); }, Math.max(0, ms));
  }
  report(action: ListenAction): void {
    if (this.ended) return;
    if (action === "ready") {
      if (this.opened) return;
      this.opened = true; this.arm(this.speaking ? 16000 : this.remaining, this.speaking);
      this.options.progress?.(this.remaining, this.speaking, true);
    } else if (action === "speech_start") {
      if (this.speaking) return;
      if (this.opened) this.remaining = Math.max(0, this.remaining - (Date.now() - this.since));
      this.speaking = true; this.arm(16000, true);
      this.options.progress?.(this.remaining, true, this.opened);
    } else if (action === "misfire" && this.speaking) {
      this.speaking = false; this.arm(this.opened ? this.remaining : this.remaining + 1000, !this.opened);
      this.options.progress?.(this.remaining, false, this.opened);
    }
  }
  stop(): void { this.ended = true; if (this.timer !== null) this.options.clearTimer(this.timer); this.timer = null; }
}
