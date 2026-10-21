import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeferredRecalibration, type RecalibrationContext } from './DeferredRecalibration';
import { MotionDirector } from './MotionDirector';
const flush = () => Promise.resolve();
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());
function rig() {
  let now = 0;
  const context: RecalibrationContext = { active: true, phase: 'INTRO', probe: false, pauseReason: 'hidden' };
  const completions: ((hz: number) => void)[] = [], cancel = vi.fn(), suspend = vi.fn(), resume = vi.fn(), apply = vi.fn(), fallback = vi.fn();
  const measure = vi.fn((done: (hz: number) => void) => { completions.push(done); return cancel; });
  const queue = new DeferredRecalibration({ now: () => now, context: () => context, measure, suspend, resume, apply, fallback });
  const step = (ms: number) => { now += ms; queue.advance(); vi.advanceTimersByTime(ms); };
  return { queue, context, completions, cancel, suspend, resume, apply, fallback, measure, step, setNow: (value: number) => { now = value; } };
}
describe('deferred runtime recalibration', () => {
  it('coalesces requests without extending first time/budget and consumes only after the tick', async () => {
    const r = rig(); r.queue.request(); r.step(1200); r.queue.request(); r.step(1200); r.queue.request();
    expect(r.queue.snapshot).toMatchObject({ version: 3, firstRequestedAt: 0, activeMs: 2400 });
    await flush(); expect(r.measure).not.toHaveBeenCalled();
    r.context.phase = 'AMBIENT'; r.queue.advance(); expect(r.measure).not.toHaveBeenCalled();
    await flush(); expect(r.measure).toHaveBeenCalledTimes(1); r.completions[0](100);
    expect(r.apply).toHaveBeenCalledExactlyOnceWith(100); expect(r.queue.waiting).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it('reserves after 30 active seconds, with a finite deadline that repeated requests cannot reset', async () => {
    const r = rig(); r.queue.request();
    for (let i = 0; i < 29; i++) { r.step(1000); r.queue.request(); await flush(); }
    expect(r.queue.reserved).toBe(false); r.step(1000); expect(r.queue.reserved).toBe(true);
    for (let i = 0; i < 14; i++) { r.step(1000); r.queue.request(); await flush(); }
    r.step(1000); expect(r.fallback).toHaveBeenCalledExactlyOnceWith('recalibration-active-deadline-exceeded');
    expect(r.queue.waiting).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it('has a finite deadline even when Director RAF stops unexpectedly', () => {
    const r = rig(); r.queue.request(); r.setNow(45_000); vi.advanceTimersByTime(45_000);
    expect(r.fallback).toHaveBeenCalledExactlyOnceWith('recalibration-active-deadline-exceeded');
  });
  it.each(['hidden', 'voice', 'reduced-motion'])('pauses budget and cancels actual measurement on %s, ignoring late completions', async pauseReason => {
    const r = rig(); r.queue.request(); r.step(12_000); r.context.active = false; r.context.pauseReason = pauseReason; r.queue.advance();
    r.step(600_000); expect(r.queue.snapshot).toMatchObject({ state: 'paused', activeMs: 12_000 }); expect(vi.getTimerCount()).toBe(0);
    r.context.active = true; r.context.phase = 'AMBIENT'; r.queue.advance(); await flush(); expect(r.queue.measuring).toBe(true);
    r.context.active = false; r.queue.advance(); expect(r.cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    r.completions[0](120); expect(r.apply).not.toHaveBeenCalled();
    r.step(600_000); r.context.active = true; r.queue.advance(); await flush(); r.completions[1](60);
    expect(r.apply).toHaveBeenCalledExactlyOnceWith(60); expect(r.fallback).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('discards an old version, measures the newest, and retains the original active budget', async () => {
    const r = rig(); r.context.phase = 'AMBIENT'; r.queue.request(); await flush(); r.step(200); r.queue.request();
    r.completions[0](100); expect(r.apply).not.toHaveBeenCalled(); expect(r.queue.snapshot).toMatchObject({ version: 2, firstRequestedAt: 0, activeMs: 200 });
    await flush(); r.completions[1](60); expect(r.apply).toHaveBeenCalledExactlyOnceWith(60);
    expect(r.queue.records.some(e => e.event === 'discarded-stale-version')).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for an existing probe and rechecks an environment change after queueing', async () => {
    const r = rig(); r.context.phase = 'DEGRADED'; r.context.probe = true; r.queue.request(); await flush(); expect(r.measure).not.toHaveBeenCalled();
    r.context.probe = false; r.queue.advance(); r.context.active = false; await flush(); expect(r.measure).not.toHaveBeenCalled();
    r.context.active = true; r.queue.advance(); await flush(); expect(r.measure).toHaveBeenCalledTimes(1); r.queue.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('falls back on invalid/timeout results, unverified scene/clock and measurement exceptions', async () => {
    for (const kind of ['NaN', 'scene', 'clock', 'exception', 'completion-state']) {
      const r = rig(); r.context.phase = 'AMBIENT';
      if (kind === 'exception') r.measure.mockImplementationOnce(() => { throw Error('broken'); });
      r.queue.request();
      if (kind === 'scene') { r.context.phase = 'unknown'; r.queue.advance(); }
      if (kind === 'clock') { r.setNow(-1); r.queue.advance(); }
      await flush();
      if (kind === 'completion-state') { r.context.probe = true; r.completions[0](60); }
      if (kind === 'NaN') r.completions[0](NaN);
      expect(r.fallback).toHaveBeenCalledTimes(1); expect(r.queue.waiting).toBe(false); expect(vi.getTimerCount()).toBe(0);
    }
  });
  it('cleans queued microtasks, deadline, measurement and stale results on dispose/engine switch', async () => {
    const r = rig(); r.context.phase = 'AMBIENT'; r.queue.request(); r.queue.dispose(); await flush(); expect(r.measure).not.toHaveBeenCalled();
    const s = rig(); s.context.phase = 'AMBIENT'; s.queue.request(); await flush(); s.queue.dispose(); s.completions[0](120); s.queue.request();
    expect(s.cancel).toHaveBeenCalledTimes(1); expect(s.apply).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
function directorRig(qualityMode: 'baseline' | 'candidate' | 'shadow' = 'candidate') {
  let now = 0, id = 0;
  const pending = new Map<number, (time: number) => void>(), completions: ((hz: number) => void)[] = [];
  const d = new MotionDirector({ now: () => now, request: fn => { pending.set(++id, fn); return id; }, cancel: id => { pending.delete(id); }, wall: () => now, memory: () => null }, undefined, { qualityMode });
  d.attachRecalibration(done => { completions.push(done); return () => {}; });
  const step = (ms = 1000 / 60) => { now += ms; const jobs = [...pending.values()]; pending.clear(); jobs.forEach(fn => fn(now)); };
  const run = (ms: number, delta = 1000 / 60) => { for (let t = 0; t < ms; t += delta) step(delta); };
  d.start();
  return { d, pending, completions, step, run };
}
describe('Director arbitration and evidence', () => {
  it.each(['INTRO', 'PULSE'])('%s reaches its natural end before measuring, with no draw reentry', async cue => {
    const r = directorRig(); r.run(3000); if (cue === 'INTRO') r.d.restartIntro(); else r.d.triggerPulse();
    r.run(350); const time = r.d.frame.time; let insideDraw = false;
    r.d.register('request-in-draw', () => { if (!insideDraw) { insideDraw = true; r.d.requestRecalibration(); expect(r.d.recalibration?.measuring).toBe(false); } });
    r.step(); await flush(); expect(r.d.frame.state).toBe(cue); expect(r.d.paused).toBe(false);
    r.run(cue === 'INTRO' ? 1500 : 9000); await flush(); expect(r.d.frame.state).toBe(cue);
    r.run(1000); expect(r.completions.length).toBe(0); await flush(); expect(r.completions.length).toBe(1);
    expect(r.d.frame.time - time).toBeGreaterThan(cue === 'INTRO' ? 1800 : 9600); expect(r.pending.size).toBe(0);
    const due = r.d.pulseDueIn; r.completions[0](100); expect(r.d.pulseDueIn).toBe(due); expect(r.pending.size).toBe(1); r.d.dispose();
  });
  it('blocks new cues after the active reservation without ending the current cue', async () => {
    const r = directorRig(); r.d.requestRecalibration();
    for (let i = 0; i < 29; i++) { r.run(1000); await flush(); r.d.restartIntro(); }
    r.run(1100); await flush(); expect(r.d.recalibration?.reserved).toBe(true); expect(r.d.frame.state).toBe('INTRO');
    expect(r.d.restartIntro()).toBe(false); expect(r.d.triggerPulse()).toBe(false);
    r.run(1400); await flush(); expect(r.completions.length).toBe(1); r.completions[0](60); expect(r.d.restartIntro()).toBe(true); r.d.dispose();
  });
  it('waits for an actual Candidate probe, then clears target evidence and prevents overlap', async () => {
    const r = directorRig();
    for (let i = 0; i < 400 && r.d.qualityDecision?.state !== 'probe'; i++) r.step(50);
    expect(r.d.qualityDecision?.state).toBe('probe');
    r.d.requestRecalibration(); await flush(); expect(r.completions.length).toBe(0);
    r.run(1500, 50); await flush(); expect(r.d.qualityDecision?.state).toBe('low'); expect(r.completions.length).toBe(1);
    r.completions[0](120); expect(r.d.qualityTargetHz).toBe(120); expect(r.d.qualityDecision).toMatchObject({ reason: 'reference-recalibrated', evidence: null, lowEvidenceMs: 0, probePasses: 0 });
    r.run(500); expect(r.d.qualityDecision?.evidence).toBe(null); r.d.dispose();
  });
  it('Baseline ignores recalibration requests and remains identical frame for frame', async () => {
    const a = directorRig('baseline'), b = directorRig('baseline');
    for (let i = 0; i < 180; i++) { a.d.requestRecalibration(); a.step(); b.step(); expect(a.d.frame).toEqual(b.d.frame); }
    await flush(); expect(a.completions.length).toBe(0); expect(a.d.recalibration?.records).toEqual([]); a.d.dispose(); b.d.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('records a rejected unsupported runtime reference as fallback, never as applied', async () => {
    const r = directorRig(); r.run(3000); r.d.requestRecalibration(); await flush(); r.completions[0](30);
    expect(r.d.qualityMode).toBe('baseline'); expect(r.d.recalibration?.records.some(e => e.event === 'applied')).toBe(false);
    expect(r.d.records.at(-1)?.event).toBe('reference-below-supported-probe-floor'); expect(r.pending.size).toBe(1); expect(vi.getTimerCount()).toBe(0); r.d.dispose();
  });
});
