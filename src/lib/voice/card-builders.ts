/**
 * 答案卡构造器(plan §7 数据一致性红线的唯一实现点,8b)。
 *
 * 大屏覆盖层与编排服务共用本文件:编排侧用注入 payload(PublicSalesScreenPayload
 * 口径)构造卡片 JSON 随事件下发,大屏只渲染不再计算——「卡片数字 == payload
 * 字段」因此由构造保证,并由口径一致性 diff 测试锁死(card-builders.test.ts)。
 *
 * 8a 的 demo-script.buildTargetProgressCard 从 salesTargets 推导同一张卡;
 * buildTargetProgressCardFromPublic 与它在数字一致时必须产出逐字段相同的字符串
 * (diff 测试断言),证明 voice 链路与屏幕基线同源。
 */

import { formatMoney, formatShortDate } from "../format.ts";
import { ANSWER_ROWS_MAX, ANSWER_SPOKEN_MAX, ANSWER_TEXT_MAX } from "./protocol.ts";
import type { PublicSalesScreenPayload, PublicRouteSample } from "./public-payload.ts";
import type { AnswerCardData } from "./session-machine.ts";

/** 超长答案文本截断(留 20 字余量,末尾补 …);保证服务端发出的卡片能通过前端 isValidAnswerCard */
export function clampAnswerText(text: string, max: number = ANSWER_TEXT_MAX - 20): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * 目标进度卡(与 8a demo 同一模板)。
 * 数据 = collection 段:actualAmount / targetAmount / remainingAmount / targetRate。
 */
export function buildTargetProgressCardFromPublic(
  collection: PublicSalesScreenPayload["collection"],
  periodLabel: string,
): AnswerCardData & { kind: "target-progress" } {
  const actualText = formatMoney(Number(collection.actualAmount));
  const targetText = formatMoney(Number(collection.targetAmount));
  const remainingText = collection.exceeded
    ? `已超额 ${formatMoney(Number(collection.exceededAmount))}`
    : formatMoney(Number(collection.remainingAmount));

  return {
    kind: "target-progress",
    title: `${periodLabel} · 合同额目标进度`,
    actualText,
    targetText,
    remainingText,
    completionRate: collection.targetRate,
    spoken: `先生,${periodLabel}合同额 ${actualText},完成月度目标的 ${collection.targetRate}%,${collection.exceeded ? remainingText : `距离目标还差 ${remainingText}`}。`,
  };
}

/** 完成率环卡(plan §7「完成率环卡」,TargetRing 语义)。
 * 数据 = collection.targetRate / remainingAmount(+actual/target 作环外注脚)。 */
export function buildCompletionRingCard(
  collection: PublicSalesScreenPayload["collection"],
  periodLabel: string,
): AnswerCardData & { kind: "completion-ring" } {
  // 环形图在渲染时限幅，数值与播报保留真实完成率（可超过 100%）。
  const ratePercent = collection.targetRate;
  const collectedText = formatMoney(Number(collection.actualAmount));
  const targetText = formatMoney(Number(collection.targetAmount));
  const remainingText = collection.exceeded
    ? `已超额 ${formatMoney(Number(collection.exceededAmount))}`
    : formatMoney(Number(collection.remainingAmount));

  return {
    kind: "completion-ring",
    title: `${periodLabel} · 目标完成率`,
    ratePercent,
    collectedText,
    targetText,
    remainingText,
    spoken: `先生,${periodLabel}合同额目标完成 ${ratePercent}%,已完成 ${collectedText},${collection.exceeded ? remainingText : `距离目标还差 ${remainingText}`}。`,
  };
}

/** 区域行(与 AnswerCardData 的 region.rows 成员同形)。 */
export type RegionRow = {
  region: string;
  shipments: number;
  units: number;
  sharePercent: number;
};

