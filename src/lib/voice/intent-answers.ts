/** 意图 → 确定性卡片与播报；真实/脚本适配器共用，模型不参与数值构造。 */
import {
  buildBriefCard, buildCompletionRingCard, buildCustomersShipmentsCard,
  buildRegionCard, buildTargetProgressCardFromPublic, VOICE_COVERAGE_FALLBACK,
  buildCustomerKpiCard, buildFollowupBucketsCard, buildCollectionSplitCard,
} from "./card-builders.ts";
import type { Intent } from "./intents.ts";
import type { PublicSalesScreenPayload } from "./public-payload.ts";
import type { AnswerCardData } from "./session-machine.ts";
import { formatMoney } from "../format.ts";
import { buildSpokenSentences } from "./spoken-normalize.ts";

export const VOICE_GOODBYE = "为您服务是我的荣幸,先生。";

export function buildIntentAnswer(intent: Intent, payload: PublicSalesScreenPayload, periodLabel = payload.period.label) {
  let card: AnswerCardData;
  // 检查本意图会使用的汇总、金额和样本；负值不送进数值卡协议，也不静默丢卡。
  const targetMetrics: Array<[string, number | string]> = [
    ["本期合同额", payload.kpis.periodContractAmount], ["月度目标", payload.collection.targetAmount],
    ["目标完成率", payload.collection.targetRate], ["剩余金额", payload.collection.remainingAmount], ["超额金额", payload.collection.exceededAmount],
  ];
  const metrics: Array<[string, number | string]> = intent === "new_customers"
    ? [["本期新增客户", payload.kpis.periodNewCustomers], ["累计客户", payload.kpis.totalCustomers]]
    : intent === "followup_todo"
      ? [["今日跟进", payload.kpis.todayFollowUp], ["七日内跟进", payload.kpis.sevenDayFollowUp], ["逾期跟进", payload.kpis.overdueFollowUp]]
      : intent === "region_shipments"
        ? [
          ...Object.entries(payload.delivery.summary).map(([key, value]) => [key, value] as [string, number]),
          ...(payload.delivery.regionUnits ?? []).flatMap(row => [[`${row.province}发运台数`, row.unitCount], [`${row.province}发运次数`, row.shipmentCount]] as Array<[string, number]>),
          ["地区待确认台数", payload.delivery.unresolvedRegionTotals?.unitCount ?? 0], ["地区待确认次数", payload.delivery.unresolvedRegionTotals?.shipmentCount ?? 0],
          ...payload.delivery.routes.map(row => ["地图样本台数", row.unitCount] as [string, number]),
        ]
        : intent === "upcoming_shipments"
          ? [
            ...Object.entries(payload.delivery.summary).map(([key, value]) => [key, value] as [string, number]),
            ["明细总数", payload.delivery.milestonesTotal ?? 0],
            ...payload.delivery.milestones.map(row => ["发运明细台数", row.unitCount] as [string, number]),
            ["今日待发总数", payload.delivery.reminders.todayTotal ?? 0], ["七日内待发总数", payload.delivery.reminders.sevenDaysTotal ?? 0], ["逾期待发总数", payload.delivery.reminders.overdueTotal ?? 0],
          ]
          : intent === "sales_progress"
            ? [...targetMetrics, ["本期实际回款", payload.kpis.periodPaidAmount], ["本期新合同欠款", payload.kpis.periodUnpaidAmount]]
            : intent === "target_rate" ? targetMetrics
              : intent === "collection" ? [["累计合同额", payload.collection.totalContractAmount], ["累计已回款", payload.collection.totalPaidAmount], ["累计未回款", payload.collection.totalUnpaidAmount], ["累计回款率", payload.collection.collectionRate]] : [];
  if (metrics.some(([, value]) => Number(value) < 0)) {
    card = { ...buildBriefCard("数据待核对", ["数据待核对"]), spoken: "先生，数据待核对。" };
    return { cardId: card.kind, card, spoken: card.spoken, sentences: buildSpokenSentences(card.spoken), unanswerable: false };
  }
  switch (intent) {
    case "sales_progress": {
      const base = buildTargetProgressCardFromPublic({ ...payload.collection, actualAmount: payload.kpis.periodContractAmount }, periodLabel);
      const paidText = formatMoney(Number(payload.kpis.periodPaidAmount));
      const newContractUnpaidText = formatMoney(Number(payload.kpis.periodUnpaidAmount));
      card = { ...base, paidText, newContractUnpaidText,
        spoken: `${base.spoken}本期实际回款 ${paidText},本期新合同欠款 ${newContractUnpaidText}。` };
      break;
    }
    case "target_rate": card = buildCompletionRingCard({ ...payload.collection, actualAmount: payload.kpis.periodContractAmount }, periodLabel); break;
    case "region_shipments": card = buildRegionCard(payload.delivery, periodLabel); break;
    case "upcoming_shipments": card = buildCustomersShipmentsCard(payload.delivery, periodLabel); break;
    case "new_customers":
      card = buildCustomerKpiCard(payload.kpis, periodLabel); break;
    case "followup_todo":
      card = buildFollowupBucketsCard(payload.kpis, periodLabel); break;
    case "collection":
      card = buildCollectionSplitCard(payload.collection, periodLabel); break;
    case "greeting": card = buildBriefCard("小川", ["我在,先生。请讲。"]); break;
    case "chitchat_or_end": card = buildBriefCard("小川", [VOICE_GOODBYE]); break;
    default: card = buildBriefCard("小川", [VOICE_COVERAGE_FALLBACK]); break;
  }
  return {
    cardId: card.kind, card, spoken: card.spoken,
    sentences: buildSpokenSentences(card.spoken),
    unanswerable: intent === "unanswerable",
  };
}
