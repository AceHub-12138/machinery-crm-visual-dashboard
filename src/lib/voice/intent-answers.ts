/** 意图 → 确定性卡片与播报；真实/脚本适配器共用，模型不参与数值构造。 */
import { formatMoney } from "../format.ts";
import {
  buildBriefCard, buildCompletionRingCard, buildCustomersShipmentsCard,
  buildRegionCard, buildTargetProgressCardFromPublic, VOICE_COVERAGE_FALLBACK,
} from "./card-builders.ts";
import type { Intent } from "./intents.ts";
import type { PublicSalesScreenPayload } from "./public-payload.ts";
import type { AnswerCardData } from "./session-machine.ts";
import { buildSpokenSentences } from "./spoken-normalize.ts";

export const VOICE_GOODBYE = "为您服务是我的荣幸,先生。";

export function buildIntentAnswer(intent: Intent, payload: PublicSalesScreenPayload, periodLabel = payload.period.label) {
  let card: AnswerCardData;
  switch (intent) {
    case "sales_progress": card = buildTargetProgressCardFromPublic(payload.collection, periodLabel); break;
    case "target_rate": card = buildCompletionRingCard(payload.collection, periodLabel); break;
    case "region_shipments": card = buildRegionCard(payload.delivery, periodLabel); break;
    case "upcoming_shipments": card = buildCustomersShipmentsCard(payload.delivery, periodLabel); break;
    case "new_customers":
      card = buildBriefCard(`${periodLabel} · 客户概览`, [
        `先生,本期新增客户 ${payload.kpis.periodNewCustomers} 家。`,
        `客户总数 ${payload.kpis.totalCustomers} 家。`,
      ]); break;
    case "followup_todo":
      card = buildBriefCard(`${periodLabel} · 跟进待办`, [
        `先生,今日待跟进 ${payload.kpis.todayFollowUp} 项,七日内 ${payload.kpis.sevenDayFollowUp} 项。`,
        `其中逾期 ${payload.kpis.overdueFollowUp} 项,建议优先处理。`,
      ]); break;
    case "collection":
      card = buildBriefCard(`${periodLabel} · 累计回款概览`, [
        `先生,累计回款率 ${payload.collection.collectionRate}%,已回 ${formatMoney(Number(payload.collection.totalPaidAmount))},未回 ${formatMoney(Number(payload.collection.totalUnpaidAmount))}。`,
      ]); break;
    case "chitchat_or_end": card = buildBriefCard("小川", [VOICE_GOODBYE]); break;
    default: card = buildBriefCard("小川", [VOICE_COVERAGE_FALLBACK]); break;
  }
  return {
    cardId: card.kind, card, spoken: card.spoken,
    sentences: buildSpokenSentences(card.spoken),
    unanswerable: intent === "unanswerable",
  };
}