/** 按省聚合发运路线(纯函数;RegionCard 与注入口径共用)。 */
export function aggregateRegions(routes: PublicRouteSample[]): RegionRow[] {
  const totalUnits = routes.reduce((sum, route) => sum + route.unitCount, 0);
  const byProvince = new Map<string, { shipments: number; units: number }>();
  for (const route of routes) {
    const bucket = byProvince.get(route.province) ?? { shipments: 0, units: 0 };
    bucket.shipments += 1;
    bucket.units += route.unitCount;
    byProvince.set(route.province, bucket);
  }
  return [...byProvince.entries()]
    .map(([region, bucket]) => ({
      region,
      shipments: bucket.shipments,
      units: bucket.units,
      sharePercent: totalUnits === 0 ? 0 : Number(((bucket.units / totalUnits) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.units - a.units || a.region.localeCompare(b.region, "zh-CN"));
}

/** 区域对比卡(plan §7「区域对比卡」)。
 * 数据 = delivery.routes 按省聚合,取台数前 5;总数与覆盖数取自 delivery.summary。 */
export function buildRegionCard(
  delivery: PublicSalesScreenPayload["delivery"],
  periodLabel: string,
): AnswerCardData & { kind: "region" } {
  const aggregates = aggregateRegions(delivery.routes);
  const rows = aggregates.slice(0, 5).map((row) => ({ ...row }));
  const { regionCount, unitCount, shipmentCount } = delivery.summary;
  const topText = rows
    .slice(0, 3)
    .map((row) => `${row.region} ${row.units} 台`)
    .join("、");

  return {
    kind: "region",
    title: `${periodLabel} · 区域发运分布`,
    summaryText: `覆盖 ${regionCount} 个省市 · ${shipmentCount} 车次 / ${unitCount} 台`,
    rows,
    other: { regions: Math.max(0, aggregates.length - 5), units: aggregates.slice(5).reduce((sum, r) => sum + r.units, 0) },
    mapPoints: delivery.routes.map(r => ({ region: r.province, lng: r.centerLng, lat: r.centerLat })),
    spoken: `先生,本期发运覆盖 ${regionCount} 个省市、共 ${unitCount} 台${topText ? `,台数最多的是${topText}` : ""}。`,
  };
}

const SHIPMENT_STATUS_TEXT: Record<string, string> = {
  SHIPPED: "已发运",
  PARTIAL_SHIPPED: "部分发运",
};

/** 客户/发货卡(plan §7「客户/发货卡」,ReminderRail / DeliveryMilestones 数据面)。
 * 数据 = delivery.milestones(最近 5 条)+ reminders 三桶计数。 */
export function buildCustomersShipmentsCard(
  delivery: PublicSalesScreenPayload["delivery"],
  periodLabel: string,
): AnswerCardData & { kind: "customers-shipments" } {
  const { todayDue, sevenDayDue, overdueDue } = delivery.summary;
  const rows = [...delivery.milestones]
    .sort((a, b) => b.shipmentDate.localeCompare(a.shipmentDate))
    .slice(0, delivery.milestones.length > 15 ? 14 : 15)
    .map((milestone) => ({
      equipmentText: `${milestone.equipmentName} ${milestone.equipmentModel}`.trim(),
      detailText: milestone.contractNumber ? `合同尾号 ${milestone.contractNumber.slice(-4)}` : milestone.equipmentModel,
      statusText: SHIPMENT_STATUS_TEXT[milestone.shipmentStatus] ?? milestone.shipmentStatus,
      dateLabel: formatShortDate(milestone.shipmentDate),
    }));

  // reminders 是样本列表，不能用列表长度冒充完整汇总数量。
  const summaryText = `今日到期 ${todayDue} · 七日内 ${sevenDayDue} · 逾期 ${overdueDue}`;

  return {
    kind: "customers-shipments",
    title: `${periodLabel} · 发运与提醒`,
    summaryText,
    rows,
    counts: { today: todayDue, sevenDays: sevenDayDue, overdue: overdueDue },
    omittedCount: Math.max(0, delivery.milestones.length - rows.length),
    spoken: `先生,近期发运台账共 ${delivery.summary.unitCount} 台,今日到期 ${todayDue} 台、逾期未发 ${overdueDue} 台,已为您列出发运明细。`,
  };
}

/** 结论卡(tool.invoke 无数据模板时的兜底;只呈现播报要点)。 */
export function buildBriefCard(title: string, lines: string[]): AnswerCardData & { kind: "brief" } {
  const safeLines = lines.slice(0, ANSWER_ROWS_MAX).map((line) => clampAnswerText(line));
  return {
    kind: "brief",
    title: clampAnswerText(title),
    lines: safeLines,
    spoken: clampAnswerText(safeLines.join(""), ANSWER_SPOKEN_MAX - 20),
  };
}

/** 覆盖缺口兜底话术(plan §16.2 F:payload/MCP 都没有的数据,必须原句降级)。 */
export const VOICE_COVERAGE_FALLBACK = "抱歉先生,我暂时无法调取这项数据。";

export function buildCustomerKpiCard(kpis: PublicSalesScreenPayload["kpis"], periodLabel: string): Extract<AnswerCardData, { kind: "customer-kpi" }> {
  return { kind: "customer-kpi", title: `${periodLabel} · 客户概览`, newCustomers: kpis.periodNewCustomers, totalCustomers: kpis.totalCustomers,
    spoken: `先生,本期新增客户 ${kpis.periodNewCustomers} 家。客户总数 ${kpis.totalCustomers} 家。` };
}
export function buildFollowupBucketsCard(kpis: PublicSalesScreenPayload["kpis"], periodLabel: string): Extract<AnswerCardData, { kind: "followup-buckets" }> {
  return { kind: "followup-buckets", title: `${periodLabel} · 跟进待办`, today: kpis.todayFollowUp, sevenDays: kpis.sevenDayFollowUp, overdue: kpis.overdueFollowUp,
    spoken: `先生,今日待跟进 ${kpis.todayFollowUp} 项,七日内 ${kpis.sevenDayFollowUp} 项。其中逾期 ${kpis.overdueFollowUp} 项,建议优先处理。` };
}
export function buildCollectionSplitCard(collection: PublicSalesScreenPayload["collection"], periodLabel: string): Extract<AnswerCardData, { kind: "collection-split" }> {
  const paidText = formatMoney(Number(collection.totalPaidAmount));
  const unpaidText = formatMoney(Number(collection.totalUnpaidAmount));
  return { kind: "collection-split", title: `${periodLabel} · 累计回款概览`, ratePercent: collection.collectionRate, paidText, unpaidText,
    spoken: `先生,累计回款率 ${collection.collectionRate}%,已回 ${paidText},未回 ${unpaidText}。` };
}
