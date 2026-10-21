import { gsap } from "gsap";
import { createGsapHost, settleGsapIdle, tickerAudit } from "@/components/screen/motion/GsapTickerOwner";
import type { MotionHost } from "@/components/screen/motion/MotionDirector";
import { LAUNCH } from "@/lib/voice/params";

export type XiaochuanVisual = {
  pulse: number; stream: number; unfold: number; fold: number; foldFrom: number;
  header: number; metricsContent: number; spoken: number; followups: number;
  opacity: number; caption: number; presence: number;
  formation: number; collapse: number;
  coreX: number; coreY: number; typingMs: number;
};
type Track = { timeline: gsap.core.Timeline; start: number; duration: number };
/** Visual interpolation only: no reducer, hub, audio scheduling or global ticker mutation. */
export class XiaochuanTimeline {
  static liveControllers = 0;
  static liveTimelines = 0;
  readonly visual: XiaochuanVisual = {
    pulse: 0, stream: 0, unfold: 0, fold: 0, foldFrom: 1,
    header: 0, metricsContent: 0, spoken: 0, followups: 0,
    opacity: 0, caption: 0, presence: 1, formation: 0, collapse: 0,
    coreX: 960, coreY: 470, typingMs: 0,
  };
  readonly canvasSample = { at: 0, pulse: 0, stream: 0, unfold: 0, fold: 0 };
  private tracks = new Map<string, Track>();
  private subscribers = new Set<() => void>();
  private job: number | null = null;
  private disposed = false;
  private hidden = false;
  constructor(private host: MotionHost = createGsapHost(), public reduced = false) { XiaochuanTimeline.liveControllers++; }
  private now() { return this.host.clockNow?.() ?? performance.now(); }
  subscribe(fn: () => void) { if (this.disposed) return () => {}; this.subscribers.add(fn); fn(); return () => { this.subscribers.delete(fn); }; }
  private emit() { this.subscribers.forEach(fn => fn()); }
  private cancelJob() { if (this.job !== null) this.host.cancel(this.job); this.job = null; }
  private kill(key: string) {
    const old = this.tracks.get(key);
    if (old) { old.timeline.kill(); this.tracks.delete(key); XiaochuanTimeline.liveTimelines--; }
  }
  private start(key: string, at: number, build: (tl: gsap.core.Timeline) => void) {
    if (this.disposed) return;
    // Sample the interrupted track before replacing it, preserving its current pose.
    this.sample(this.now());
    this.kill(key);
    const timeline = gsap.timeline({ paused: true }); build(timeline);
    const duration = timeline.duration() * 1000;
    this.tracks.set(key, { timeline, start: at, duration }); XiaochuanTimeline.liveTimelines++;
    this.sample(this.now()); this.schedule();
  }
  /** One shared answer clock, existing 120 / 100–450 / 400–650 ms choreography. */
  answer(at: number, typingMs = 0) {
    this.kill("fold"); this.kill("answer");
    Object.assign(this.visual, { pulse: 0, stream: 0, unfold: 0, fold: 0, header: 0, metricsContent: 0, spoken: 0, followups: 0, presence: 1, typingMs: 0 });
    this.start("answer", at, tl => {
      tl.addLabel("pulse", 0).to(this.visual, { pulse: 1, duration: LAUNCH.pulseMs / 1000, ease: "none" }, "pulse")
        .addLabel("stream", .1).to(this.visual, { stream: 1, duration: .35, ease: "none" }, "stream")
        .addLabel("unfold", .4).to(this.visual, { unfold: 1, duration: .25, ease: "none" }, "unfold")
        .addLabel("content", .65)
        .to(this.visual, { header: 1, duration: .16, ease: "power2.out" }, .55)
        .to(this.visual, { metricsContent: 1, duration: .20, ease: "power2.out" }, .60)
        .to(this.visual, { spoken: 1, duration: .18, ease: "power2.out" }, "content")
        .to(this.visual, { followups: 1, duration: .18, ease: "power2.out" }, .72);
      if (typingMs > 0) tl.to(this.visual, { typingMs, duration: typingMs / 1000, ease: "none" }, "content");
    });
  }
  fold(at: number) {
    this.sample(this.now()); this.kill("answer");
    if (this.tracks.has("fold") || this.visual.fold >= 1) return;
    this.visual.foldFrom = this.visual.unfold;
    this.start("fold", at, tl => { tl.to(this.visual, { fold: 1, duration: .2, ease: "none" }); });
  }
  takeover(at: number) {
    this.kill("exit"); this.visual.collapse = 0; this.visual.formation = 0;
    this.start("wake", at, tl => {
      tl.to(this.visual, { opacity: 1, duration: .5, ease: "power2.out" }, 0)
        .to(this.visual, { formation: 1, duration: .9, ease: "power2.out" }, 0);
    });
  }
  close(at: number) {
    this.kill("wake"); this.fold(at);
    this.start("collapse", at, tl => { tl.to(this.visual, { collapse: 1, duration: .6, ease: "power2.in" }, 0)
      .to(this.visual, { opacity: 0, duration: .9, ease: "power2.out" }, .4); });
  }
  exit(at: number) {
    this.sample(this.now()); this.kill("collapse");
    this.start("exit", at, tl => { tl.to(this.visual, { opacity: 0, duration: .5, ease: "power2.out" }); });
  }
  caption(at: number) {
    this.kill("caption"); this.visual.caption = 0;
    this.start("caption", at, tl => { tl.to(this.visual, { caption: 1, duration: .24, ease: "power2.out" }); });
  }
  presence(paused: boolean, at: number) {
    this.start("presence", at, tl => { tl.to(this.visual, { presence: paused ? .45 : 1, duration: .14, ease: "power2.out" }); });
  }
  geometry(x: number, y: number, at: number) {
    this.start("geometry", at, tl => { tl.to(this.visual, { coreX: x, coreY: y, duration: .6, ease: "power2.inOut" }); });
  }
  setReduced(value: boolean) { if (this.disposed) return; this.reduced = value; this.sample(this.now()); this.schedule(); }
  visibility(hidden: boolean) {
    if (this.disposed) return;
    this.hidden = hidden;
    if (hidden) this.cancelJob();
    else { this.sample(this.now()); this.schedule(); }
  }
  private sample(now: number) {
    for (const [key, track] of this.tracks) {
      const elapsed = this.reduced ? track.duration : Math.max(0, now - track.start);
      track.timeline.totalTime(Math.min(elapsed, track.duration) / 1000, true);
      if (elapsed >= track.duration) this.kill(key);
    }
    this.emit();
  }
  private schedule() {
    if (this.disposed || this.hidden || this.job !== null || !this.tracks.size) { settleGsapIdle(); return; }
    this.job = this.host.request(now => { this.job = null; this.sample(now); this.schedule(); });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.cancelJob();
    for (const key of this.tracks.keys()) this.kill(key);
    this.subscribers.clear(); XiaochuanTimeline.liveControllers--; settleGsapIdle();
  }
  audit() {
    return { liveControllers: XiaochuanTimeline.liveControllers, liveTimelines: XiaochuanTimeline.liveTimelines,
      tracks: [...this.tracks.keys()], subscribers: this.subscribers.size, pendingJob: this.job !== null,
      rootAnimations: gsap.globalTimeline.getChildren(false).filter(t => !t.paused()).length, hidden: this.hidden, canvasSample: { ...this.canvasSample }, visual: Object.fromEntries(Object.entries(this.visual).filter(([, value]) => typeof value === "number")), ...tickerAudit() };
  }
}
