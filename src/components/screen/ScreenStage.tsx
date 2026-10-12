"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DeliveryMilestones } from "@/components/screen/DeliveryMilestones";
import { HeaderBar } from "@/components/screen/HeaderBar";
import { KpiRail } from "@/components/screen/KpiRail";
import { ReminderRail } from "@/components/screen/ReminderRail";
import { ShipmentMap } from "@/components/screen/ShipmentMap";
import { TargetRing } from "@/components/screen/TargetRing";
import type { PublicScreenPayload } from "@/lib/public-screen-payload";

export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

/**
 * 大屏外壳。
 *
 * 两条硬性约束：
 * 1. 首屏必须有内容 —— 数据在服务端取好后作为 initialPayload 传入，
 *    客户端不再依赖 useEffect 拉数据（旧版首屏只有一行 loading 文案）。
 * 2. 面板之间绝不允许重叠 —— 右列的三块面板按内容分配高度，
 *    并且每个面板自身 overflow-hidden，任何溢出都会被裁掉而不是压住邻居。
 */
export function ScreenStage({
  initialPayload,
  kiosk: kioskMode,
  initialFit,
}: {
  initialPayload: PublicScreenPayload;
  kiosk: boolean;
  initialFit: boolean;
}) {
  const [payload, setPayload] = useState(initialPayload);
  // kiosk 由服务端从 ?kiosk=1 解析后传入，这里不再用 effect 回读 URL
  const kiosk = kioskMode;
  const scaleToFit = initialFit;

  // 数据轮询：每 60s 刷新一次，失败时保留上一份数据而不是回退到假数据
  const lastGood = useRef(initialPayload);
  useEffect(() => {
    let active = true;
    if (initialPayload.source !== "mock") return;
    const load = async () => {
      try {
        const response = await fetch("/api/screen/crm", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as PublicScreenPayload;
        if (!active) return;
        lastGood.current = body;
        setPayload(body);
      } catch {
        /* 静默保留上一份数据 */
      }
    };
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [initialPayload.source]);

  useEffect(() => {
    const stage = document.getElementById("screen-stage");
    if (!stage) return;

    const apply = () => {
      const scale = scaleToFit ? Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT) : 1;
      stage.style.setProperty("--stage-scale", String(scale));
      stage.style.transform = `scale(${scale})`;
      stage.style.transformOrigin = "top left";
      const frame = stage.parentElement;
      if (frame) {
        frame.style.width = `${STAGE_WIDTH * scale}px`;
        frame.style.height = `${STAGE_HEIGHT * scale}px`;
      }
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [scaleToFit]);

  useEffect(() => {
    document.documentElement.classList.toggle("kiosk-mode", kiosk);
    return () => document.documentElement.classList.remove("kiosk-mode");
  }, [kiosk]);

  const periodLabel = useMemo(() => {
    const { startDate, endDate, preset } = payload.dashboard.range;
    if (preset === "month") return payload.salesTargets.period.label;
    return `${startDate} ~ ${endDate}`;
  }, [payload]);

  const targetAmount = payload.business ? Number(payload.business.collection.targetAmount) : Number(
    payload.salesTargets.targets.find((item) => item.salesUserId === null)?.amount || 0,
  );

  return (
    <div className="screen-shell">
      <div className="screen-frame">
        <main id="screen-stage" className="screen-stage flex flex-col">
          <HeaderBar periodLabel={periodLabel} isSample={payload.source === "mock"} />

          {/* 行区 964px，减掉 1 个 14px 行间隙后 950 分给两行：838 / 112。
              底条从 84 提到 112（+28）：18/20px 的字号标尺落地后原来那一版
              只能塞下一行半，第三行「区域」标签被压住。
              列宽由各面板内容的**实测最小宽度**决定：
                · 经营指标 360 —— KPI 标签刚好不换行
                · 地图 880 —— 面板越宽陆地越大（画布视口按这个宽度反推，
                  见 globals.css 的 .map-svg；改列宽要同步改那里的
                  width/height）
                · 累计回款率 + 发货提醒 624（吃掉剩余）
              右列内部再分两行，上下各一块；三列等高由栅格保证。
              ⚠️ 每个格子都显式写 col-start / row-start。改用自动排列时，
              row-span 的格子会把自动指针推到不存在的行，后面的面板直接掉出画面
              （这个坑踩过一次）。
              任何面板内容变化后都要重新实测，见 docs/screen-design-spec.md。 */}
          <div className="grid min-h-0 flex-1 grid-cols-[360px_880px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_112px] gap-[var(--gutter)] p-[var(--gutter)]">
            <div data-screen-panel="kpi" className="col-start-1 row-start-1 min-h-0">
              <KpiRail stats={payload.dashboard.stats} targetAmount={targetAmount} collection={payload.business?.collection} />
            </div>

            <div data-screen-panel="map" className="map-panel col-start-2 row-start-1 min-h-0 overflow-hidden rounded-[var(--radius)]">
              <ShipmentMap payload={payload} />
            </div>

            {/* 右列按信息层级分配：合同与回款 441px，交付预警吃掉余下 383px。
                上区需要容纳环、两组金额与合同结构；下区需要容纳三组交付风险。
                不做 1:1 平分，避免上区拥挤、下区留白。 */}
            <div className="col-start-3 row-start-1 grid min-h-0 grid-rows-[441px_minmax(0,1fr)] gap-[var(--gutter)]">
              <div data-screen-panel="collection" className="min-h-0">
                <TargetRing
                  collection={payload.business?.collection}
                  targets={payload.salesTargets}
                  periodLabel={payload.salesTargets.period.label}
                  stats={payload.dashboard.stats}
                />
              </div>
              <div data-screen-panel="reminders" className="min-h-0">
                <ReminderRail
                  stats={payload.dashboard.stats}
                  reminders={payload.dashboard.shipmentReminders}
                />
              </div>
            </div>

            <div data-screen-panel="delivery" className="col-span-3 col-start-1 row-start-2 min-h-0">
              <DeliveryMilestones paths={payload.dashboard.shipmentPaths} delivery={payload.business?.delivery} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
