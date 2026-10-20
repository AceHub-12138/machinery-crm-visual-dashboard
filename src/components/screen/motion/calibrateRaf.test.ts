import {afterEach,expect,it,vi} from 'vitest';
import {calibrateRaf} from './calibrateRaf';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
function rig(){vi.useFakeTimers();let id=0;const pending=new Map<number,FrameRequestCallback>();vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{pending.set(++id,fn);return id;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>pending.delete(id));const step=(time:number)=>{const jobs=[...pending.values()];pending.clear();jobs.forEach(fn=>fn(time));};return{pending,step};}
it('uses finite measured-rate calibration, cleans deadline/RAF and supports refresh rate changes',()=>{
  for(const hz of [60,100]){const r=rig(),done=vi.fn();calibrateRaf(done);for(let i=0;i<=30;i++)r.step(i*1000/hz);expect(done.mock.calls[0][0]).toBeCloseTo(hz);expect(r.pending.size).toBe(0);expect(vi.getTimerCount()).toBe(0);}
});
it('cancels on unmount/pause with no late callback or timers',()=>{const r=rig(),done=vi.fn();const cancel=calibrateRaf(done);r.step(0);cancel();vi.advanceTimersByTime(4000);expect(done).not.toHaveBeenCalled();expect(r.pending.size).toBe(0);expect(vi.getTimerCount()).toBe(0);});
it('fails closed after three seconds if browser RAF stops without a visibility event',()=>{const r=rig(),done=vi.fn();calibrateRaf(done);vi.advanceTimersByTime(3000);expect(done).toHaveBeenCalledExactlyOnceWith(NaN);expect(r.pending.size).toBe(0);});

it('calibrates the actual 60Hz reference for a capped 100Hz display cadence, without a false 50Hz fallback',()=>{const r=rig(),done=vi.fn();calibrateRaf(done);let t=0;r.step(t);for(let i=0;i<30;i++){t+=[20,20,10][i%3];r.step(t);}expect(done).toHaveBeenCalledExactlyOnceWith(60);});
