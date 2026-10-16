import { motionConfig } from './config';
export type SceneState = 'BOOT' | 'INTRO' | 'AMBIENT' | 'PULSE' | 'DEGRADED';
export type MotionLevel = 'normal' | 'low' | 'static';
export interface MotionFrame {
  time: number; state: SceneState; pageVisible: boolean; voiceActive: boolean;
  motionLevel: MotionLevel; pulse: number; fps: number; significant: number;
}
export interface MotionHost {
  request: (fn: (time: number) => void) => number; cancel: (id: number) => void;
  now: () => number; wall: () => number; memory: () => number | null;
}
export interface PerformanceRecord { at: string; event: string; fps: number; memoryBytes: number | null; level: MotionLevel }
/** One owner of one outstanding rAF. No timers, catch-up queue, or component clocks. */
export class MotionDirector {
  private id: number | null = null;
  private last: number | null = null;
  private started = false;
  private callbacks = new Map<string, { draw: (frame: MotionFrame) => void; significant: boolean }>();
  private listeners = new Set<() => void>();
  private introEnd = motionConfig.intro as number;
  private nextPulse = motionConfig.pulseInterval as number;
  private pulseStart = 0;
  private sampleTime = 0; private sampleFrames = 0;
  private lowTime = 0; private recoveryTime = 0; private nextLog = motionConfig.logInterval as number;
  private notifyTime = 0; private forcedLow = false; private reduced = false;
  private snapshot = 0;
  selectedKey: string | null = null;
  selectionAt = -Infinity;
  setSelection(key: string | null) { this.selectedKey = key; this.selectionAt = this.frame.time; }
  readonly records: PerformanceRecord[] = [];
  frame: MotionFrame = { time: 0, state: 'BOOT', pageVisible: true, voiceActive: false, motionLevel: 'normal', pulse: 0, fps: 60, significant: 0 };
  constructor(private host: MotionHost, readonly pulseInterval = motionConfig.pulseInterval as number) {
    if (pulseInterval < 120_000 || pulseInterval > 180_000) throw new Error('Pulse interval must be 120–180 seconds');
    this.nextPulse = pulseInterval;
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snapshot;
  private notify() { this.snapshot++; this.listeners.forEach(fn => fn()); }
  register(key: string, draw: (frame: MotionFrame) => void, significant = false) {
    this.callbacks.set(key, { draw, significant });
    return () => { this.callbacks.delete(key); };
  }
  start() { if (this.started) return; this.started = true; this.frame.time = this.host.now(); this.frame.state = 'INTRO'; this.introEnd = motionConfig.intro; this.draw(); this.schedule(); }
  dispose() { this.started = false; this.stop(); this.callbacks.clear(); this.listeners.clear(); }
  private stop() { if (this.id !== null) this.host.cancel(this.id); this.id = null; this.last = null; this.sampleFrames = 0; this.sampleTime = 0; this.lowTime = 0; this.recoveryTime = 0; }
  private enabled() { return this.started && this.frame.pageVisible && !this.frame.voiceActive && !this.reduced; }
  private schedule() { if (this.enabled() && this.id === null) this.id = this.host.request(this.tick); }
  private stable() { this.frame.state = this.frame.motionLevel === 'low' ? 'DEGRADED' : 'AMBIENT'; this.frame.pulse = 0; this.nextPulse = this.frame.time + this.pulseInterval; }
  setEnvironment({ pageVisible, voiceActive, reduced }: { pageVisible?: boolean; voiceActive?: boolean; reduced?: boolean }) {
    if ((pageVisible === undefined || pageVisible === this.frame.pageVisible) && (voiceActive === undefined || voiceActive === this.frame.voiceActive) && (reduced === undefined || reduced === this.reduced)) return;
    if (pageVisible !== undefined) this.frame.pageVisible = pageVisible;
    if (voiceActive !== undefined) this.frame.voiceActive = voiceActive;
    if (reduced !== undefined) this.reduced = reduced;
    this.frame.motionLevel = this.reduced ? 'static' : this.forcedLow ? 'low' : this.frame.motionLevel === 'static' ? 'normal' : this.frame.motionLevel;
    this.stop(); this.stable(); this.draw(); this.notify(); this.schedule();
  }
  triggerPulse() {
    if (!this.enabled() || this.frame.motionLevel !== 'normal' || this.frame.state === 'PULSE') return false;
    this.frame.state = 'PULSE'; this.pulseStart = this.frame.time; this.frame.pulse = 0; this.notify(); return true;
  }
  cancelPulse() { this.stable(); this.draw(); this.notify(); }
  forceLow(value: boolean) { this.forcedLow = value; this.setLevel(value ? 'low' : 'normal', value ? 'forced-low' : 'forced-normal'); }
  private log(event: string) {
    const entry = { at: new Date(this.host.wall()).toISOString(), event, fps: this.frame.fps, memoryBytes: this.host.memory(), level: this.frame.motionLevel };
    this.records.push(entry); if (this.records.length > 144) this.records.shift();
  }
  private setLevel(level: 'normal' | 'low', event: string) {
    this.frame.motionLevel = this.reduced ? 'static' : level; this.stable(); this.lowTime = this.recoveryTime = 0; this.log(event); this.draw(); this.notify();
  }
  private tick = (now: number) => {
    this.id = null;
    if (!this.enabled()) return;
    const delta = this.last === null ? 0 : Math.max(0, now - this.last); this.last = now;
    this.frame.time += delta; this.sampleTime += delta; this.sampleFrames++;
    if (this.sampleTime >= motionConfig.fpsWindow) {
      this.frame.fps = (this.sampleFrames - 1) * 1000 / this.sampleTime;
      if (this.frame.fps < motionConfig.lowFps) this.lowTime += this.sampleTime; else this.lowTime = 0;
      if (this.frame.fps >= motionConfig.recoveryFps) this.recoveryTime += this.sampleTime; else this.recoveryTime = 0;
      if (!this.forcedLow && this.lowTime >= motionConfig.lowDuration && this.frame.motionLevel === 'normal') this.setLevel('low', 'fps-low');
      else if (!this.forcedLow && this.recoveryTime >= motionConfig.recoveryDuration && this.frame.motionLevel === 'low') this.setLevel('normal', 'fps-recovered');
      this.sampleTime = 0; this.sampleFrames = 1;
    }
    if (this.frame.state === 'INTRO' && this.frame.time >= this.introEnd) this.stable();
    if (this.frame.state === 'PULSE') {
      this.frame.pulse = Math.min(1, (this.frame.time - this.pulseStart) / motionConfig.pulseDuration);
      if (this.frame.pulse >= 1) this.stable();
    } else if (this.frame.state === 'AMBIENT' && this.frame.time >= this.nextPulse) this.triggerPulse();
    if (this.frame.time >= this.nextLog) { this.log('periodic'); this.nextLog = this.frame.time + motionConfig.logInterval; }
    this.draw();
    if (this.frame.time - this.notifyTime >= 250) { this.notifyTime = this.frame.time; this.notify(); }
    this.schedule();
  };
  private draw() {
    this.frame.significant = 0;
    for (const { draw, significant } of this.callbacks.values()) {
      if (significant && this.frame.significant >= motionConfig.maxSignificant) continue;
      draw(this.frame); if (significant) this.frame.significant++;
    }
  }
  get pulseDueIn() { return Math.max(0, this.nextPulse - this.frame.time); }
  get running() { return this.id !== null; }
}
