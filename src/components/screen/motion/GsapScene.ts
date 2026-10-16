import { gsap } from 'gsap';
import { motionConfig as c } from './config';
const smooth = (x: number) => x * x * (3 - 2 * x);
const wave = (x: number) => (1 - Math.cos(x * Math.PI * 2)) / 2;
/** Bounded proxy timelines; SVG geometry and the single DOM writer stay shared. */
export class GsapScene {
  static liveScenes = 0;
  static liveTimelines = 0;
  private disposed = false;
  private timelines: gsap.core.Timeline[] = [];
  readonly intro = { background: 0, map: 0, panels: 0, feed: 0 };
  readonly pulse = { rise: 0, decay: 1 };
  readonly breath = { value: 0 };
  readonly routes: { intensity: number; ripple: number; travel: number; arrival: number }[];
  private introTl: gsap.core.Timeline;
  private pulseTl: gsap.core.Timeline;
  private breathTl: gsap.core.Timeline;
  private routeTls: { pulse: gsap.core.Timeline; flight: gsap.core.Timeline }[];
  private timeline() {
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'none', lazy: false } });
    gsap.globalTimeline.remove(tl); this.timelines.push(tl); GsapScene.liveTimelines++; return tl;
  }
  constructor(orders: number[]) {
    GsapScene.liveScenes++;
    this.introTl = this.timeline();
    for (const [name, start] of [['background', 0], ['map', .3], ['panels', .9], ['feed', 1.5]] as const)
      this.introTl.to(this.intro, { [name]: 1, duration: .6, ease: smooth }, start);
    this.pulseTl = this.timeline().to(this.pulse, { rise: 1, duration: c.pulseMapRise, ease: smooth }, 0)
      .to(this.pulse, { decay: 0, duration: 10 - c.pulseHoldEnd, ease: smooth }, c.pulseHoldEnd);
    this.breathTl = this.timeline().to(this.breath, { value: 1, duration: c.originCycle / 1000, ease: wave });
    this.routes = orders.map(() => ({ intensity: 0, ripple: 0, travel: 0, arrival: 0 }));
    this.routeTls = orders.map((order, i) => {
      const proxy = this.routes[i];
      const start = c.pulseMapRise + order * (c.pulseRoutesFull - c.pulseMapRise - c.pulseRouteRamp);
      const pulse = this.timeline().to(proxy, { intensity: 1, duration: c.pulseRouteRamp, ease: smooth }, start)
        .to(proxy, { ripple: 1, duration: c.pulseRippleCycle, repeat: 1 }, c.pulseRoutesFull);
      const flight = this.timeline().to(proxy, { travel: 1, duration: c.routeTravel / 1000 }, 0)
        .to(proxy, { arrival: 1, duration: c.arrival / 1000 }, c.routeTravel / 1000);
      return { pulse, flight };
    });
  }
  sampleIntro(ms: number) { this.introTl.totalTime(Math.max(0, ms) / 1000); return this.intro; }
  samplePulse(seconds: number) { this.pulseTl.totalTime(seconds); return this.pulse; }
  sampleBreath(ms: number) { this.breathTl.totalTime((ms % c.originCycle) / 1000); return this.breath.value; }
  sampleRoute(i: number, seconds: number, elapsed: number) {
    const tl = this.routeTls[i]; tl.pulse.totalTime(seconds); tl.flight.totalTime(elapsed / 1000);
    return this.routes[i];
  }
  get timelineCount() { return this.timelines.length; }
  dispose() { if (this.disposed) return; this.disposed = true; this.timelines.forEach(tl => tl.kill()); GsapScene.liveTimelines -= this.timelines.length; GsapScene.liveScenes--; this.timelines = []; }
}
