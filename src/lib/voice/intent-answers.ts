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
  const counts: Array<[string, number]> = intent === "new_customers"
    ? [["本期新增客户", payload.kpis.periodNewCustomers], ["累计客户", payload.kpis.totalCustomers]]
    : intent === "followup_todo"
      ? [["今日跟进", payload.kpis.todayFollowUp], ["七日内跟进", payload.kpis.sevenDayFollowUp], ["逾期跟进", payload.kpis.overdueFollowUp]]
      : intent === "region_shipments"
        ? [["累计发运台数", payload.delivery.summary.unitCount], ...(payload.delivery.regionUnits ?? []).map(row => [`${row.province}发运台数`, row.unitCount] as [string, number]), ["地区待确认台数", payload.delivery.unresolvedRegionTotals?.unitCount ?? 0]]
        : intent === "upcoming_shipments"
          ? [["今日待发", payload.delivery.summary.todayDue], ["七日内待发", payload.delivery.summary.sevenDayDue], ["逾期待发", payload.delivery.summary.overdueDue]]
          : intent === "sales_progress" || intent === "target_rate"
            ? [["目标完成率", payload.collection.targetRate]]
            : intent === "collection" ? [["累计回款率", payload.collection.collectionRate]] : [];
  const anomalies = counts.filter(([, value]) => value < 0);
  if (anomalies.length > 0) {
    const lines = anomalies.map(([label, value]) => `${label}为 ${value}，需要核对历史数据`);
    card = buildBriefCard("数据异常", lines);
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
