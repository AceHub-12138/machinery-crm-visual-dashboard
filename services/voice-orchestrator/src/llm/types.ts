/**
 * LLM 适配器接口(plan §16.2 C:LLM 全部在适配器后面;8c 换实时语音
 * 模型时只动这里,协议与 UI 零改动)。
 *
 * OpenAI 兼容 chat-completions 流式语义;工具轮由调用方(orchestrator)
 * 决定是否继续——主路径预取注入,零工具轮。
 */

import type { Intent } from "../../../../src/lib/voice/intents.ts";

export type LlmMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** tool 消息的工具名(OpenAI 兼容 name 字段的投影) */
  name?: string;
};

export type LlmToolCall = {
  id: string;
  name: string;
  /** JSON 字符串参数(OpenAI 兼容) */
  arguments: string;
};

export type LlmChunk =
  | { type: "delta"; text: string }
  | { type: "tool_call"; call: LlmToolCall }
  | { type: "done"; fullText: string; finishReason: "stop" | "tool_calls" | "aborted" | "timeout" };

export type LlmCompleteRequest = {
  messages: LlmMessage[];
  /** 声明可用工具后,适配器才可能产生 tool_call(不声明则纯文本) */
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  signal?: AbortSignal;
};

export interface LlmAdapter {
  readonly name: string;
  /** 只接收问题与意图定义，不接收业务快照。 */
  classify(question: string, signal?: AbortSignal): Promise<Intent>;
  stream(request: LlmCompleteRequest): AsyncIterable<LlmChunk>;
}

export class LlmError extends Error {
  readonly code: "llm_timeout" | "llm_unavailable";

  constructor(message: string, code: "llm_timeout" | "llm_unavailable" = "llm_unavailable") {
    super(message);
    this.name = "LlmError";
    this.code = code;
  }
}
