import { afterEach, describe, expect, it } from "vitest";
import { XiaochuanTimeline } from "./XiaochuanTimeline";
import type { MotionHost } from "@/components/screen/motion/MotionDirector";
function setup(reduced = false) {
  let now = 0, id = 0;
  const jobs = new Map<number, (time: number) => void>();
  const host = { request: (fn: (time: number) => void) => { jobs.set(++id, fn); return id; }, cancel: (key: number) => { jobs.delete(key); }, clockNow: () => now, now: () => now, wall: () => now, memory: () => null } satisfies MotionHost;
  const motion = new XiaochuanTimeline(host, reduced); controllers.push(motion);
  return { motion, jobs, step: (time: number) => { now = time; const pending = [...jobs.values()]; jobs.clear(); pending.forEach(fn => fn(now)); } };
}
const controllers: XiaochuanTimeline[] = [];
afterEach(() => { controllers.splice(0).forEach(c => c.dispose()); expect(XiaochuanTimeline.liveTimelines).toBe(0); expect(XiaochuanTimeline.liveControllers).toBe(0); });
describe("visual timeline isolation", () => {
  it("keeps the existing pulse/stream/unfold landmarks on one absolute clock", () => {
    const {motion, step, jobs} = setup(); motion.answer(0);
    step(120); expect(motion.visual.pulse).toBe(1); expect(motion.visual.stream).toBeCloseTo(20/350,5); expect(motion.visual.unfold).toBe(0);
    step(450); expect(motion.visual.stream).toBe(1); expect(motion.visual.unfold).toBeCloseTo(.2);
    step(650); expect(motion.visual.unfold).toBe(1);
    step(900); expect(motion.visual.followups).toBe(1); expect(motion.visual.metricsContent).toBe(1); expect(() => JSON.stringify(motion.audit())).not.toThrow(); expect(jobs.size).toBe(0); expect(motion.audit().tracks).toEqual([]);
  });
  it("folds the actual partial pose and replaces an old turn without listeners growing", () => {
    const {motion, step, jobs} = setup(); motion.answer(0); step(530);
    const pose = motion.visual.unfold; motion.fold(530); expect(motion.visual.foldFrom).toBeCloseTo(pose);
    step(630); expect(motion.visual.fold).toBeCloseTo(.5);
    motion.answer(630); expect(motion.visual.fold).toBe(0); expect(motion.visual.unfold).toBe(0);
    step(1530); expect(jobs.size).toBe(0); expect(motion.audit().tracks).toEqual([]);
  });
  it("releases the host job while hidden and catches up instead of replaying", () => {
    const {motion, step, jobs} = setup(); motion.answer(0); step(120); motion.visibility(true);
    expect(jobs.size).toBe(0); step(2000); motion.visibility(false);
    expect(motion.visual.unfold).toBe(1); expect(jobs.size).toBe(0); expect(motion.audit().tracks).toEqual([]);
  });
  it("finishes reduced-motion tracks without an animation job", () => {
    const {motion, jobs} = setup(true); motion.takeover(0); motion.answer(0); motion.close(0); motion.exit(0);
    expect(motion.visual.fold).toBe(1); expect(motion.visual.opacity).toBe(0); expect(jobs.size).toBe(0);
  });
  it("repeated wake/exit and dispose release all tracks and subscriptions", () => {
    const {motion, step, jobs} = setup(); let updates=0; motion.subscribe(() => updates++);
    for(let i=0;i<30;i++) { const at=i*3000; step(at); motion.takeover(at); motion.caption(at); motion.geometry(900,225,at); step(at+900); motion.close(at+900); step(at+1700); motion.exit(at+1700); step(at+2200); }
    expect(jobs.size).toBe(0); motion.takeover(90000); expect(motion.visual.formation).toBe(0);
    motion.dispose(); const previous=updates; step(100000); expect(updates).toBe(previous); expect(jobs.size).toBe(0); expect(motion.audit().subscribers).toBe(0);
  });
});
