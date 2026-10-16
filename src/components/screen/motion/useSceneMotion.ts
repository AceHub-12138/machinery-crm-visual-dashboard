"use client";
import { useCallback, useEffect, useRef } from 'react';
import type { PublicScreenPayload } from '@/lib/public-screen-payload';
import { latestRoutes } from '@/lib/feed-mask';
import { useMotionDirector, useMotionRuntime } from './MotionProvider';
import { motionConfig as c } from './config';
import { linkTarget } from '@/lib/screen-map-routes';
const between = (range: readonly [number, number]) => range[0] + Math.random() * (range[1] - range[0]);
const wave = (time: number, cycle: number) => (1 - Math.cos(time / cycle * Math.PI * 2)) / 2;
const smooth = (n: number) => { const x = Math.max(0, Math.min(1, n)); return x * x * (3 - 2 * x); };
const attr = (node: Element | null, key: string, value: number | string) => { const text = String(value); if (node?.getAttribute(key) !== text) node?.setAttribute(key, text); };
export function useSceneMotion(payload: PublicScreenPayload, onSelect: (key: string | null) => void) {
  const director = useMotionDirector();
  const runtime = useMotionRuntime();
  const schedule = useRef<{ nextRoute: number; nextFocus: number; nextSweep: number; sweepStart: number; focusIndex: number; flights: { key: string; start: number }[] } | null>(null);
  const select = useCallback((key: string) => { director?.setSelection(key); onSelect(key); }, [director, onSelect]);
  useEffect(() => {
    const root = document.getElementById('screen-stage');
    if (!root || !director) return;
    const canvas = root.querySelector<HTMLCanvasElement>('.nexus-particles')!;
    const ctx = canvas?.getContext('2d');
    const width = root.clientWidth, height = root.clientHeight;
    if (canvas) { canvas.width = width; canvas.height = height; }
    const particles = Array.from({ length: c.particles }, (_, i) => ({ x: Math.random() * width, y: Math.random() * height, size: i % 5 === 0 ? 2 : 1, speed: .4 + Math.random() * .6, phase: Math.random() * c.originCycle }));
    const svg = root.querySelector<SVGSVGElement>('.nexus-map-layer-0');
    const scale = svg ? svg.clientWidth / svg.viewBox.baseVal.width : 1;
    const routes = [...root.querySelectorAll<SVGGElement>('.nexus-map-layer-0 [data-city-key]')].map(group => {
      const baseline = group.querySelector<SVGPathElement>('[data-route-baseline]')!;
      const length = baseline.getTotalLength();
      const points = Array.from({ length: 101 }, (_, i) => baseline.getPointAtLength(length * i / 100));
      return { key: group.dataset.cityKey!, routeKeys: group.dataset.routeKeys!.split(' '), order: Number(group.dataset.routeOrder), pulseRipple: group.dataset.pulseRipple === 'true', group, light: group.querySelector<SVGPathElement>('.nexus-route-light')!, traveler: group.querySelector<SVGCircleElement>('.nexus-route-traveler')!, glow: group.querySelector<SVGCircleElement>('.nexus-route-glow')!, tail: group.querySelector<SVGImageElement>('.nexus-route-tail')!, dot: group.querySelector<SVGCircleElement>('.nexus-city-dot')!, city: group.querySelector<SVGCircleElement>('.nexus-city-active')!, ripple: group.querySelector<SVGCircleElement>('.nexus-city-ripple')!, length, points };
    });
    const gsapScene = runtime?.createScene(routes.map(r => r.order));
    root.dataset.motionEngine = gsapScene ? "gsap" : "legacy";
    root.dataset.gsapTimelines = String(gsapScene?.timelineCount ?? 0);
    const factoryGlow = root.querySelector<SVGCircleElement>('.nexus-factory-glow');
    const origin = root.querySelector<SVGCircleElement>('.nexus-origin-breath');
    const localKeys = (origin?.dataset.localRouteKeys ?? '').split(' ').filter(Boolean);
    const ticks = root.querySelector<SVGGElement>('.nexus-dial-ticks');
    const overdue = root.querySelector<HTMLElement>('.nexus-overdue[data-active="true"]');
    const sweep = root.querySelector<HTMLElement>('.nexus-ruler-sweep');
    const rows = latestRoutes(payload.business?.delivery.routes ?? []);
    const epoch = director.frame.time;
    let nextRoute = schedule.current?.nextRoute ?? epoch + between(c.routeInterval), nextFocus = schedule.current?.nextFocus ?? epoch + between(c.focusInterval), nextSweep = schedule.current?.nextSweep ?? epoch + between(c.rulerInterval);
    let sweepStart = schedule.current?.sweepStart ?? -Infinity, focusIndex = schedule.current?.focusIndex ?? -1, previousSelectionAt = director.selectionAt;
    let flights = schedule.current?.flights.filter(f => routes.some(r => r.key === f.key)) ?? [];
    let wasPaused = false, wasPulse = false, resetUntil = -Infinity;
    const reset = (time: number) => { flights = []; sweepStart = -Infinity; nextRoute = time + between(c.routeInterval); nextFocus = time + between(c.focusInterval); nextSweep = time + between(c.rulerInterval); director.setSelection(null); onSelect(null); };
    const unregister = director.register('scene', frame => {
      const { time, state, pulse, motionLevel } = frame;
      const paused = !frame.pageVisible || frame.voiceActive || motionLevel === 'static';
      const isPulse = state === 'PULSE', seconds = pulse * 10;
      const numericCount = new Set([...root.querySelectorAll('[data-motion-number-active="true"]')].map(node => node.closest('[data-screen-panel]'))).size;
      if (numericCount) flights = [];
      root.dataset.motionState = state; root.dataset.motionLevel = motionLevel; root.dataset.motionPaused = String(paused);
      root.dataset.motionTime = String(time); root.dataset.motionPulse = String(pulse);
      if (wasPulse && !isPulse) resetUntil = time + c.reset;
      root.dataset.motionReset = String(paused || time < resetUntil);
      if (paused !== wasPaused || wasPulse && !isPulse) reset(time);
      wasPaused = paused; wasPulse = isPulse;
      // One director cue owns the whole 10s resonance: 0–1.5 map + origin, 1.5–3 routes near→far,
      // 3–6.5 all routes full with top-city ripples, 6.5–10 smooth return.
      const pulsing = isPulse && !paused;
      const gsapPulse = gsapScene?.samplePulse(pulsing ? seconds : 0);
      const decay = gsapPulse?.decay ?? (seconds < c.pulseHoldEnd ? 1 : 1 - smooth((seconds - c.pulseHoldEnd) / (10 - c.pulseHoldEnd)));
      const intensity = pulsing ? (gsapPulse?.rise ?? smooth(seconds / c.pulseMapRise)) * decay : 0;
      root.style.setProperty('--pulse-top', String(intensity * .75));
      root.style.setProperty('--pulse-base', String(intensity * .6));
      root.style.setProperty('--pulse-map', String(intensity * .15));
      attr(factoryGlow, 'r', (48 + intensity * 12) / scale);
      const intro = gsapScene?.sampleIntro(state === 'INTRO' ? director.introTime : c.intro);
      for (const [name, start] of [['background', 0], ['map', 300], ['panels', 900], ['feed', 1500]] as const) root.style.setProperty(`--intro-${name}`, String(state === 'INTRO' ? (intro?.[name] ?? smooth((director.introTime - start) / 600)) : 1));
      if (!paused && !isPulse) {
        if (!numericCount && time >= nextRoute && routes.length) {
          const first = Math.floor(Math.random() * routes.length), count = motionLevel === 'low' ? 1 : Math.min(routes.length, 1 + Math.round(Math.random()));
          flights = Array.from({ length: count }, (_, i) => ({ key: routes[(first + i) % routes.length].key, start: time })); nextRoute = time + between(c.routeInterval);
        }
        if (time >= nextFocus && rows.length) { focusIndex = (focusIndex + 1) % rows.length; director.setSelection(rows[focusIndex].key); onSelect(rows[focusIndex].key); nextFocus = time + between(c.focusInterval); }
        if (sweep && time >= nextSweep) { sweepStart = time; nextSweep = time + between(c.rulerInterval); }
      }
      if (previousSelectionAt !== director.selectionAt) { previousSelectionAt = director.selectionAt; nextFocus = time + between(c.focusInterval); }
      if (motionLevel === 'low') flights = flights.slice(0, 1);
      flights = flights.filter(f => time - f.start < c.routeTravel + c.arrival);
      const selected = !paused && !isPulse && time - director.selectionAt < c.focusHighlight ? director.selectedKey : null;
      const linked = selected === null ? null : linkTarget(routes, localKeys, selected);
      const focus = linked === 'origin' || linked === null ? null : linked;
      const localFocus = linked === 'origin';
      let significant = numericCount + (isPulse ? 1 : flights.length + ((focus || localFocus) ? 1 : 0));
      for (const [routeIndex, route] of routes.entries()) {
        const flight = !paused && !isPulse ? flights.find(f => f.key === route.key) : undefined;
        const elapsed = flight ? time - flight.start : 0;
        const gsapRoute = gsapScene?.sampleRoute(routeIndex, pulsing ? seconds : 0, elapsed);
        const travel = flight ? (gsapRoute?.travel ?? Math.min(1, elapsed / c.routeTravel)) : 0;
        const moving = !!flight && elapsed < c.routeTravel;
        const arrival = flight && elapsed >= c.routeTravel ? (gsapRoute?.arrival ?? (elapsed - c.routeTravel) / c.arrival) : -1;
        const focused = route.key === focus, focusProgress = focused ? (time - director.selectionAt) / c.focusHighlight : 0;
        const lightStart = c.pulseMapRise + route.order * (c.pulseRoutesFull - c.pulseMapRise - c.pulseRouteRamp);
        const routeIntensity = pulsing && seconds >= lightStart ? (gsapRoute?.intensity ?? smooth((seconds - lightStart) / c.pulseRouteRamp)) * decay : 0;
        route.group.dataset.routeBright = String(routeIntensity > 0 || focused || !!flight);
        attr(route.light, 'opacity', routeIntensity || (focused ? .7 : flight ? .35 : 0));
        attr(route.traveler, 'opacity', moving ? 1 : 0); attr(route.glow, 'opacity', moving ? 1 : 0); attr(route.tail, 'opacity', moving ? 1 : 0);
        if (moving) {
          const position = travel * 100, index = Math.min(99, Math.floor(position)), mix = position - index;
          const a = route.points[index], b = route.points[index + 1], x = a.x + (b.x - a.x) * mix, y = a.y + (b.y - a.y) * mix;
          for (const node of [route.traveler, route.glow]) { attr(node, 'cx', x); attr(node, 'cy', y); }
          attr(route.tail, 'transform', `translate(${x} ${y}) rotate(${Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI}) translate(${-60 / scale} ${-8 / scale})`);
        }
        const arriving = arrival >= 0 && arrival < 1;
        // Only the top unit cities ripple during the resonance; the rest brighten their dot without a ring.
        const pulseRipple = pulsing && route.pulseRipple && seconds >= c.pulseRoutesFull && seconds < c.pulseHoldEnd ? (gsapRoute?.ripple === 1 ? 0 : gsapRoute?.ripple) ?? (seconds - c.pulseRoutesFull) / c.pulseRippleCycle % 1 : -1;
        const rippleProgress = pulseRipple >= 0 ? pulseRipple : focused ? focusProgress : Math.max(0, arrival);
        const rippleAlpha = pulsing ? pulseRipple >= 0 ? .95 * (1 - pulseRipple) : 0 : arriving ? (1 - arrival) * .7 : focused ? (1 - focusProgress) * .7 : 0;
        attr(route.ripple, 'opacity', rippleAlpha); attr(route.ripple, 'r', (8 + rippleProgress * 16) / scale);
        attr(route.dot, 'r', Number(route.dot.dataset.normalRadius) * (focused ? 1.6 : 1));
        attr(route.city, 'opacity', pulsing ? routeIntensity * .95 : focused ? .7 : arriving ? (1 - arrival) * .7 : 0);
        attr(route.city, 'r', (focused ? 12.8 : 8) / scale);
      }
      if (origin) { const breath = gsapScene?.sampleBreath(time) ?? wave(time, c.originCycle); attr(origin, 'r', (paused ? 20 : localFocus ? 36 : 16 + breath * 12 + intensity * 16) / scale); attr(origin, 'opacity', localFocus ? 1 : paused ? .35 : (.35 + breath * .45) * (1 - intensity) + intensity); origin.dataset.originFocus = String(localFocus); if (!paused && !isPulse && !localFocus) significant++; }
      if (ticks) { attr(ticks, 'transform', paused ? '' : `rotate(${time / c.dialCycle * 360 % 360} 120 120)`); if (!paused) significant++; }
      if (overdue) { overdue.style.setProperty('--overdue-alpha', String(paused ? .4 : .4 + wave(time, c.overdueCycle) * .6)); if (!paused) significant++; }
      const scanning = !paused && !numericCount && !isPulse && time - sweepStart < c.rulerSweep;
      if (sweep) { sweep.style.opacity = scanning ? '.35' : '0'; sweep.style.left = `${scanning ? (time - sweepStart) / c.rulerSweep * 100 : 0}%`; if (scanning) significant++; }
      if (ctx) {
        const particlesEnabled = !paused && motionLevel === 'normal' && significant < c.maxSignificant;
        canvas.style.visibility = particlesEnabled ? 'visible' : 'hidden';
        if (particlesEnabled) {
          ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#EE7D2C';
          for (const p of particles) { ctx.globalAlpha = .25 + wave(time + p.phase, c.originCycle) * .35; const distance = (time - epoch) / 1000 * c.particleSpeed * p.speed; ctx.fillRect((p.x + distance * .3) % width, (p.y - distance % height + height) % height, p.size, p.size); }
          significant++;
        }
      }
      frame.significant = paused ? 0 : significant; root.dataset.motionSignificant = String(frame.significant);
      if (paused) runtime?.sleep();
      schedule.current = { nextRoute, nextFocus, nextSweep, sweepStart, focusIndex, flights };
    });
    if (!director.running) runtime?.sleep();
    return () => { unregister(); gsapScene?.dispose(); root.dataset.gsapTimelines = "0"; ctx?.clearRect(0, 0, width, height); };
  }, [director, onSelect, payload, runtime]);
  return select;
}
