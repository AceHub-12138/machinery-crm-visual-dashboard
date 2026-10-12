"use client";

import { FitText } from "@/components/screen/FitText";
import { AnimatedNumber } from "@/components/screen/AnimatedNumber";
import { Panel, PanelHead } from "@/components/screen/Panel";
import { DATA_PENDING, formatPercent, hasNegativeMetric, formatCount, formatMoney } from "@/lib/format";
import type { PublicSalesScreenPayload } from "@/lib/voice/public-payload";
import type { CrmDashboardStats } from "@/lib/types";

/** 等宽刻度条 —— 比连续渐变条更像仪表，也更符合工业语境。 */
function Gauge({
  ratio,
  tone = "brand",
  slots = 20,
  className = "",
}: {
  ratio: number;
  tone?: "brand" | "collect" | "overdue";
  slots?: number;
  className?: string;
}) {
  const filled = Math.max(0, Math.min(slots, Math.round(ratio * slots)));
  const cls = tone === "collect" ? "on-collect" : tone === "overdue" ? "on-overdue" : "on-brand";
  return (
    <div className={`gauge ${className}`} aria-hidden="true">
      {Array.from({ length: slots }, (_, index) => (
        <span className={index < filled ? cls : undefined} key={index} />
      ))}
    </div>
  );
}

function MiniStat({
  label,
  value,
  format,
  hint,
  tone = "neutral",
  money = false,
}: {
  label: string;
  value: number;
  format: (value: number) => string;
  hint: string;
  tone?: "neutral" | "brand" | "collect" | "partial" | "overdue";
  /** 金额类读数：不折行，字号降一档。 */
  money?: boolean;
}) {
  const toneClass = {
    neutral: "text-[var(--ink)]",
    brand: "text-[var(--brand-orange-hot)]",
    collect: "text-[var(--c-collect)]",
    partial: "text-[var(--c-pending)]",
    overdue: "text-[var(--c-overdue)]",
  }[tone];

  return (
    <article className="metric-tile flex flex-col justify-between px-3.5 py-3">
      <p className="text-micro leading-none text-[var(--ink-3)]">{label}</p>
      {/* money：金额不许折行，字号比小整数降一档 —— 28px 的
          「¥2,072.0万」在 158px 的卡片里放不下，硬撑只会断成两行。 */}
      <p className={`num mt-2.5 leading-none ${toneClass} ${value < 0 || money ? "money text-label" : "text-metric"}`}>
        <FitText text={format(value)} min={value < 0 || money ? 18 : 20} max={value < 0 || money ? "var(--fs-label)" : "var(--fs-metric)"}><AnimatedNumber value={value} format={format} /></FitText>
      </p>
      <p className="mt-2 text-micro leading-none text-[var(--ink-3)]">{hint}</p>
    </article>
  );
}

