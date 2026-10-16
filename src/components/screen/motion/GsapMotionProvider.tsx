"use client";
import { gsap } from 'gsap';
import { MotionProvider } from './MotionProvider';
import type { MotionHost } from './MotionDirector';
import type { ReactNode } from 'react';
import { GsapScene } from './GsapScene';

/** The experimental runtime is lazy-loaded: Legacy never starts GSAP's ticker. */
function createHost(): MotionHost {
  let next = 0, attached = false, requesting = false;
  const jobs = new Map<number, (time: number) => void>();
  const tick = () => {
    if (requesting) return; // ticker.wake() may tick synchronously; request must behave like rAF.
    const pending = [...jobs.values()]; jobs.clear();
    pending.forEach(fn => fn(performance.now()));
    if (!jobs.size) gsap.ticker.sleep();
  };
  return {
    request: fn => {
      const id = ++next; jobs.set(id, fn); requesting = true;
      if (!attached) { attached = true; gsap.ticker.fps(60); gsap.ticker.add(tick); }
      requesting = false;
      return id;
    },
    cancel: id => { jobs.delete(id); if (!jobs.size) { gsap.ticker.remove(tick); attached = false; gsap.ticker.sleep(); } },
    now: () => 0, wall: () => Date.now(),
    memory: () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
  };
}
// Timelines are detached and explicitly sought by the director, never automatically played.
const runtime = { sleep: () => gsap.ticker.sleep(), audit: () => ({ liveScenes: GsapScene.liveScenes, liveTimelines: GsapScene.liveTimelines, rootAnimations: gsap.globalTimeline.getChildren().length }), createHost, createScene: (orders: number[]) => new GsapScene(orders) };
export default function GsapMotionProvider({ children, dataTime }: { children: ReactNode; dataTime: string }) {
  return <MotionProvider dataTime={dataTime} runtime={runtime}>{children}</MotionProvider>;
}
