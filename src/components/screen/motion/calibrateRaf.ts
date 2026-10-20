/** Finite, cancellable calibration while Director is paused. */
export function calibrateRaf(done: (referenceHz: number) => void): () => void {
  let id = 0, last: number | null = null, active = true;
  const finish = (referenceHz: number) => { if (!active) return; active = false; cancelAnimationFrame(id); clearTimeout(deadline); done(referenceHz); };
  const deadline = setTimeout(() => finish(NaN), 3000);
  const intervals: number[] = [];
  const tick = (now: number) => {
    if (!active) return;
    if (last !== null && now > last) intervals.push(now - last);
    last = now;
    if (intervals.length >= 30) {
      // Count / elapsed handles a 60Hz cap on a 100Hz display (20/20/10ms cadence).
      finish(intervals.length * 1000 / intervals.reduce((sum, value) => sum + value, 0)); return;
    }
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => { active = false; cancelAnimationFrame(id); clearTimeout(deadline); };
}
