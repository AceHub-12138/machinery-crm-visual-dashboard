import { gsap } from 'gsap';
import type { MotionHost } from './MotionDirector';
let configured = false;
const listeners = new Set<() => void>();
let updates = 0, firstAt: number | null = null, lastAt: number | null = null;
/** Sole application ticker management entry. Keep the PoC 60Hz cap. */
export function settleGsapIdle() {
  // Pinned GSAP 3.15 topology inspected read-only. Unknown consumers => no global sleep.
  const ticker = gsap.ticker as typeof gsap.ticker & { _listeners?: unknown[] };
  if (!listeners.size && ticker._listeners?.length === 1 && ticker._listeners[0] === gsap.updateRoot
    && gsap.globalTimeline.getChildren().length === 0) gsap.ticker.sleep();
}
export function tickerAudit() {
  return { configuredCapHz: 60, activeListeners: listeners.size, listenerUpdates: updates, firstAtMs: firstAt, lastAtMs: lastAt };
}
export function createGsapHost(): MotionHost {
  let next = 0, attached = false, requesting = false;
  const jobs = new Map<number, (time: number) => void>();
  const detach = () => {
    if (attached) { gsap.ticker.remove(tick); listeners.delete(tick); attached = false; }
    settleGsapIdle();
  };
  const tick = () => {
    const now = performance.now(); updates++; firstAt ??= now; lastAt = now;
    if (requesting) return; // GSAP wake can synchronously invoke the listener.
    const pending = [...jobs.values()]; jobs.clear(); pending.forEach(fn => fn(now));
    if (!jobs.size) detach();
  };
  return {
    request: fn => {
      const id = ++next; jobs.set(id, fn);
      if (!attached) {
        if (!configured) { gsap.ticker.fps(60); configured = true; }
        requesting = true; attached = true; listeners.add(tick);
        try { gsap.ticker.add(tick); } finally { requesting = false; }
      }
      return id;
    },
    cancel: id => { jobs.delete(id); if (!jobs.size) detach(); },
    now: () => 0, clockNow: () => performance.now(), wall: () => Date.now(),
    memory: () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
  };
}
