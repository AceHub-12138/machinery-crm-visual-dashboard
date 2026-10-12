"use client";
import type { ReactNode, RefObject } from "react";
import type { AnswerCardData } from "@/lib/voice/session-machine";
import { ProgressCard } from "./ProgressCard";
import { CompletionRingCard } from "./CompletionRingCard";
import { RegionCard } from "./RegionCard";
import { CustomersShipmentsCard } from "./CustomersShipmentsCard";
import { BriefCard } from "./BriefCard";
import { CustomerKpiCard, FollowupBucketsCard, CollectionSplitCard } from "./CardMetrics";

export type CardTemplateRefs = { barFillRef: RefObject<HTMLSpanElement | null>; launchAt: number; pageIndex: number };
type CardTemplate<C extends AnswerCardData> = (props: {card: C} & CardTemplateRefs) => ReactNode;
export const CARD_TEMPLATES: { [K in AnswerCardData["kind"]]: CardTemplate<Extract<AnswerCardData, {kind: K}>> } = {
  "target-progress": ({card, barFillRef}) => <ProgressCard card={card} barFillRef={barFillRef} />,
  "completion-ring": ({card}) => <CompletionRingCard card={card} />,
  region: ({card}) => <RegionCard card={card} />,
  "customers-shipments": ({card, pageIndex}) => <CustomersShipmentsCard card={card} pageIndex={pageIndex} />,
  "customer-kpi": ({card}) => <CustomerKpiCard card={card} />,
  "followup-buckets": ({card}) => <FollowupBucketsCard card={card} />,
  "collection-split": ({card}) => <CollectionSplitCard card={card} />,
  brief: () => <BriefCard />,
};
export function renderCardTemplate(card: AnswerCardData, refs: CardTemplateRefs): ReactNode {
  if (!Object.hasOwn(CARD_TEMPLATES, card.kind)) return null;
  return CARD_TEMPLATES[card.kind]({card, ...refs} as never);
}

/** Default tier is a presentation concern; wire card shapes remain unchanged. */
export const CARD_TIERS: Record<AnswerCardData["kind"], "s" | "m" | "l"> = {
  brief: "s", "target-progress": "m", "completion-ring": "m", region: "l",
  "customers-shipments": "l", "customer-kpi": "m", "followup-buckets": "m", "collection-split": "m",
};
