"use client";

import { Panel, PanelHead } from "@/components/screen/Panel";
import { formatCount, formatShortDate } from "@/lib/format";
import type { CrmDashboardStats, ShipmentReminderItem } from "@/lib/types";

const TONES = {
  pending: { bar: "var(--c-pending)", text: "text-[var(--c-pending)]" },
  collect: { bar: "var(--c-collect)", text: "text-[var(--c-collect)]" },
  overdue: { bar: "var(--c-overdue)", text: "text-[var(--c-overdue)]" },
} as const;

/**
 * 一组发货提醒。
 *
 * 面板宽 624、但**高只有 383**（右列上下两块按内容分配，见 ScreenStage），
 * 所以竖向才是稀缺资源，列表改成**两条并排**：
 *
 *   竖排（改前）：组头 22 + 间距 8 + 3×20 + 内边距 20 = 113px/组，
 *                 三组 + 2 个组间距 = 355px > 可用 325px，
 *                 实测第三行被 overflow-hidden 裁掉 24px。
 *   并排（现在）：组头 22 + 间距 8 + 2×20 + 内边距 20 = 90px/组，
 *                 三组 = 286px，反而余出 ~39px。
 *
 * 并排后每条 280px：日期 52 + 合同编号 + 设备。展厅屏不展示客户名称，
 * 合同编号允许截断，设备名吃掉剩余宽度。
 */
function ReminderGroup({
  title,
  count,
  items,
  tone,
}: {
  title: string;
  count: number;
  items: ShipmentReminderItem[];
  tone: keyof typeof TONES;
}) {
  return (
    <section className={`reminder-group reminder-${tone} flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-1.5`}>
      <header className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: TONES[tone].bar }} />
          <h3 className="truncate text-caption leading-none font-medium text-[var(--ink)]">
            {title}
          </h3>
        </div>
        <span className={`num shrink-0 text-label leading-none ${TONES[tone].text}`}>
          {formatCount(count)}
        </span>
      </header>

      {/* 每条一行：日期 · 合同编号 · 设备。
          每条只有 272px（586 ÷ 2 列 − 列间距），20px 的合同号 + 18px 的设备名
          合计约 315px，**必然放不下**，所以两个字段都显式 truncate：
          · 合同编号给固定基准（basis-28 = 112px）先截断；
          · 设备名吃掉剩余宽度。
          不给设备名 flex-1（basis 0）—— 那样公司名会贪掉全部剩余宽度，
          设备名被压到 60px 只剩「数控键…」，读起来像乱码。

          只显示 2 条：可用高度 46px 装得下「2 行 × 20px + 6px 行距」，
          第 3 条要多 26px，会被 overflow-hidden 裁掉（实测 scrollHeight
          比 clientHeight 多 3px，正好切在第三行上）。组头的计数是**全量**，
          少列一行不会丢信息。 */}
      <ul className="mt-1.5 grid min-h-0 flex-1 grid-cols-2 content-start gap-x-4 gap-y-1.5 overflow-hidden">
        {items.slice(0, 2).map((item) => (
          <li key={item.id} className="flex min-w-0 items-baseline gap-1.5">
            <span className="num shrink-0 text-micro leading-none text-[var(--ink-3)]">
              {formatShortDate(item.estimatedShipmentDate)}
            </span>
            <span className="min-w-0 shrink basis-28 truncate text-caption leading-none text-[var(--ink)]">
              {item.contractNo}
            </span>
            <span className="min-w-0 flex-1 truncate text-micro leading-none text-[var(--ink-3)]">
              {item.equipmentName}
              {item.equipmentModel ? ` ${item.equipmentModel}` : ""}
            </span>
          </li>
        ))}
        {!items.length ? (
          <li className="text-micro leading-none text-[var(--ink-3)]">暂无数据</li>
        ) : null}
      </ul>
    </section>
  );
}

export function ReminderRail({
  stats,
  reminders,
}: {
  stats: CrmDashboardStats;
  reminders: {
    today: ShipmentReminderItem[];
    sevenDays: ShipmentReminderItem[];
    overdue: ShipmentReminderItem[];
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
