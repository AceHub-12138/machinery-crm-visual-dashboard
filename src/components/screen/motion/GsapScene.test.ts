import { describe, it, expect } from 'vitest';
import { gsap } from 'gsap';
import { GsapScene } from './GsapScene';
const smooth = (n: number) => { const x = Math.max(0, Math.min(1, n)); return x * x * (3 - 2 * x); };
describe('GSAP detached scene timeline contract', () => {
  it('matches all legacy intro envelopes, including seeking backwards to restart', () => {
    const scene = new GsapScene([0, .5, 1]);
    for (const time of [0, 100, 300, 550, 900, 1500, 1850, 2200, 0, 300, 2200]) {
      const values = scene.sampleIntro(time);
      for (const [name, start] of [['background', 0], ['map', 300], ['panels', 900], ['feed', 1500]] as const)
        expect(values[name]).toBeCloseTo(smooth((time - start) / 600), 5);
    }
    scene.dispose();
  });
  it('preserves map breathing, near-to-far pulse, ripple, flight and arrival timing', () => {
    const scene = new GsapScene([0, .5, 1]);
    for (const t of [0, .1, 1.4, 2.2, 3.1, 4.5, 5, 6.5, 8, 9.99, 10, 0]) {
      const envelope = scene.samplePulse(t);
      expect(envelope.rise).toBeCloseTo(smooth(t / 1.5), 5);
      expect(envelope.decay).toBeCloseTo(1 - smooth((t - 6.5) / 3.5), 5);
      for (const [i, order] of [0, .5, 1].entries()) {
        const route = scene.sampleRoute(i, t, t * 400);
        expect(route.intensity).toBeCloseTo(smooth((t - 1.5 - order * 1.2) / .3), 5);
        expect(route.travel).toBeCloseTo(Math.min(1, t * 400 / 3000), 5);
        expect(route.arrival).toBeCloseTo(Math.max(0, Math.min(1, (t * 400 - 3000) / 1000)), 5);
        if (t > 3 && t < 6.5) expect(route.ripple).toBeCloseTo((t - 3) / 1.75 % 1, 5);
      }
      expect(scene.sampleBreath(t * 1000)).toBeCloseTo((1 - Math.cos(t / 3 * Math.PI * 2)) / 2, 5);
    }
    scene.dispose();
  });
  it('bounds allocations and detaches every timeline from the automatic root; repeated disposal is safe', () => {
    const before = gsap.globalTimeline.getChildren().length;
    for (let i = 0; i < 30; i++) {
      const scene = new GsapScene([0, .5, 1]);
      expect(scene.timelineCount).toBe(9);
      expect(gsap.globalTimeline.getChildren().length).toBe(before);
      scene.samplePulse(5); scene.dispose(); scene.dispose();
      expect(scene.timelineCount).toBe(0);
    }
    expect(gsap.globalTimeline.getChildren().length).toBe(before);
    gsap.ticker.sleep();
  });
});
