"use client";

import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { ClipText } from "@/components/screen/ClipText";
import { Panel, PanelHead } from "@/components/screen/Panel";
import { formatCount, formatShortDate } from "@/lib/format";
import type { CrmDashboardStats } from "@/lib/types";
import type { PublicReminder } from "@/lib/public-screen-payload";

const TONES = {
  pending: { bar: "var(--c-pending)", text: "text-[var(--c-pending)]" },
  collect: { bar: "var(--c-collect)", text: "text-[var(--c-collect)]" },
  overdue: { bar: "var(--c-overdue)", text: "text-[var(--c-overdue)]" },
} as const;

/** Earliest due records come first; two rows per page, with an explicit remainder. */
function ReminderGroup({ title, count, items, tone }: {
  title: string; count: number; items: PublicReminder[]; tone: keyof typeof TONES;
}) {
  const reduced = useReducedMotion();
  const sorted = useMemo(() => [...items].sort((a,b) =>
    (Date.parse(a.estimatedShipmentDate ?? "") || Infinity) - (Date.parse(b.estimatedShipmentDate ?? "") || Infinity)), [items]);
  const pages = Math.max(1,Math.ceil(sorted.length / 2));
  const [paging,setPaging] = useState({items,page:0});
  const page = reduced || paging.items !== items ? 0 : paging.page % pages;
  const advance = () => setPaging(prev=>({items,page:((prev.items===items ? prev.page : 0)+1)%pages}));
  useEffect(() => {
    if(reduced || pages===1) return;
    const timer=window.setInterval(()=>setPaging(prev=>({items,page:((prev.items===items ? prev.page : 0)+1)%pages})),8000);
    return ()=>window.clearInterval(timer);
  },[reduced,items,pages]);
  const visible = sorted.slice(page*2,page*2+2);
  return <section data-reminder={tone} data-page={page+1} className={`reminder-group reminder-${tone} flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-1`}>
    <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <h3 className="text-caption leading-tight font-medium text-[var(--ink)]">{title}</h3>
      <div className="flex items-center gap-2">
        {items.length>visible.length ? <span className="text-micro text-[var(--ink-3)]">+{items.length-visible.length}</span> : null}
        {!reduced && pages>1 ? <button type="button" onClick={advance} aria-label={`下一页：${title}`} className="text-caption text-[var(--ink-3)]">›</button> : null}
        <span className={`num num-unit text-hero leading-none ${TONES[tone].text}`}>{formatCount(count)}</span>
      </div>
    </header>
    <ul className="mt-1 grid min-h-0 grid-cols-1 gap-0">
      {visible.map(item=><li key={item.id} className="grid min-w-0 grid-cols-[70px_120px_minmax(0,1fr)] items-center gap-2 text-micro leading-[22px]">
        <span className="num num-unit text-[var(--ink-3)]">{formatShortDate(item.estimatedShipmentDate)}</span>
        <ClipText full={item.contractNo} className="clip-1 text-caption text-[var(--ink)]" />
        <ClipText full={`${item.equipmentName}${item.equipmentModel ? ` ${item.equipmentModel}` : ""}`} className="clip-1 text-micro text-[var(--ink-3)]" />
      </li>)}
      {!visible.length ? <li className="text-micro leading-[22px] text-[var(--ink-3)]">暂无数据</li> : null}
    </ul>
  </section>;
}

export function ReminderRail({
  stats,
  reminders,
}: {
  stats: CrmDashboardStats;
  reminders: {
    today: PublicReminder[];
    sevenDays: PublicReminder[];
    overdue: PublicReminder[];
  };
}) {
  const total = stats.todayShipmentDue + stats.sevenDayShipmentDue + stats.overdueShipmentDue;

  return (
    <Panel className="flex h-full min-h-0 flex-col">
      <PanelHead
        eyebrow="Fulfillment"
        title="交付预警"
        extra={
          <p className="num text-label leading-none text-[var(--ink)]">
            {total}
            <span className="ml-1.5 text-micro font-normal text-[var(--ink-3)]">待处理</span>
          </p>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-[var(--panel-pad)]">
        <ReminderGroup title="逾期未发" count={stats.overdueShipmentDue} items={reminders.overdue} tone="overdue" />
        <ReminderGroup title="今日应发" count={stats.todayShipmentDue} items={reminders.today} tone="pending" />
        <ReminderGroup
          title="7 日内待发"
          count={stats.sevenDayShipmentDue}
          items={reminders.sevenDays}
          tone="collect"
        />
      </div>
    </Panel>
  );
}
