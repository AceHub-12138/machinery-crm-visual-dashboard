/**
 * 离线确定性适配器(8b 无 LLM Key 时的默认实现)。
 *
 * 职责与真适配器完全同构:消费注入快照 → 产出 播报文案 + 卡片选型。
 * 路由是纯函数(可单测),答案只引用快照口径(card-builders 直接从
 * payload 构造)——它是「主路径零工具轮」的活样例,也是防幻觉用例的
 * 对照实现:任何 payload 没有的问题一律 fail-closed 降级。
 */

import {
  buildBriefCard,
  buildCompletionRingCard,
  buildCustomersShipmentsCard,
  buildRegionCard,
  buildTargetProgressCardFromPublic,
  VOICE_COVERAGE_FALLBACK,
} from "../../../../src/lib/voice/card-builders.ts";
import { formatMoney } from "../../../../src/lib/format.ts";
import type { PublicSalesScreenPayload } from "../../../../src/lib/voice/public-payload.ts";
import type { CardTemplateId } from "../../../../src/lib/voice/protocol.ts";
import type { AnswerCardData } from "../../../../src/lib/voice/session-machine.ts";
import type { LlmAdapter, LlmChunk, LlmCompleteRequest } from "./types.ts";

export type RoutedAnswer = {
  cardId: CardTemplateId | null;
  card: AnswerCardData | null;
  spoken: string;
  /** true = 覆盖缺口,走降级话术(不是系统错误) */
  unanswerable: boolean;
};

/** 话术标题(统计期 label 由调用处传入)。 */
export function routeQuestion(
  question: string,
  payload: PublicSalesScreenPayload,
  periodLabel: string,
): RoutedAnswer {
  const q = question.toLowerCase();

  if (matches(q, ["销售", "合同额", "营业额", "业绩", "目标进度", "卖了"])) {
    const card = buildTargetProgressCardFromPublic(payload.collection, periodLabel);
    return { cardId: card.kind, card, spoken: card.spoken, unanswerable: false };
  }
  if (matches(q, ["完成率", "目标完成", "差多少", "还差"])) {
    const card = buildCompletionRingCard(payload.collection, periodLabel);
    return { cardId: card.kind, card, spoken: card.spoken, unanswerable: false };
  }
  if (matches(q, ["区域", "分布", "哪里", "哪些省", "发运分布"])) {
    const card = buildRegionCard(payload.delivery, periodLabel);
    return { cardId: card.kind, card, spoken: card.spoken, unanswerable: false };
  }
  if (matches(q, ["发货安排", "发运安排", "发货计划", "近期发货", "近期发运", "发货明细", "里程碑"])) {
    const card = buildCustomersShipmentsCard(payload.delivery, periodLabel);
    return { cardId: card.kind, card, spoken: card.spoken, unanswerable: false };
  }
  if (matches(q, ["新增客户", "多少客户", "几家", "客户总数", "新客户"])) {
    const card = buildBriefCard(
      `${periodLabel} · 客户概览`,
      [
        `本月新增客户 ${payload.kpis.periodNewCustomers} 家。`,
        `客户总数 ${payload.kpis.totalCustomers} 家。`,
      ],
    );
    return { cardId: card.kind, card, spoken: card.spoken, unanswerable: false };
  }
  if (matches(q, ["待办", "跟进", "回访"])) {
    const card = buildBriefCard(
      `${periodLabel} · 跟进待办`,
      [
        `今日待跟进 ${payload.kpis.todayFollowUp} 项,七日内 ${payload.kpis.sevenDayFollowUp} 项。`,
        `其中逾期 ${payload.kpis.overdueFollowUp} 项,建议优先处理。`,
      ],
    );
    return { cardId: card.kind, card, spoken: card.spoken, unanswerable: false };
  }
  if (matches(q, ["回款", "收款", "回款率", "货款"])) {
    const c = payload.collection;
    const card = buildBriefCard(
      `${periodLabel} · 回款概览`,
      [
        `累计回款率 ${c.collectionRate}%,已回 ${fmt(c.totalPaidAmount)},未回 ${fmt(c.totalUnpaidAmount)}。`,
      ],
    );
    return { cardId: card.kind, card, spoken: card.spoken, unanswerable: false };
  }

  // fail-closed:快照口径覆盖不到的问题,一律原句降级(plan §16.2 F)
  return {
    cardId: "brief",
    card: buildBriefCard("小川", [VOICE_COVERAGE_FALLBACK]),
    spoken: VOICE_COVERAGE_FALLBACK,
    unanswerable: true,
  };
}

function matches(q: string, keywords: string[]): boolean {
  return keywords.some((word) => q.includes(word));
}

function fmt(amount: string): string {
  // 与卡片/快照同一 formatMoney 口径——护栏要求答案数字必须能在快照中找到
  return formatMoney(Number(amount));
}

export type ScriptedAdapterOptions = {
  /** 模拟首 token 延迟(毫秒;打点用,默认 30ms) */
  firstTokenDelayMs?: number;
  /** 强制模拟超时场景(错误路径验收) */
  timeoutAfterMs?: number | null;
};

export class ScriptedAdapter implements LlmAdapter {
  readonly name = "scripted";
  private payload: PublicSalesScreenPayload | null = null;
  private periodLabel = "";
  private readonly options: ScriptedAdapterOptions;

  constructor(options: ScriptedAdapterOptions = {}) {
    this.options = options;
  }

  /** 编排在提问前把预取 payload 交给适配器(代替真实 LLM 的上下文注入)。 */
  usePayload(payload: PublicSalesScreenPayload): void {
    this.payload = payload;
    this.periodLabel = payload.period.label;
  }

  async *stream(request: LlmCompleteRequest): AsyncIterable<LlmChunk> {
    const question = [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const timeoutAfterMs = this.options.timeoutAfterMs ?? null;
    if ((timeoutAfterMs ?? 0) > 0) {
      await delay(timeoutAfterMs!, request.signal);
      yield { type: "done", fullText: "", finishReason: "timeout" };
      return;
    }
    await delay(this.options.firstTokenDelayMs ?? 30, request.signal);
    if (!this.payload) {
      yield { type: "done", fullText: VOICE_COVERAGE_FALLBACK, finishReason: "stop" };
      return;
    }
    const routed = routeQuestion(question, this.payload, this.periodLabel);
    yield { type: "delta", text: routed.spoken };
    yield { type: "done", fullText: routed.spoken, finishReason: "stop" };
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}
