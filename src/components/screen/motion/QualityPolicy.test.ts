import { describe, expect, it } from 'vitest';
import { candidateParameters as c, effectiveTargetHz, probeDelayMs, ProbeQualityPolicy, type QualitySample } from './QualityPolicy';
import { resolveQualityMode as resolveServerMode } from './quality-permission';
const resolveQualityMode = (params: Record<string, string | string[] | undefined>, grant?: string) => resolveServerMode(params, grant, '127.0.0.1:3026', true);
function rig() {
  const policy = new ProbeQualityPolicy(); let at = 0;
  const step = (hz = 60, p95 = 16.7, extra: Partial<QualitySample> = {}) => {
    at += 1000;
    return policy.sample({ atMs: at, targetHz: 60, updateHz: hz, intervalP95Ms: p95,
      window: { startMs: at - 1000, endMs: at, updates: Math.max(2, hz) }, normalLoad: true,
      environment: { pageVisible: true, reduced: false, voiceActive: false, phase: 'AMBIENT', calibration: 1 }, ...extra });
  };
  return { policy, step, low: () => { step(20, 50); return step(20, 50); }, due: () => { for (let i = 0; i < 9; i++) step(); return step(); } };
}
describe('typed P1.5-B policy', () => {
  it('preserves the verified thresholds, effective target and capped backoff', () => {
    expect(c).toMatchObject({ completionRatio: .75, absoluteFloorHz: 45, severeCompletionRatio: .55, severeFloorHz: 30, abnormalP95Multiplier: 1.8, lowDurationMs: 4000, severeDurationMs: 2000, probePassRatio: .9, probeAbsoluteFloorHz: 52, probeP95Multiplier: 1.5, probePassWindows: 3 });
    expect(effectiveTargetHz(100, 60)).toBe(60); expect(effectiveTargetHz(60, null)).toBe(60);
    expect([0,1,2,3,30].map(probeDelayMs)).toEqual([10000,20000,40000,60000,60000]);
  });
  it('requires all ordinary degradation conditions for four complete windows', () => {
    const r = rig(); for (let i = 0; i < 3; i++) expect(r.step(40, 40).state).toBe('normal');
    expect(r.step(40, 40)).toMatchObject({ state: 'low', reason: 'sustained-low-frequency-and-tail', lowEvidenceMs: 4000 });
  });
  it.each([[45,40], [44,20], [60,100], [44.999,30]])('does not lower for boundary/tail-only %sHz p95=%s', (hz, p95) => {
    const r = rig(); for (let i = 0; i < 12; i++) expect(r.step(hz,p95).state).toBe('normal');
  });
  it('protects severe low cadence after two complete windows', () => {
    const r = rig(); expect(r.step(20,50).state).toBe('normal');
    expect(r.step(20,50)).toMatchObject({ state:'low', reason:'severe-low-frequency', nextProbeAtMs:12000 });
  });
  it('still protects a one-update-per-second scene rather than rejecting every severe sample', () => {
    const r=rig();expect(r.step(1,1000,{window:{startMs:0,endMs:1000,updates:1}}).state).toBe('normal');
    expect(r.step(1,1000,{window:{startMs:1000,endMs:2000,updates:1}})).toMatchObject({state:'low',reason:'severe-low-frequency'});
  });
  it('never recovers from low workload, fails full load immediately and backs off', () => {
    const r=rig(); r.low(); expect(r.due().state).toBe('probe');
    for(let i=0;i<5;i++) expect(r.step(60,16.7,{normalLoad:false})).toMatchObject({state:'probe',probePasses:0});
    expect(r.step(21,50)).toMatchObject({state:'low', failureCount:1, nextProbeAtMs:38000});
  });
  it('recovers only after three consecutive full normal load windows; failures reset on success', () => {
    const r=rig(); r.low(); r.due(); r.step(21,50);
    for(let i=0;i<20;i++) r.step();
    expect(r.step().state).toBe('probe'); expect(r.step().state).toBe('probe');
    expect(r.step()).toMatchObject({state:'normal',failureCount:0,nextProbeAtMs:null,reason:'normal-load-probe-passed'});
  });
  it('rejects P95 tail failure even if mean frequency passes', () => {
    const r=rig(); r.low(); r.due(); expect(r.step(60,40)).toMatchObject({state:'low',reason:'normal-load-probe-failed'});
  });
  it('does not accumulate intermittent bad evidence', () => {
    const r=rig(); for(let i=0;i<20;i++){r.step(40,40); expect(r.step().state).toBe('normal');}
  });
  it.each(['pageVisible','voiceActive','reduced'] as const)('drops evidence and probe passes across %s pause', key => {
    const r=rig(); r.step(20,50);
    r.step(0,1000,{environment:{pageVisible:key!=='pageVisible', voiceActive:key==='voiceActive', reduced:key==='reduced',phase:'AMBIENT',calibration:1}});
    expect(r.step(20,50).state).toBe('normal'); r.step(20,50); r.due(); r.step();
    expect(r.policy.interrupt(15000,'paused')).toMatchObject({state:'low',probePasses:0});
    expect(r.step()).toMatchObject({state:'probe',probePasses:0});expect(r.step().state).toBe('probe');expect(r.step().state).toBe('probe');expect(r.step().state).toBe('normal');
  });
  it('retains a low-state deadline across repeated pauses and bounds a regressed clock', () => {
    const r=rig();r.low();expect(r.policy.interrupt(5000,'voice')).toMatchObject({nextProbeAtMs:12000,failureCount:0});
    expect(r.policy.interrupt(9000,'resumed')).toMatchObject({nextProbeAtMs:12000});
    expect(r.policy.interrupt(-5000,'clock-regressed')).toMatchObject({nextProbeAtMs:5000});
  });
  it('retains the reserved opportunity for an interrupted full-load probe without incrementing failures or counting old passes', () => {
    const r=rig();r.low();r.due();r.step();expect(r.policy.interrupt(14000,'voice')).toMatchObject({state:'low',nextProbeAtMs:12000,failureCount:0,probePasses:0});
    expect(r.policy.interrupt(16000,'resumed').nextProbeAtMs).toBe(12000);
  });
  it('invalid, overlapping, stale and clock-change windows cannot contribute evidence', () => {
    const r=rig(); r.step(20,50);
    expect(r.step(20,50,{window:{startMs:0,endMs:2000,updates:40}}).reason).toBe('discontinuous-window');
    expect(r.step(20,50).state).toBe('normal');
    expect(r.step(NaN,50).reason).toBe('invalid-or-incomplete-window');
    expect(r.step(20,50,{targetHz:100}).reason).toBe('reference-recalibrated');
  });
  it('defers probes throughout INTRO/PULSE and starts in the first stable window', () => {
    const r=rig(); r.low();
    for(let i=0;i<40;i++) expect(r.step(60,16.7,{environment:{pageVisible:true,voiceActive:false,reduced:false,phase:i%2?'INTRO':'PULSE',calibration:1}}).state).toBe('low');
    expect(r.step()).toMatchObject({state:'probe', reason:'scheduled-normal-load-probe'});
  });
  it('a calibration change during probe returns low without losing failures', () => {
    const r=rig();r.low();r.due();r.step(20,50);for(let i=0;i<20;i++)r.step();
    expect(r.step(60,16.7,{targetHz:100})).toMatchObject({state:'low',failureCount:1,reason:'reference-recalibrated'});
  });
});
describe('server experimental permission', () => {
  it.each([undefined, '', 'true', 'candidate', 'invalid'])('denies URL-only control with permission %s', permission => {
    for(const mode of ['candidate','shadow','external']) expect(resolveQualityMode({debug:'1',qualityExperiment:mode}, permission)).toBe('baseline');
  });
  it('denies non-local hosts even with a server grant', () => { for (const host of [null, 'company.example', '127.0.0.1.attacker.test', 'localhost.example']) expect(resolveServerMode({ debug: '1', qualityExperiment: 'candidate' }, 'local-candidate', host, true)).toBe('baseline'); });
  it('separates shadow permission from control and rejects old/invalid/multiple parameters', () => {
    expect(resolveQualityMode({debug:'1',qualityExperiment:'candidate'},'local-shadow')).toBe('baseline');
    expect(resolveQualityMode({debug:'1',qualityExperiment:'shadow'},'local-shadow')).toBe('shadow');
    expect(resolveQualityMode({debug:'1',qualityExperiment:'candidate'},'local-candidate')).toBe('candidate');
    for (const params of [{}, {qualityExperiment:'candidate'}, {debug:'1',qualityExperiment:'external'}, {debug:'1',qualityExperiment:['candidate','shadow']}]) expect(resolveQualityMode(params,'local-candidate')).toBe('baseline');
  });
});
