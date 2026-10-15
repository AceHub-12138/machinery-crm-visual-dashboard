"use client";
import { useId } from "react";
import { AnimatedNumber } from "./AnimatedNumber";
import { FitText } from "./FitText";
import { formatCount, formatMoney, formatMoneyParts, formatPercent, formatShortDate, hasNegativeMetric } from "@/lib/format";
import { feedCity, latestRoutes } from "@/lib/feed-mask";
import type { PublicSalesScreenPayload } from "@/lib/voice/public-payload";

export function NexusTitle({ children }: { children: React.ReactNode }) { return <h2 className="nexus-title"><span className="nexus-title-square" aria-hidden="true"/>{children}<span aria-hidden="true">›</span></h2>; }
export function NexusMoney({ value, hero = false, max }: { value: string; hero?: boolean; max?: number }) {
  const parts = formatMoneyParts(Number(value));
  const text = formatMoney(Number(value));
  return <FitText measureContent text={text} min={18} max={max ?? (hero ? 72 : 34)} className={`nexus-money ${hero ? "nexus-money-hero" : ""}`}><span className="nexus-money-currency">{parts.currency}</span><span className="nexus-money-number"><AnimatedNumber key={parts.unit} value={Number(value)} format={n => formatMoneyParts(n).number}/></span><span className="nexus-money-unit">{parts.unit}</span></FitText>;
}
export function ContractGauge({ business }: { business: PublicSalesScreenPayload }) {
  const k = business.kpis, c = business.collection;
  const target = c.targetConfigured !== false;
  const invalid = hasNegativeMetric(k.periodContractAmount, c.targetAmount, c.targetRate, c.targetVisualRate, c.exceededAmount);
  const fill = Math.min(100, Math.max(0, c.targetVisualRate));
  return <section className="nexus-panel nexus-contract" data-screen-panel="contract">
    <NexusTitle>本月合同额</NexusTitle><NexusMoney value={k.periodContractAmount} hero max={c.exceeded ? 56 : 72} />
    {target && !invalid ? <div className="nexus-ruler-group"><div className={`nexus-ruler ${c.exceeded ? "is-exceeded" : ""}`} role="meter" aria-label="月度目标达成" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill}>
      <div className="nexus-ruler-fill" style={{ width: `${fill}%` }}>{!c.exceeded && fill > 0 ? <i className="nexus-ruler-knob" /> : null}<span className="nexus-ruler-sweep-track"><i className="nexus-ruler-sweep"/></span></div>{c.exceeded ? <i className="nexus-overrun-triangle" /> : null}
    </div><div className="nexus-ruler-ticks" aria-label="合同目标刻度"><span>0</span><span>{formatMoney(Number(c.targetAmount) / 2)}</span><span>{formatMoney(Number(c.targetAmount))}</span></div></div> : !target ? <div className="nexus-ruler-group" data-target-configured="false"><div className="nexus-ruler nexus-ruler-empty" aria-label="月度目标未设定"/><div className="nexus-ruler-ticks" aria-hidden="true">&nbsp;</div></div> : <p className="nexus-target-message">数据待核对</p>}
    <div className="nexus-exceeded" data-exceeded={c.exceeded}>{c.exceeded ? `超额 ${Number(c.exceededAmount) < 0 ? "数据待核对" : `¥${(Number(c.exceededAmount) / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 万`}` : ""}</div>
    <div className="nexus-contract-stats">
      <div><p>月度目标</p>{target ? <NexusMoney value={c.targetAmount} max={30} /> : <strong className="nexus-unset">未设定</strong>}</div>
      <div><p>达成</p><FitText min={18} max={30} text={target ? formatPercent(c.targetRate) : "—"} className={target ? "nexus-orange" : "nexus-unset"}>{target ? <AnimatedNumber value={c.targetRate} format={formatPercent}/> : "—"}</FitText></div>
      <div><p>新签</p><strong className="nexus-orange"><AnimatedNumber value={k.periodNewContracts} format={formatCount}/><small> 份</small></strong></div>
    </div>
    <span className="nexus-currency">人民币口径</span>
  </section>;
}
function AlertIcon({ index }: { index: number }) {
  return <svg className="nexus-alert-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    {index === 0 ? <g><path d="M12 36h24M16 36V22a8 8 0 0 1 16 0v14M24 6v5M8 12l4 4M40 12l-4 4M20 41h8"/><path d="M24 21v8M24 31v2"/></g> : index === 1 ? <g><circle cx="24" cy="25" r="16"/><path d="M24 13v13l8 5"/></g> : <g><path d="M8 16l16-8 16 8v20l-16 8-16-8zM8 16l16 8 16-8M24 24v20"/></g>}
  </svg>;
}
function MetricIcon({ kind }: { kind: "coins" | "people" | "truck" }) {
  return <svg className="nexus-metric-icon" viewBox="0 0 96 64" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
    <ellipse className="nexus-pedestal-base" cx="48" cy="56" rx="38" ry="7" />
    <ellipse className="nexus-pedestal-top" cx="48" cy="52" rx="27" ry="5" />
    <g className="nexus-metric-glyph" transform="translate(10.5 -2) scale(.94)">
      {kind === "coins" ? <g><ellipse cx="40" cy="14" rx="17" ry="6" />{[22, 30, 38, 46].map(y => <path key={y} d={`M23 ${y-8}v8c0 8 34 8 34 0v-8`} />)}</g> : kind === "people" ? <g><circle cx="40" cy="18" r="8"/><circle cx="21" cy="25" r="6"/><circle cx="59" cy="25" r="6"/><path d="M27 49v-8c0-17 26-17 26 0v8M11 49v-7c0-12 13-12 13-8M56 34c0-4 13-4 13 8v7"/></g> : <g><path d="M12 16h35v31H12zM47 27h13l9 12v8H47M52 30v10h14"/><circle cx="25" cy="48" r="6"/><circle cx="59" cy="48" r="6"/></g>}
    </g>
  </svg>;
}
export function OperationMetrics({ business }: { business: PublicSalesScreenPayload }) {
  const k = business.kpis, d = business.delivery.summary;
  return <section className="nexus-panel nexus-operations" data-screen-panel="kpi"><NexusTitle>经营关键指标</NexusTitle>
    <div className="nexus-metrics" data-long-customer-count={formatCount(k.totalCustomers).length > 10}>
      <div><MetricIcon kind="coins"/><p>实际回款</p><NexusMoney value={k.periodPaidAmount}/></div>
      <div><MetricIcon kind="people"/><p>客户总数</p><strong><FitText text={formatCount(k.totalCustomers)} min={18} max={34} className="nexus-customer-count"><AnimatedNumber value={k.totalCustomers} format={formatCount}/></FitText></strong><p>新增 <AnimatedNumber value={k.periodNewCustomers} format={formatCount}/></p></div>
      <div><MetricIcon kind="truck"/><p>本期发货</p><strong><AnimatedNumber value={d.unitCount} format={formatCount}/><small> 台</small></strong><p className="nexus-seven-day">7 日内待发 {formatCount(d.sevenDayDue)} 单</p></div>
    </div>
  </section>;
}
export function CollectionDial({ business }: { business: PublicSalesScreenPayload }) {
  const c = business.collection;
  const invalid = hasNegativeMetric(c.totalContractAmount, c.totalPaidAmount, c.totalUnpaidAmount, c.collectionRate);
  const rate = Math.min(100, Math.max(0, c.collectionRate));
  const circumference = 2 * Math.PI * 84, orbit = 2 * Math.PI * 114;
  const paid = circumference * rate / 100, gap = rate > 0 && rate < 100 ? 3 : 0;
  const id = useId(), progressId = `${id}-progress`;
  return <section className="nexus-panel nexus-collection" data-screen-panel="collection"><NexusTitle>合同与回款</NexusTitle>
    <div className="nexus-collection-body"><div className="nexus-dial" data-invalid={invalid}>
      <svg className="nexus-dial-scale" viewBox="0 0 240 240" aria-hidden="true">
        <defs><linearGradient id={progressId} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#FFB36B"/><stop offset="100%" stopColor="#C9561C"/></linearGradient></defs>
        <circle className="nexus-dial-scan" cx="120" cy="120" r="109" stroke="#FFB36B" strokeWidth="2" strokeDasharray="40 685" opacity="0"/>
        <circle className="nexus-dial-orbit" cx="120" cy="120" r="114" stroke="#8A93A0" strokeOpacity=".3"/>
        {!invalid && rate > 0 ? <circle cx="120" cy="120" r="114" stroke="#EE7D2C" strokeWidth="3" strokeOpacity=".7" strokeDasharray={`${orbit * rate / 100} ${orbit}`} transform="rotate(-90 120 120)"/> : null}
        <circle cx="120" cy="120" r="97" stroke="#8A93A0" strokeOpacity=".25"/>
        <g className="nexus-dial-ticks">{Array.from({length: 60}, (_, i) => <line key={i} x1="120" y1={i % 5 === 0 ? "9" : "12"} x2="120" y2="18" transform={`rotate(${i * 6} 120 120)`} stroke={i % 5 === 0 ? "#d4dae0" : "#8A93A0"} strokeOpacity={i % 5 === 0 ? .75 : .45}/>)}</g>
        <circle cx="120" cy="120" r="84" stroke="#2A3038" strokeWidth="14"/>
        {!invalid && rate < 100 ? <circle className="nexus-dial-unpaid" cx="120" cy="120" r="84" stroke="#C9D0D8" strokeOpacity=".55" strokeWidth="8" strokeDasharray={`${Math.max(0, circumference - paid - gap * 2)} ${circumference}`} strokeDashoffset={-(paid + gap)} transform="rotate(-90 120 120)"/> : null}
        {!invalid ? <circle className="nexus-dial-progress" cx="120" cy="120" r="84" stroke={`url(#${progressId})`} strokeWidth="14" strokeDasharray={`${paid} ${circumference}`} transform="rotate(-90 120 120)" data-collection-rate={c.collectionRate}/> : null}
        <circle cx="120" cy="120" r="73" stroke="#EE7D2C" strokeOpacity=".3"/>
      </svg><div className="nexus-dial-center"><p>累计回款率</p><strong>{invalid ? "数据待核对" : <AnimatedNumber value={c.collectionRate} format={formatPercent}/>}</strong></div>
    </div><div className="nexus-paid"><div className="nexus-paid-received"><p>已收</p><NexusMoney value={c.totalPaidAmount}/></div><div className="nexus-paid-unpaid"><p>未收</p><NexusMoney value={c.totalUnpaidAmount}/></div></div></div>
    <span className="nexus-currency">人民币口径</span>
  </section>;
}
export function DeliveryAlerts({ business }: { business: PublicSalesScreenPayload }) {
  const s = business.delivery.summary;
  return <section className="nexus-panel nexus-alerts" data-screen-panel="reminders"><NexusTitle>发货预警</NexusTitle>
    <div className="nexus-alert-grid">{[["逾期待发", s.overdueDue], ["今日应发", s.todayDue], ["7 日内待发", s.sevenDayDue]].map(([label, count], i) => <div key={String(label)} className={i === 0 ? "nexus-overdue" : ""} data-active={Number(count) > 0}><AlertIcon index={i}/><p>{label}</p><strong>{formatCount(Number(count))}<small> 单</small></strong></div>)}</div>
  </section>;
}
export function ShipmentFeed({ business, activeKey, onSelect }: { business: PublicSalesScreenPayload; activeKey: string | null; onSelect: (key: string) => void }) {
  const routes = business.delivery.routes;
  const rows = latestRoutes(routes);
  return <section className="nexus-feed" data-screen-panel="delivery" aria-label="交付里程碑"><NexusTitle>最新发货动态</NexusTitle>
    <div className="nexus-feed-grid">{rows.map((r, index) => <button type="button" className="nexus-feed-item" key={r.key} data-route-key={r.key} aria-pressed={activeKey === r.key} onClick={() => onSelect(r.key)} onFocus={() => onSelect(r.key)}>
      <span className="nexus-feed-index">{String(index + 1).padStart(2, "0")}</span>
      <FitText text={r.equipmentModel || "型号待确认"} min={18} max={28} className="nexus-model">{r.equipmentModel || "型号待确认"}</FitText>
      <div className="nexus-feed-bottom"><time>{formatShortDate(r.shipmentDate)}</time><span className="nexus-feed-units">{formatCount(r.unitCount)} 台</span><span className="nexus-feed-region">{feedCity(r, routes)}</span></div>
    </button>)}</div>{!rows.length ? <p className="nexus-empty">本期暂无发货动态</p> : null}
  </section>;
}
