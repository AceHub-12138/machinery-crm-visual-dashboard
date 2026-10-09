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
function useClock() {
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

export function HeaderBar({
  periodLabel,
  isSample,
}: {
  periodLabel: string;
  isSample: boolean;
}) {
  const epoch = useClock();
  const now = epoch > 0 ? new Date(epoch) : null;

  return (
    <header className="relative z-10 flex h-[88px] shrink-0 items-center justify-between border-b border-[var(--hairline)] px-7">
      {/* 品牌区 */}
      <div className="flex items-center gap-4">
        <div className="flex size-14 items-center justify-center rounded-[var(--radius)] border border-[var(--panel-border-strong)] bg-[rgba(238,125,44,0.1)]">
          <span className="hud-en text-brand-sm leading-none font-bold tracking-[0.06em] text-[var(--brand-orange)]">
            DC
          </span>
        </div>
        <div>
          <p className="hud-en text-kicker leading-none tracking-[0.34em] text-[var(--ink-3)]">
            DACHUAN · CRM COMMAND
          </p>
          <h1 className="mt-2 text-brand leading-none font-bold tracking-[0.1em] text-[var(--ink)]">
            经营指挥舱
          </h1>
        </div>
      </div>

      {/* 右侧信息区 */}
      <div className="flex items-center gap-7">
        <div className="text-right">
          <p className="text-micro leading-none tracking-[0.2em] text-[var(--ink-3)]">统计周期</p>
          <p className="mt-2 text-label leading-none font-medium text-[var(--ink)]">
            {periodLabel}
          </p>
        </div>

        <span className="h-11 w-px bg-[var(--hairline)]" />

        <div className="text-right">
          <p className="text-micro leading-none tracking-[0.2em] text-[var(--ink-3)]">北京时间</p>
          <p className="hud-en mt-2 text-label leading-none font-semibold text-[var(--ink)]">
            {now ? formatClock(now) : "--:--:--"}
          </p>
        </div>

        <span className="h-11 w-px bg-[var(--hairline)]" />

        {isSample ? (
          <div className="status-pill status-pill-sample flex items-center gap-2.5 px-3.5 py-2">
            <span className="text-micro leading-none tracking-[0.12em] text-[var(--c-pending)]">
              演示数据
            </span>
          </div>
        ) : (
          <div className="status-pill status-pill-live flex items-center gap-2.5 px-3.5 py-2">
            <span className="live-dot" />
            <span className="hud-en text-micro leading-none tracking-[0.16em] text-[var(--c-live)]">
              LIVE
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            const el = document.documentElement;
            if (document.fullscreenElement) void document.exitFullscreen();
            else void el.requestFullscreen?.();
          }}
          className="rounded-[var(--radius)] border border-[var(--hairline)] px-3.5 py-2 text-micro text-[var(--ink-2)] transition-colors duration-[var(--t-fast)] hover:border-[var(--panel-border-strong)] hover:text-[var(--brand-orange)]"
        >
          全屏
        </button>
      </div>
    </header>
  );
}
