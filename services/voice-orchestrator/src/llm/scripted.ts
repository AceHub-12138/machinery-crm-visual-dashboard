/** 离线意图分类器；classify 不依赖 payload。stream/usePayload 只保留旧演示兼容。 */

import { buildIntentAnswer } from "../../../../src/lib/voice/intent-answers.ts";
import { classifyScriptedQuestion, type Intent } from "../../../../src/lib/voice/intents.ts";
import { VOICE_COVERAGE_FALLBACK } from "../../../../src/lib/voice/card-builders.ts";
import type { PublicSalesScreenPayload } from "../../../../src/lib/voice/public-payload.ts";
import type { LlmAdapter, LlmChunk, LlmCompleteRequest } from "./types.ts";
import { LlmError } from "./types.ts";

export type RoutedAnswer = ReturnType<typeof buildIntentAnswer>;

/** 兼容原有离线演示；卡片构造与真实分类主路径共用同一入口。 */
export function routeQuestion(question: string, payload: PublicSalesScreenPayload, periodLabel: string): RoutedAnswer {
  return buildIntentAnswer(classifyScriptedQuestion(question), payload, periodLabel);
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

  async classify(question: string, signal?: AbortSignal): Promise<Intent> {
    if ((this.options.timeoutAfterMs ?? 0) > 0) {
      await delay(this.options.timeoutAfterMs!, signal);
      throw new LlmError("LLM 分类超时", "llm_timeout");
    }
    await delay(this.options.firstTokenDelayMs ?? 30, signal);
    return classifyScriptedQuestion(question);
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
    if (signal?.aborted) { reject(signal.reason ?? new Error("aborted")); return; }
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