export function KpiRail({
  stats,
  targetAmount,
  collection,
}: {
  stats: CrmDashboardStats;
  targetAmount: number;
  collection?: PublicSalesScreenPayload["collection"];
}) {
  const targetConfigured = collection?.targetConfigured ?? targetAmount > 0;
  const targetRatio = (collection?.targetVisualRate ?? 0) / 100;

  const collectionInvalid = hasNegativeMetric(collection?.collectionRate ?? 0, collection?.totalContractAmount ?? stats.totalContractAmount, collection?.totalPaidAmount ?? stats.totalPaidAmount, collection?.totalUnpaidAmount ?? stats.totalUnpaidAmount);
  const targetInvalid = hasNegativeMetric(targetAmount, stats.periodContractAmount, collection?.targetRate ?? 0);
  return (
    <Panel className="flex h-full flex-col">
      <PanelHead
        eyebrow="Sales KPI"
        title="经营指标"
        extra={
          <p className={`num leading-none text-[var(--c-collect)] ${collectionInvalid ? "text-micro flex flex-col gap-1" : "text-label"}`}>
            {collectionInvalid ? DATA_PENDING : collection ? formatPercent(collection.collectionRate) : "—"}
            <span className={`text-micro font-normal text-[var(--ink-3)] ${collectionInvalid ? "" : "ml-1.5"}`}>累计回款率</span>
          </p>
        }
      />

      {/* 间距 10px / 内边距 16px：这两处是实测出来的 —— 12/18 的组合会让内容
          比可用高度多出 8px，面板底部被裁掉一条。字号不动，只收紧间距。 */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-4">
        {/* 主指标：本期合同额 + 目标达成 */}
        <article className="kpi-primary relative min-h-0 shrink-0 overflow-hidden px-4 pt-3.5 pb-4">
          <div className="pointer-events-none absolute -top-10 -right-8 size-32 rounded-full bg-[rgba(238,125,44,0.11)] blur-2xl" />
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-label font-bold text-[var(--ink)]">本期合同额</p>
            <p className="num text-micro text-[var(--ink-2)]">
              {formatCount(stats.periodNewContracts)} 份新签
            </p>
          </div>
          <p className={`num kpi-hero money mt-2.5 ${stats.periodContractAmount < 0 ? "text-label" : "text-hero-lg"} leading-none`}>
            <FitText text={formatMoney(stats.periodContractAmount)} min={stats.periodContractAmount < 0 ? 18 : 44} max={stats.periodContractAmount < 0 ? "var(--fs-label)" : "var(--fs-hero-lg)"}><AnimatedNumber value={stats.periodContractAmount} format={formatMoney} /></FitText>
          </p>
          {targetInvalid ? <p className="mt-4 text-micro">{DATA_PENDING}</p> : targetConfigured && targetAmount > 0 ? <div className="mt-4">
            <Gauge ratio={targetRatio} slots={22} />
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-micro text-[var(--ink-3)]">
                月度目标 {formatMoney(targetAmount)}
              </span>
              <span className="num text-label leading-none text-[var(--brand-orange-hot)]">
                达成 {formatPercent(collection?.targetRate ?? 0, 1, true)}
              </span>
            </div>
          </div> : <p className="mt-4 text-micro text-[var(--ink-3)]">{targetConfigured ? "目标为 0" : "目标未设置"}</p>}
        </article>

        {/* 本期实收与新合同欠款分别展示 */}
        <article className="kpi-settlement shrink-0 px-4 py-2.5">
          <div className="flex items-baseline justify-between">
            <p className="text-micro text-[var(--ink-3)]">本期实际回款</p>
            <p className="num text-label leading-none text-[var(--c-collect)]">
              {formatMoney(stats.periodPaidAmount)}
            </p>
          </div>
          <div className="mt-2.5 flex justify-between text-micro">
            <span className="text-[var(--ink-3)]">本期新合同欠款</span>
            <span className="text-[var(--brand-orange-hot)]">{formatMoney(stats.periodUnpaidAmount)}</span>
          </div>
        </article>

        {/* 4 宫格 */}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2.5">
          <MiniStat label="客户总数" value={stats.totalCustomers} format={formatCount} hint={`新增 ${formatCount(stats.periodNewCustomers)}`} />
          <MiniStat label="本期发货" value={stats.periodShipments} format={formatCount} hint={`待发 ${formatCount(stats.sevenDayShipmentDue)}`} tone="collect" />
          <MiniStat label="未回款" value={stats.totalUnpaidAmount} format={formatMoney} hint={`${formatCount(stats.unpaidContracts)} 份未付`} tone="brand" money />
          <MiniStat label="部分回款" value={stats.partialPaidContracts} format={formatCount} hint="累计有效合同" tone="partial" />
        </div>

        {/* 待处理预警：一格一数 */}
        <div className="attention-strip grid shrink-0 grid-cols-3">
          <div className="attention-cell px-2 py-3 text-center">
            <p className="text-micro leading-none text-[rgba(232,163,61,0.85)]">今日跟进</p>
            <p className="num mt-2.5 text-metric leading-none text-[var(--c-pending)]">
              {formatCount(stats.todayFollowUp)}
            </p>
          </div>
          <div className="attention-cell attention-cell-risk px-2 py-3 text-center">
            <p className="text-micro leading-none text-[rgba(242,85,90,0.85)]">逾期跟进</p>
            <p className="num mt-2.5 text-metric leading-none text-[var(--c-overdue)]">
              {formatCount(stats.overdueFollowUp)}
            </p>
          </div>
          <div className="attention-cell attention-cell-risk px-2 py-3 text-center">
            <p className="text-micro leading-none text-[rgba(242,85,90,0.85)]">逾期发货</p>
            <p className="num mt-2.5 text-metric leading-none text-[var(--c-overdue)]">
              {formatCount(stats.overdueShipmentDue)}
            </p>
          </div>
        </div>

        {/* 「客户新增占比」原来放在这里，实测本面板内容 670px 而可用只有 576px，
            正好差这一块（86px）。与其把字号压小，不如挪到中列有富余的
            「合同与回款」面板里。 */}
      </div>
    </Panel>
  );
}
