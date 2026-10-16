import { describe, expect, it } from 'vitest';
import { MotionDirector } from './MotionDirector';
function rig() {
  let now = 0, next = 0, requested = 0, cancelled = 0;
  const pending = new Map<number, (time: number) => void>();
  const director = new MotionDirector({ request: fn => { requested++; pending.set(++next, fn); return next; }, cancel: id => { cancelled++; pending.delete(id); }, now: () => now, wall: () => 1_000_000 + now, memory: () => 10_000 });
  const step = (delta = 1000 / 60) => { now += delta; const entries = [...pending.values()]; pending.clear(); entries.forEach(fn => fn(now)); };
  const run = (ms: number, delta = 1000 / 60) => { for (let i = 0; i < Math.ceil(ms / delta); i++) step(delta); };
  return { director, pending, step, run, stats: () => ({ requested, cancelled }) };
}
describe('MotionDirector', () => {
  it('owns only one frame loop for all registered effects and cleans up without timers', () => {
    const r = rig(); let draws = 0;
    const remove = r.director.register('map', () => draws++);
    r.director.start(); r.director.start();
    for (let i = 0; i < 10; i++) { expect(r.pending.size).toBe(1); r.step(); }
    expect(draws).toBe(11); expect(r.stats().requested).toBe(11);
    remove(); r.director.dispose(); expect(r.pending.size).toBe(0); expect(r.director.running).toBe(false);
    r.director.dispose(); expect(r.stats().cancelled).toBe(1);
  });
  it('intro finishes within 2.5 seconds; automatic pulse is timed from completion', () => {
    const r = rig(); r.director.start(); expect(r.director.frame.state).toBe('INTRO');
    r.run(2500); expect(r.director.frame.state).toBe('AMBIENT');
    r.run(150_000); expect(r.director.frame.state).toBe('PULSE');
    r.run(10_000); expect(r.director.frame.state).toBe('AMBIENT');
    r.run(149_000); expect(r.director.frame.state).toBe('AMBIENT');
    r.run(1100); expect(r.director.frame.state).toBe('PULSE');
  });
  it('hidden page pauses the clock, clears pulse, and resumes stable without catch-up', () => {
    const r = rig(); r.director.start(); r.run(2500); r.director.triggerPulse(); r.run(5000);
    r.director.setEnvironment({ pageVisible: false }); const time = r.director.frame.time;
    expect(r.pending.size).toBe(0); expect(r.director.frame.pulse).toBe(0);
    r.run(600_000); expect(r.director.frame.time).toBe(time);
    r.director.setEnvironment({ pageVisible: true }); r.step(); expect(r.director.frame.time).toBe(time);
    expect(r.director.frame.state).toBe('AMBIENT'); r.run(149_000); expect(r.director.frame.state).toBe('AMBIENT');
  });
  it('voice wake cancels pulse immediately, blocks retrigger, and restarts interval on exit', () => {
    const r = rig(); r.director.start(); r.run(2500); expect(r.director.triggerPulse()).toBe(true); r.run(5000);
    r.director.setEnvironment({ voiceActive: true }); expect(r.director.frame.pulse).toBe(0); expect(r.director.running).toBe(false); expect(r.director.triggerPulse()).toBe(false);
    r.run(200_000); r.director.setEnvironment({ voiceActive: false }); r.run(1000); expect(r.director.frame.state).toBe('AMBIENT');
    r.director.triggerPulse(); r.director.cancelPulse(); expect(r.director.frame.state).toBe('AMBIENT'); expect(r.director.frame.pulse).toBe(0);
  });
  it('five seconds below 45fps degrades, and ten seconds recovered upgrades', () => {
    const r = rig(); r.director.start(); r.run(6100, 40);
    expect(r.director.frame.motionLevel).toBe('low'); expect(r.director.frame.state).toBe('DEGRADED');
    expect(r.director.triggerPulse()).toBe(false); expect(r.director.records[0].event).toBe('fps-low');
    r.run(12_000); expect(r.director.frame.motionLevel).toBe('normal'); expect(r.director.records[1].event).toBe('fps-recovered');
  });
  it('reduced motion is static, respects manual low mode, and creates no pending frame', () => {
    const r = rig(); r.director.start(); r.director.forceLow(true); r.director.setEnvironment({ reduced: true });
    expect(r.pending.size).toBe(0); expect(r.director.frame.motionLevel).toBe('static'); expect(r.director.triggerPulse()).toBe(false);
    r.director.setEnvironment({ reduced: false }); expect(r.director.frame.motionLevel).toBe('low'); r.run(15_000); expect(r.director.frame.motionLevel).toBe('low');
    r.director.forceLow(false); expect(r.director.frame.motionLevel).toBe('normal');
  });
  it('logs fps and available memory every ten minutes with a bounded buffer', () => {
    const r = rig(); r.director.start(); r.run(601_000);
    expect(r.director.records).toHaveLength(1); expect(r.director.records[0]).toMatchObject({ event: 'periodic', memoryBytes: 10_000, level: 'normal' }); expect(r.director.records[0].fps).toBeGreaterThan(59);
  });
  it('admits at most eight independent significant effects', () => {
    const r = rig(); let count = 0;
    for (let i = 0; i < 9; i++) r.director.register(String(i), () => count++, true);
    r.director.start(); expect(count).toBe(8); expect(r.director.frame.significant).toBe(8);
  });
  it('rejects pulse configurations outside the allowed interval', () => {
    expect(() => new MotionDirector({ request: () => 1, cancel: () => {}, now: () => 0, wall: () => 0, memory: () => null }, 119_000)).toThrow();
  });
});
