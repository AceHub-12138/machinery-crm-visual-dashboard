"use client";
import { useEffect, useId, useRef, useState } from 'react';
import { useMotionDirector } from './motion/MotionProvider';
import { motionConfig } from './motion/config';
/** SSR shows the true final value. Only actual snapshot changes register a tween. */
export function AnimatedNumber({ value, format, duration = motionConfig.numberDuration }: { value: number; format: (value: number) => string; duration?: number }) {
  const [initial] = useState(() => format(value));
  const node = useRef<HTMLSpanElement>(null), previous = useRef(value), formatter = useRef(format);
  const director = useMotionDirector(), id = useId();
  useEffect(() => { formatter.current = format; }, [format]);
  useEffect(() => {
    const el = node.current, from = previous.current; previous.current = value;
    if (!el) return;
    if (!director || from === value || !Number.isFinite(from) || !Number.isFinite(value) || from < 0 || value < 0 || director.frame.motionLevel === 'static' || director.frame.voiceActive || !director.frame.pageVisible) { el.textContent = formatter.current(value); return; }
    if (director.frame.state === "PULSE") director.cancelPulse();
    el.dataset.motionNumberActive = "true";
    const start = director.frame.time;
    const unregister = director.register(`number-${id}`, frame => {
      const t = !frame.pageVisible || frame.voiceActive || frame.motionLevel === 'static' ? 1 : Math.min(1, (frame.time - start) / Math.min(1000, Math.max(600, duration)));
      const n = from + (value - from) * (1 - (1 - t) ** 3);
      el.textContent = formatter.current(Number.isInteger(value) ? Math.round(n) : n);
      if (t === 1) { el.dataset.motionNumberActive = "false"; unregister(); }
    });
    return () => { el.dataset.motionNumberActive = "false"; unregister(); };
  }, [director, duration, id, value]);
  return <span ref={node} data-motion-number data-final-number={format(value)}>{initial}</span>;
}
