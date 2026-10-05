/**
 * 智谱 GLM 适配器(OpenAI 兼容 chat/completions 流式;8b 默认云端实现)。
 *
 * base URL / model / key 全部来自环境变量(config.ts),不落仓。
 * 超时由 orchestrator 统一守(VOICE_TIMING.thinkingMaxMs),本适配器
 * 遵守外部 AbortSignal;连接失败抛 LlmError(code=llm_unavailable)。
 */

import type { LlmAdapter, LlmChunk, LlmCompleteRequest } from "./types.ts";
import { LlmError } from "./types.ts";

type SseChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string;
  }>;
};

export type OpenAiCompatibleOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 温度等采样参数留给调用方扩展;8b 只用默认 */
  fetchImpl?: typeof fetch;
};

export class OpenAiCompatibleAdapter implements LlmAdapter {
  readonly name: string;
  private readonly fetchImpl: typeof fetch;
  /** 含 apiKey:必须私有,防止 log(adapter) 泄露(安全审核项) */
  readonly #options: OpenAiCompatibleOptions;

  constructor(options: OpenAiCompatibleOptions) {
    this.#options = options;
    this.name = `openai-compatible:${options.model}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async *stream(request: LlmCompleteRequest): AsyncIterable<LlmChunk> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.#options.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        signal: request.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.#options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.#options.model,
          stream: true,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          ...(request.tools && request.tools.length > 0
            ? {
                tools: request.tools.map((tool) => ({
                  type: "function",
                  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
                })),
              }
            : {}),
        }),
      });
    } catch (err) {
      throw new LlmError(`LLM 连接失败: ${(err as Error).message}`);
    }
    if (!response.ok || !response.body) {
      throw new LlmError(`LLM 响应异常: HTTP ${response.status}`);
    }

    let fullText = "";
    let finishReason: "stop" | "tool_calls" = "stop";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        break; // abort/断流:交由上层按已收内容处理
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, sep).trim();
        buffer = buffer.slice(sep + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let parsed: SseChunk | null;
        try {
          parsed = JSON.parse(data) as SseChunk;
        } catch {
          continue;
        }
        const choice = parsed?.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) {
          fullText += delta.content;
          yield { type: "delta", text: delta.content };
        }
        const toolCalls = delta?.tool_calls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          finishReason = "tool_calls";
          for (const call of toolCalls) {
            if (call?.function?.name) {
              yield {
                type: "tool_call",
                call: {
                  id: call.id ?? "",
                  name: call.function.name,
                  arguments: call.function.arguments ?? "{}",
                },
              };
            }
          }
        }
        if (choice?.finish_reason === "tool_calls") finishReason = "tool_calls";
      }
    }

    yield { type: "done", fullText, finishReason };
  }
}
