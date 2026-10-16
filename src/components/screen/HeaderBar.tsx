"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { formatClock } from "@/lib/format";

/**
 * 每秒变化的时间源。
 *
 * 用 useSyncExternalStore 而不是「useEffect + setState」：后者会在 effect 里
 * 同步触发一次渲染，React 19 会判为级联渲染；而且服务端首帧未订阅时钟，
 * getServerSnapshot 返回 0 让首帧渲染成占位符，hydration 也不会不匹配。
 */
export function useClock() {
  const listeners = useRef(new Set<() => void>());
  const snapshot = useRef(0);
  const timer = useRef<number | null>(null);

  const subscribe = useCallback((onChange: () => void) => {
    listeners.current.add(onChange);
    if (timer.current === null) {
      snapshot.current = Date.now();
      timer.current = window.setInterval(() => {
        snapshot.current = Date.now();
        listeners.current.forEach((fn) => fn());
      }, 1000);
    }
    return () => {
      listeners.current.delete(onChange);
      if (listeners.current.size === 0 && timer.current !== null) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, []);

  const getSnapshot = useCallback(() => snapshot.current, []);
  // 0 = 服务端/首帧，尚未订阅时钟
  const getServerSnapshot = useCallback(() => 0, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function HeaderBar({ periodLabel, demoMode = false, displayNotice = false, freshnessLabel = "" }: {
  periodLabel: string; demoMode?: boolean; displayNotice?: boolean; freshnessLabel?: string;
}) {
  const epoch = useClock();
  return <header className="nexus-header">
    <div className="nexus-brand">
      {/* Static local brand asset; original pixels remain available for LED output. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo-light.png" alt="大川机床 DACHUAN MACHINE" />
      <div className="nexus-brand-heading"><h1>销售经营中心</h1><p className="nexus-period">统计周期：{periodLabel.replace(/(\d{4})年(\d{1,2})月/, "$1 年 $2 月")}</p></div>
    </div>
    <div className="nexus-header-right">
      <p className="nexus-slogan">数据驱动 · 精密运营 · 客户成长 · 大川智造</p>
      <div className="nexus-clock-row">
        <span className="nexus-standby">◉ 小川 · STANDBY</span>
        {freshnessLabel ? <span className="nexus-freshness" role="status">{freshnessLabel}</span> : null}
        {demoMode ? <span className="nexus-notice">{displayNotice ? "展厅演示数据" : "演示数据"}</span> : null}
        <time>{epoch ? formatClock(new Date(epoch)) : "--:--:--"}</time>
      </div>
    </div>
  </header>;
}
