"use client";
import Link from "next/link";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { MotionDirector, type MotionHost } from './MotionDirector';
import type { GsapScene } from './GsapScene';
export interface MotionRuntime { sleep: () => void; audit: () => { liveScenes: number; liveTimelines: number; rootAnimations: number }; createHost: () => MotionHost; createScene: (orders: number[]) => GsapScene }
const RuntimeContext = createContext<MotionRuntime | null>(null);
export const useMotionRuntime = () => useContext(RuntimeContext);
const Context = createContext<MotionDirector | null>(null);
export const useMotionDirector = () => useContext(Context);
export function MotionProvider({ children, dataTime, runtime }: { children: ReactNode; dataTime: string; runtime?: MotionRuntime }) {
  const [director] = useState(() => new MotionDirector(runtime?.createHost() ?? {
    request: fn => requestAnimationFrame(fn), cancel: id => cancelAnimationFrame(id),
    now: () => performance.now(), wall: () => Date.now(),
    memory: () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
  }));
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let simulated = false;
    const sync = () => {
      const overlay = document.querySelector('.overlay-root');
      const phase = overlay?.getAttribute('data-phase');
      director.setEnvironment({ pageVisible: !document.hidden, reduced: media.matches, voiceActive: simulated || !!phase && phase !== 'off' });
    };
    // Read the existing presentation state, without modifying or depending on voice internals.
    const observer = new MutationObserver(mutations => {
      if (mutations.some(m => m.type === 'childList' && [...m.addedNodes, ...m.removedNodes].some(n => n instanceof Element && (n.matches('.overlay-root') || n.querySelector('.overlay-root'))) || m.type === 'attributes' && (m.target as Element).matches('.overlay-root'))) sync();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase'] });
    const simulate = (e: Event) => { simulated = (e as CustomEvent<boolean>).detail; sync(); };
    document.addEventListener('visibilitychange', sync); media.addEventListener('change', sync);
    window.addEventListener('nexus-debug-voice', simulate);
    director.start(); sync();
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', sync); media.removeEventListener('change', sync); window.removeEventListener('nexus-debug-voice', simulate); director.dispose(); };
  }, [director]);
  return <RuntimeContext.Provider value={runtime ?? null}><Context.Provider value={director}>{children}<MotionDebug director={director} dataTime={dataTime}/></Context.Provider></RuntimeContext.Provider>;
}
function MotionDebug({ director, dataTime }: { director: MotionDirector; dataTime: string }) {
  useSyncExternalStore(director.subscribe, director.getSnapshot, () => 0);
  const debug = useSyncExternalStore(() => () => {}, () => new URLSearchParams(window.location.search).get('debug') === '1', () => false);
  const f = director.frame;
  const runtime = useMotionRuntime();
  if (!debug) return null;
  return <aside className="nexus-motion-debug" aria-label="动效调试" data-state={f.state} data-level={f.motionLevel} data-paused={!director.running} data-clock={f.time} data-pulse-due-in={director.pulseDueIn}>
    <p>状态 {f.state} · 共振 {(f.pulse * 100).toFixed(0)}%</p><p>FPS {f.fps.toFixed(1)} · 档位 {f.motionLevel} · 显著 {f.significant}/8</p>
    <p>页面 {String(f.pageVisible)} · 小川 {String(f.voiceActive)}</p><p>数据时间 {dataTime}</p>
    <p data-motion-engine>{runtime ? "GSAP" : "Legacy"}</p>
    <Link href={engineUrl("legacy")}>切换 Legacy</Link>{" · "}<Link href={engineUrl("gsap")}>切换 GSAP</Link>
    <button onClick={() => director.restartIntro()}>重启入场</button>
    <button onClick={() => director.triggerPulse()}>触发共振</button><button onClick={() => director.cancelPulse()}>取消共振</button>
    <button onClick={() => director.forceLow(true)}>强制低档</button><button onClick={() => director.forceLow(false)}>恢复自动档</button>
    <button onClick={() => window.dispatchEvent(new CustomEvent('nexus-debug-voice', { detail: !f.voiceActive }))}>模拟小川{f.voiceActive ? '退出' : '唤醒'}</button>
    <button onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(director.records, null, 2)], { type: 'application/json' })); a.download = 'nexus-performance.json'; a.click(); URL.revokeObjectURL(a.href); }}>导出性能日志</button>
    <output hidden data-gsap-audit>{JSON.stringify(runtime?.audit() ?? null)}</output>
    <output hidden data-performance-log>{JSON.stringify(director.records)}</output>
  </aside>;
}

function engineUrl(engine: string) { const url = new URL(window.location.href); url.searchParams.set("motion", engine); return url.pathname + url.search; }
