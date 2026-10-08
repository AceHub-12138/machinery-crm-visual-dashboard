/** A deadline which retains its remaining budget across intentional pauses. */
export class PausableDeadline {
  private handle: unknown = null;
  private since = 0;
  private remaining: number;
  private ended = false;
  private readonly fire: () => void;
  private readonly set: (fn: () => void, ms: number) => unknown;
  private readonly clear: (handle: unknown) => void;
  private readonly now: () => number;
  constructor(ms: number, fire: () => void,
    set: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
    clear: (handle: unknown) => void = handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: () => number = Date.now) { this.fire = fire; this.set = set; this.clear = clear; this.now = now; this.remaining = ms; this.resume(); }
  pause(): void {
    if (this.ended || this.handle === null) return;
    this.remaining = Math.max(0, this.remaining - (this.now() - this.since));
    this.clear(this.handle); this.handle = null;
  }
  resume(): void {
    if (this.ended || this.handle !== null) return;
    this.since = this.now();
    this.handle = this.set(() => { this.handle = null; this.ended = true; this.fire(); }, this.remaining);
  }
  cancel(): void { this.pause(); this.ended = true; }
}
