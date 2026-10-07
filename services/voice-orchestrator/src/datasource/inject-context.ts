/**
 * 公开 payload → 本地数字快照与备用护栏。
 * 8c 主路径不将此快照发送给模型；卡片与播报由代码模板生成。
 * sanitizeAnswer 保留旧替换语义供兼容调用方使用，编排侧仅记录异常告警。
 */

import { formatMoney, formatShortDate } from "../../../../src/lib/format.ts";
import { VOICE_COVERAGE_FALLBACK } from "../../../../src/lib/voice/card-builders.ts";
import type { PublicSalesScreenPayload } from "../../../../src/lib/voice/public-payload.ts";
import { aggregateRegions } from "../../../../src/lib/voice/card-builders.ts";

/** system prompt 硬约束(plan §10.2,原句拼接,勿改口径)。 */
export const INJECTION_CONSTRAINT = [
  "你是「小川」,展厅大屏的经营汇报管家,称呼用户「先生」。",
  "【经营数据快照】是当前唯一可信数据来源,遵守以下硬约束:",
  "1. 回答中出现的每一个数字、金额、百分比,必须原样引用快照中出现的字符串,禁止心算、换算、估算或编造;",
  "2. 快照中没有的数据,一律原句回答:「抱歉先生,我暂时无法调取这项数据。」",
  "3. 回答不超过 3 句,先结论后数字;不出现快照以外的业务名词解释。",
].join("\n");

/** payload → 本地校验快照（纯函数，与卡片共用 formatter）。 */
export function buildInjectedContext(payload: PublicSalesScreenPayload): string {
  const lines: string[] = [];
  const k = payload.kpis;
  const c = payload.collection;
  const d = payload.delivery;

  lines.push(`【经营数据快照】统计期:${payload.period.label}(${payload.period.startDate} ~ ${payload.period.endDate})`);

  lines.push("[总体指标]");
  lines.push(
    `客户总数 ${k.totalCustomers} 家;本期新增客户 ${k.periodNewCustomers} 家;本期新签合同 ${k.periodNewContracts} 份;` +
      `本期合同额 ${formatMoney(Number(k.periodContractAmount))};本期已回款 ${formatMoney(Number(k.periodPaidAmount))};` +
      `本期未回款 ${formatMoney(Number(k.periodUnpaidAmount))};本期发运 ${k.periodShipments} 车次`,
  );
  lines.push(
    `今日待跟进 ${k.todayFollowUp} 项;七日内待跟进 ${k.sevenDayFollowUp} 项;逾期跟进 ${k.overdueFollowUp} 项;` +
      `未回款合同 ${k.unpaidContracts} 份;部分回款合同 ${k.partialPaidContracts} 份`,
  );

  lines.push("[目标完成]");
  lines.push(
    `合同额目标 ${formatMoney(Number(c.targetAmount))};已完成 ${formatMoney(Number(c.actualAmount))};` +
      `完成率 ${c.targetRate}%;距目标还差 ${formatMoney(Number(c.remainingAmount))}` +
      (c.exceeded ? `;已超额 ${formatMoney(Number(c.exceededAmount))}` : ""),
  );

  lines.push("[累计回款]");
  lines.push(
    `累计合同额 ${formatMoney(Number(c.totalContractAmount))};累计已回 ${formatMoney(Number(c.totalPaidAmount))};` +
      `累计未回 ${formatMoney(Number(c.totalUnpaidAmount))};累计回款率 ${c.collectionRate}%`,
  );

  lines.push("[发货概览]");
  lines.push(
    `本期发运 ${d.summary.shipmentCount} 车次 / ${d.summary.unitCount} 台,覆盖 ${d.summary.regionCount} 个省市;` +
      `今日到期 ${d.summary.todayDue} 台;七日内到期 ${d.summary.sevenDayDue} 台;逾期未发 ${d.summary.overdueDue} 台`,
  );

  const regions = aggregateRegions(d.routes);
  if (regions.length > 0) {
    lines.push("[区域分布]");
    lines.push(regions.map((row) => `${row.region} ${row.units}台/${row.shipments}单`).join(";"));
  }

  const milestones = [...d.milestones]
    .sort((a, b) => b.shipmentDate.localeCompare(a.shipmentDate))
    .slice(0, 8);
  if (milestones.length > 0) {
    lines.push("[近期发运]");
    lines.push(
      milestones
        .map((m) => `${formatShortDate(m.shipmentDate)} ${m.equipmentName} ${m.equipmentModel} ${statusText(m.shipmentStatus)} ${m.unitCount}台`)
        .join(";"),
    );
  }

  lines.push("[发运提醒]");
  lines.push(
    `今日:${summarizeReminders(d.reminders.today)};七日内:${summarizeReminders(d.reminders.sevenDays)};逾期:${summarizeReminders(d.reminders.overdue)}`,
  );

  lines.push(`快照生成时间:${payload.generatedAt}`);
  return lines.join("\n");
}

function summarizeReminders(
  list: PublicSalesScreenPayload["delivery"]["reminders"]["today"],
): string {
  if (list.length === 0) return "无";
  return list
    .map((r) => `${formatShortDate(r.estimatedShipmentDate)} ${r.equipmentName} ${r.equipmentModel} ${r.city ?? r.province}`)
    .join(";");
}

function statusText(status: string): string {
  if (status === "SHIPPED") return "已发运";
  if (status === "PARTIAL_SHIPPED") return "部分发运";
  return status;
}

/* ---------------------------------------------------------------- 数字护栏 */

/** 提取答案文本中的数字 token(千分位逗号先剥掉)。 */
export function extractNumbers(text: string): string[] {
  const normalized = text.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "");
  const matches = normalized.match(/(?<![\d.])\d+(?:\.\d+)?(?![\d.])/g);
  return matches ?? [];
}

/**
 * 防幻觉护栏:答案中每个数字必须能在注入快照里找到(逗号不敏感)。
 * 年份/日期/台数等都在快照里有原文,因此该约束可严格成立。
 */
export function verifyAnswerNumbers(answer: string, snapshot: string): { ok: boolean; violations: string[] } {
  const allowed = new Set(extractNumbers(snapshot));
  const violations = extractNumbers(answer).filter((num) => !allowed.has(num));
  return { ok: violations.length === 0, violations };
}

/** 护栏出口:违规答案整体替换为降级话术(F 红线:宁可不说,不可编造)。 */
export function sanitizeAnswer(answer: string, snapshot: string): { text: string; degraded: boolean } {
  const verdict = verifyAnswerNumbers(answer, snapshot);
  if (verdict.ok) return { text: answer, degraded: false };
  return { text: VOICE_COVERAGE_FALLBACK, degraded: true };
}
