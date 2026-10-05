"use client";

import type { ReactNode, RefObject } from "react";
import type { AnswerCardData } from "@/lib/voice/session-machine";
import { ProgressCard } from "./ProgressCard";
import { CompletionRingCard } from "./CompletionRingCard";
import { RegionCard } from "./RegionCard";
import { CustomersShipmentsCard } from "./CustomersShipmentsCard";
import { BriefCard } from "./BriefCard";

/**
 * 答案卡模板注册表(plan §16.2 E「模板注册表化」)。
 *
 * kind → 渲染组件的唯一映射;AnswerCard 只认注册表,新增模板不改发射管线。
 * 共享编排约定:每个模板渲染自己的内层 .overlay-card-body,
 * 并把打字机正文 span 交给 AnswerCard 的 rAF 循环逐帧写。
 */

export type CardTemplateRefs = {
  /** 打字机正文(AnswerCard 编排层逐帧写 textContent) */
  spokenRef: RefObject<HTMLSpanElement | null>;
  /** 进度条填充(仅 target-progress 使用;目标宽度由编排层写一次) */
  barFillRef: RefObject<HTMLSpanElement | null>;
};

type CardTemplate<C extends AnswerCardData> = (props: { card: C } & CardTemplateRefs) => ReactNode;

export const CARD_TEMPLATES: {
  [K in AnswerCardData["kind"]]: CardTemplate<Extract<AnswerCardData, { kind: K }>>;
} = {
  "target-progress": ({ card, spokenRef, barFillRef }) => (
    <ProgressCard card={card} spokenRef={spokenRef} barFillRef={barFillRef} />
  ),
  "completion-ring": ({ card, spokenRef }) => <CompletionRingCard card={card} spokenRef={spokenRef} />,
  region: ({ card, spokenRef }) => <RegionCard card={card} spokenRef={spokenRef} />,
  "customers-shipments": ({ card, spokenRef }) => (
    <CustomersShipmentsCard card={card} spokenRef={spokenRef} />
  ),
  brief: ({ card, spokenRef }) => <BriefCard card={card} spokenRef={spokenRef} />,
};

export function renderCardTemplate(card: AnswerCardData, refs: CardTemplateRefs): ReactNode {
  // Object.hasOwn:防原型链键("constructor" 等)取到 Object 构造器(安全审核项)
  if (!Object.hasOwn(CARD_TEMPLATES, card.kind)) return null;
  const render = CARD_TEMPLATES[card.kind];
  return render({ card, ...refs } as never);
}
