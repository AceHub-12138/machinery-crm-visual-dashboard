"use client";
import Link from "next/link";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { MotionDirector, type MotionHost } from './MotionDirector';
import type { GsapScene } from './GsapScene';
import type { QualityMode } from './QualityPolicy';
import { calibrateRaf } from './calibrateRaf';
export interface MotionRuntime { settleIdle: () => void; audit: () => { liveScenes: number; liveTimelines: number; rootAnimations: number }; createHost: () => MotionHost; createScene: (orders: number[]) => GsapScene }
const RuntimeContext = createContext<MotionRuntime | null>(null);
export const useMotionRuntime = () => useContext(RuntimeContext);
const Context = createContext<MotionDirector | null>(null);
export const useMotionDirector = () => useContext(Context);
export interface MotionProviderProps { children: ReactNode; dataTime: string; qualityMode?: QualityMode; manualQualityAllowed?: boolean; runtime?: MotionRuntime }
export function MotionProvider({ children, dataTime, runtime, qualityMode = 'baseline', manualQualityAllowed = false }: MotionProviderProps) {
  const [director] = useState(() => {
    return new MotionDirector(runtime?.createHost() ?? {
      request: fn => requestAnimationFrame(fn), cancel: id => cancelAnimationFrame(id),
      now: () => performance.now(), wall: () => Date.now(),
      memory: () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
    }, undefined, { qualityMode, manualQualityAllowed, engineCapHz: runtime ? 60 : null });
  });
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let simulated = false, calibrating = false, calibrated = qualityMode === 'baseline';
    let cancelCalibration: (() => void) | null = null;
    const sync = () => {
      const overlay = document.querySelector('.overlay-root');
      const phase = overlay?.getAttribute('data-phase');
      const voiceActive = simulated || !!phase && phase !== 'off';
      const blocked = document.hidden || media.matches || voiceActive;
      if (blocked && calibrating) { cancelCalibration?.(); calibrating = false; calibrated = false; }
      if (!blocked && !calibrated && !calibrating) {
        calibrating = true;
        director.setEnvironment({ pageVisible: false, reduced: media.matches, voiceActive });
        cancelCalibration = calibrateRaf(reference => {
          calibrating = false; calibrated = true; director.setCalibration(reference);
          if (director.qualityMode !== 'baseline') director.attachRecalibration(calibrateRaf);
          sync();
        });
      }
      director.setEnvironment({ pageVisible: !document.hidden && !calibrating, reduced: media.matches, voiceActive });
    };
    // Read the existing presentation state, without modifying or depending on voice internals.
    const observer = new MutationObserver(mutations => {
      if (mutations.some(m => m.type === 'childList' && [...m.addedNodes, ...m.removedNodes].some(n => n instanceof Element && (n.matches('.overlay-root') || n.querySelector('.overlay-root'))) || m.type === 'attributes' && (m.target as Element).matches('.overlay-root'))) sync();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase'] });
    const simulate = (e: Event) => { simulated = (e as CustomEvent<boolean>).detail; sync(); };
    const recalibrate = () => {
      if (director.qualityMode === 'baseline') return;
      if (calibrated) { director.requestRecalibration(); return; }
      // Preserve the existing first-start calibration path, including pre-start resize.
      cancelCalibration?.(); calibrating = false; calibrated = false; sync();
    };
    window.addEventListener('resize', recalibrate);
    window.addEventListener('nexus-quality-recalibrate', recalibrate);
    screen.orientation?.addEventListener('change', recalibrate);
    document.addEventListener('visibilitychange', sync); media.addEventListener('change', sync);
    window.addEventListener('nexus-debug-voice', simulate);
    director.start(); sync();
    return () => { cancelCalibration?.(); window.removeEventListener('resize', recalibrate); window.removeEventListener('nexus-quality-recalibrate', recalibrate); screen.orientation?.removeEventListener('change', recalibrate); observer.disconnect(); document.removeEventListener('visibilitychange', sync); media.removeEventListener('change', sync); window.removeEventListener('nexus-debug-voice', simulate); director.dispose(); };
  }, [director, qualityMode]);
  return <RuntimeContext.Provider value={runtime ?? null}><Context.Provider value={director}>{children}<MotionDebug director={director} dataTime={dataTime}/></Context.Provider></RuntimeContext.Provider>;
}
function MotionDebug({ director, dataTime }: { director: MotionDirector; dataTime: string }) {
  useSyncExternalStore(director.subscribe, director.getSnapshot, () => 0);
  const debug = useSyncExternalStore(() => () => {}, () => new URLSearchParams(window.location.search).get('debug') === '1', () => false);
  const f = director.frame;
  const runtime = useMotionRuntime();
  if (!debug) return null;
  return <aside className="nexus-motion-debug" aria-label="动效调试" data-state={f.state} data-level={f.motionLevel} data-paused={director.paused} data-clock={f.time} data-pulse-due-in={director.pulseDueIn} data-quality-automation={director.qualityMode} data-quality-state={director.qualityDecision?.state ?? 'normal'} data-quality-target={director.qualityTargetHz} data-recalibration={director.recalibration?.snapshot.state ?? 'idle'}>
    <p>状态 {f.state} · 共振 {(f.pulse * 100).toFixed(0)}%</p><p>FPS {f.fps.toFixed(1)} · 档位 {f.motionLevel} · 显著 {f.significant}/8</p>
    <p>页面 {String(f.pageVisible)} · 小川 {String(f.voiceActive)}</p><p>数据时间 {dataTime}</p>
    <p data-motion-engine>{runtime ? "GSAP" : "Legacy"}</p>
    <Link href={engineUrl("legacy")}>切换 Legacy</Link>{" · "}<Link href={engineUrl("gsap")}>切换 GSAP</Link>
    <Link href={baselineUrl()}>回到 Baseline</Link>
    <button onClick={() => director.restartIntro()}>重启入场</button>
    <button onClick={() => director.triggerPulse()}>触发共振</button><button onClick={() => director.cancelPulse()}>取消共振</button>
    <button disabled={!director.manualQualityAllowed || director.qualityMode === 'candidate'} onClick={() => director.forceLow(true)}>强制低档</button><button disabled={!director.manualQualityAllowed || director.qualityMode === 'candidate'} onClick={() => director.forceLow(false)}>恢复自动档</button>
    <button onClick={() => window.dispatchEvent(new CustomEvent('nexus-debug-voice', { detail: !f.voiceActive }))}>模拟小川{f.voiceActive ? '退出' : '唤醒'}</button>
    <button onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(director.records, null, 2)], { type: 'application/json' })); a.download = 'nexus-performance.json'; a.click(); URL.revokeObjectURL(a.href); }}>导出性能日志</button>
    {director.qualityMode !== 'baseline' && <button onClick={() => window.dispatchEvent(new Event('nexus-quality-recalibrate'))}>重新校准刷新率</button>}
    <output hidden data-quality-log>{JSON.stringify(director.qualityRecords)}</output>
    <output hidden data-recalibration-log>{JSON.stringify(director.recalibration?.records ?? [])}</output>
    <output hidden data-gsap-audit>{JSON.stringify(runtime?.audit() ?? null)}</output>
    <output hidden data-performance-log>{JSON.stringify(director.records)}</output>
  </aside>;
}

function engineUrl(engine: string) { const url = new URL(window.location.href); url.searchParams.set("motion", engine); return url.pathname + url.search; }

function baselineUrl() { const url = new URL(window.location.href); url.searchParams.delete("qualityExperiment"); return url.pathname + url.search; }
