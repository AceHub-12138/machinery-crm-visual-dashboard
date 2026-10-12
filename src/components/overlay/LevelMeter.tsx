"use client";
import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/** Read-only volume feedback. At 20Hz it neither drives capture nor adds a RAF loop. */
export function LevelMeter({ sample }: { sample: () => number }) {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const update = () => {
      const el = root.current;
      if (!el) return;
      const level = Math.max(0,Math.min(1,sample()));
      el.dataset.level = level.toFixed(3);
      for (const [i,bar] of [...el.querySelectorAll<HTMLElement>("span")].entries()) {
        bar.style.transform = `scaleY(${reduced ? .18 : .18 + level * .82 * (1-Math.abs(i-3)*.15)})`;
      }
    };
    update();
    const timer = window.setInterval(update,50);
    return () => window.clearInterval(timer);
  },[sample,reduced]);
  return <div ref={root} className="overlay-level" aria-label="麦克风输入音量">{Array.from({length:7},(_,i)=><span key={i} aria-hidden="true" />)}</div>;
}
