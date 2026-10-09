/** 意图 → 确定性卡片与播报；真实/脚本适配器共用，模型不参与数值构造。 */
import {
  buildBriefCard, buildCompletionRingCard, buildCustomersShipmentsCard,
  buildRegionCard, buildTargetProgressCardFromPublic, VOICE_COVERAGE_FALLBACK,
  buildCustomerKpiCard, buildFollowupBucketsCard, buildCollectionSplitCard,
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
