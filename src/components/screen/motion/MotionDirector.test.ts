import { describe, expect, it } from 'vitest';
import { MotionDirector, type MotionDirectorOptions } from './MotionDirector';
function rig(options: MotionDirectorOptions = {}) {
  let now = 0, next = 0, requested = 0, cancelled = 0;
  const pending = new Map<number, (time: number) => void>();
  const director = new MotionDirector({ request: fn => { requested++; pending.set(++next, fn); return next; }, cancel: id => { cancelled++; pending.delete(id); }, now: () => now, wall: () => 1_000_000 + now, memory: () => 10_000 }, undefined, options);
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
  it('restarts intro from the current clock and rejects restart while interrupted', () => {
    const r = rig(); r.director.start(); r.run(8000);
    expect(r.director.restartIntro()).toBe(true); expect(r.director.introTime).toBe(0);
    r.run(1000); expect(r.director.frame.state).toBe('INTRO');
    r.run(1300); expect(r.director.frame.state).toBe('AMBIENT');
    r.director.setEnvironment({ voiceActive: true }); expect(r.director.restartIntro()).toBe(false);
    r.director.setEnvironment({ voiceActive: false, reduced: true }); expect(r.director.restartIntro()).toBe(false);
    r.director.dispose(); expect(r.pending.size).toBe(0);
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
  it('has one policy owner; shadow observes while candidate alone controls quality', () => {
    for (const qualityMode of ['baseline', 'shadow', 'candidate'] as const) {
      const r = rig({ qualityMode }); r.director.start(); r.run(3500, 50);
      expect(r.director.frame.motionLevel).toBe(qualityMode === 'candidate' ? 'low' : 'normal');
      if (qualityMode === 'shadow') expect(r.director.qualityDecision?.state).toBe('low');
      if (qualityMode === 'candidate') { r.director.forceLow(false); expect(r.director.frame.motionLevel).toBe('low'); }
      r.director.dispose();
    }
  });
  it('fails safely to baseline on throwing or malformed policies', () => {
    for (const policy of [{ sample: () => { throw new Error('test'); }, interrupt: () => { throw new Error('test'); } }, { sample: () => null, interrupt: () => null }]) {
      const r = rig({ qualityMode: 'candidate', policy: policy as never }); r.director.start(); r.run(1800);
      expect(r.director.qualityMode).toBe('baseline'); r.run(6100, 40); expect(r.director.frame.motionLevel).toBe('low'); r.director.dispose();
    }
  });
  it('candidate preserves backoff and drops stale evidence on hidden/voice/reduced/recalibration', () => {
    const r = rig({ qualityMode: 'candidate', engineCapHz: 60 }); r.director.start(); r.run(15_000, 50);
    expect(r.director.qualityDecision?.failureCount).toBe(1);
    for (const env of [{ pageVisible: false }, { voiceActive: true }, { reduced: true }]) {
      r.director.setEnvironment(env); expect(r.pending.size).toBe(0); r.run(80_000);
      r.director.setEnvironment({ pageVisible: true, voiceActive: false, reduced: false });
      expect(r.director.frame.motionLevel).toBe('low'); expect(r.pending.size).toBe(1);
      expect(r.director.qualityDecision?.failureCount).toBe(1);
    }
    r.director.setCalibration(100); expect(r.director.qualityDecision?.reason).toBe('reference-recalibrated');
    r.run(90_000); expect(r.director.frame.motionLevel).toBe('normal'); expect(r.director.qualityDecision?.failureCount).toBe(0);
    r.director.dispose();
  });
  it('does not starve recovery when frequent short voice takeovers leave enough quiet time for a full probe', () => {
    const r = rig({ qualityMode: 'candidate', engineCapHz: 60 }); r.director.start(); r.run(15_000, 50); expect(r.director.qualityDecision?.failureCount).toBe(1);
    for (let i = 0; i < 6; i++) { r.run(10_000); r.director.setEnvironment({ voiceActive: true }); r.run(1000); r.director.setEnvironment({ voiceActive: false }); }
    expect(r.director.frame.motionLevel).toBe('normal'); expect(r.director.qualityRecords.some(d => d.reason === 'normal-load-probe-passed')).toBe(true); r.director.dispose();
  });
  it('distinguishes environmental pause from the id=null window inside active draw', () => {
    const r = rig(); const seen: { running: boolean; paused: boolean }[] = []; r.director.register('audit', () => seen.push({ running: r.director.running, paused: r.director.paused }));
    r.director.start(); r.step(); expect(seen.at(-1)).toEqual({ running: false, paused: false });
    r.director.setEnvironment({ reduced: true }); expect(r.director.paused).toBe(true); expect(r.pending.size).toBe(0); r.director.dispose();
  });
  it('drops stale evidence if the host clock regresses while preserving the monotonic scene clock', () => {
    const r = rig({ qualityMode: 'candidate' }); r.director.start(); r.run(1500, 50); const sceneTime = r.director.frame.time; r.step(-1000);
    expect(r.director.frame.time).toBe(sceneTime); expect(r.director.qualityDecision?.reason).toBe('clock-regressed');
    r.run(1200, 50); expect(r.director.frame.motionLevel).toBe('normal'); r.run(1200, 50); expect(r.director.frame.motionLevel).toBe('low'); r.director.dispose();
  });
  it('rejects unauthorized manual quality overrides even if debug DOM is tampered with', () => {
    const r = rig({ manualQualityAllowed: false }); r.director.start(); r.director.forceLow(true); expect(r.director.frame.motionLevel).toBe('normal'); r.run(6100, 40); expect(r.director.frame.motionLevel).toBe('low'); r.director.forceLow(false); expect(r.director.frame.motionLevel).toBe('low'); r.director.dispose();
  });
  it('fails closed below the unchanged 52Hz probe floor instead of locking the experiment low forever', () => {
    const r = rig({ qualityMode: 'candidate' }); r.director.start(); r.run(4000, 50); r.director.setCalibration(30);
    expect(r.director.qualityMode).toBe('baseline'); expect(r.director.records.at(-1)?.event).toBe('reference-below-supported-probe-floor'); r.director.dispose();
  });
  it('reserves a stable probe after bounded INTRO deferral without interrupting the current cue', () => {
    const r = rig({ qualityMode: 'candidate' }); r.director.start(); r.run(4000, 50);
    for (let i = 0; i < 45; i++) { r.director.restartIntro(); r.run(1000); }
    expect(r.director.qualityRecords.some(d => d.reason === 'probe-deferred-until-ambient')).toBe(true);
    r.run(7000); expect(r.director.frame.motionLevel).toBe('normal'); r.director.dispose();
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
