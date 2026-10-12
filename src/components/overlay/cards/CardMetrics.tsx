"use client";
import { FitText } from "@/components/screen/FitText";
import { displayRate } from "@/lib/voice/card-presentation";

import type { AnswerCardData } from "@/lib/voice/session-machine";
import { clamp01 } from "@/lib/voice/params";

/** Shared ring for completion and collection; label retains an over-target rate. */
export function MetricRing({ rate, label }: { rate: number; label: string }) {
  const length = 2 * Math.PI * 64;
  return <div className="overlay-ring-wrap">
    <svg className="overlay-ring" viewBox="0 0 160 160" role="img" aria-label={`${label} ${rate}%`}>
      <circle className="overlay-ring-ticks" cx="80" cy="80" r="76" />
      <circle className="overlay-ring-track" cx="80" cy="80" r="64" />
      <circle className="overlay-ring-fill" cx="80" cy="80" r="64" transform="rotate(-90 80 80)"
        style={{ strokeDasharray: length, strokeDashoffset: length * (1 - clamp01(rate / 100)) }} />
    </svg>
    <div className="overlay-ring-value"><strong>{displayRate(rate)}</strong><span>{label}</span></div>
  </div>;
}

export function Metric({ label, value, unit, accent = false }: { label: string; value: string | number; unit?: string; accent?: boolean }) {
  return <div className={`overlay-metric${accent ? " is-accent" : ""}`}>
    <span className="overlay-metric-label">{label}</span>
    <p className="overlay-metric-number num-unit"><strong><FitText text={String(value)} min={28} max={typeof value === "number" ? "var(--ov-fs-metric)" : "var(--ov-fs-money)"}>{value}</FitText></strong>{unit ? <em>{unit}</em> : null}</p>
  </div>;
}

export function CustomerKpiCard({ card }: { card: Extract<AnswerCardData, { kind: "customer-kpi" }> }) {
  return <div className="overlay-metric-grid is-two"><Metric label="本期新增客户" value={card.newCustomers} unit="家" accent /><Metric label="客户总数" value={card.totalCustomers} unit="家" /></div>;
}

export function FollowupBucketsCard({ card }: { card: Extract<AnswerCardData, { kind: "followup-buckets" }> }) {
  return <div className="overlay-metric-grid"><Metric label="今日待跟进" value={card.today} unit="项" /><Metric label="七日内待跟进" value={card.sevenDays} unit="项" /><Metric label="逾期跟进" value={card.overdue} unit="项" accent={card.overdue > 0} /></div>;
}

export function CollectionSplitCard({ card }: { card: Extract<AnswerCardData, { kind: "collection-split" }> }) {
  return <div className="overlay-collection-block">
    <MetricRing rate={card.ratePercent} label="累计回款率" />
    <div className="overlay-collection-meta"><Metric label="已回款" value={card.paidText} accent /><Metric label="未回款" value={card.unpaidText} />
      <div className="overlay-card-bar overlay-collection-bar" role="img" aria-label={`已回款占比 ${card.ratePercent}%`}><span style={{ width: `${clamp01(card.ratePercent / 100) * 100}%` }} /></div>
    </div>
  </div>;
}
