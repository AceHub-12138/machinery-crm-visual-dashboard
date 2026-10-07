import { describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleAdapter } from "../src/llm/zhipu.ts";
import { ScriptedAdapter } from "../src/llm/scripted.ts";
import { loadConfig } from "../src/config.ts";
import { INTENT_SCHEMA } from "../../../src/lib/voice/intents.ts";

function setup(content: unknown = '{"intent":"sales_progress"}', reasoning_content?: string) {
  const fetchImpl = vi.fn(async () => Response.json({ choices: [{ message: { content, reasoning_content } }] }));
  const adapter = new OpenAiCompatibleAdapter({ baseUrl: "http://localhost:1234/v1/", apiKey: "local", model: "test-model", fetchImpl });
  return { adapter, fetchImpl };
}

describe("本地 LLM 结构化分类", () => {
  it("非流式请求、strict schema、禁思考；只发送当前问题与意图定义", async () => {
    const { adapter, fetchImpl } = setup();
    const signal = new AbortController().signal;
    expect(await adapter.classify("这个月卖得咋样", signal)).toBe("sales_progress");
    const [url, options] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:1234/v1/chat/completions");
    expect(options.signal).toBe(signal);
    const body = JSON.parse(options.body as string);
    expect(body).toMatchObject({ stream: false, reasoning_effort: "none", temperature: 0, max_tokens: 40 });
    expect(body.response_format.json_schema).toEqual({ name: "intent", strict: true, schema: INTENT_SCHEMA });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1]).toEqual({ role: "user", content: "这个月卖得咋样" });
    expect(body.messages[0].content).not.toMatch(/经营数据快照|1,286|286 家/);
    expect(body.tools).toBeUndefined();
  });
  it.each(['{"intent":"sales_progress","spoken":"3138"}', '{"intent":"inventory_alerts"}', 'not JSON', null])(
    "拒绝模型文案和无效分类 %s", async (content) => expect(await setup(content).adapter.classify("问题")).toBe("unanswerable"),
  );
  it("reasoning-only 响应提供思考模式诊断", async () => {
    await expect(setup("", "thinking").adapter.classify("问题")).rejects.toThrow("检查 reasoning_effort");
  });
  it("HTTP 错误与网络异常不伪装成正常分类", async () => {
    const fetchImpl = vi.fn(async () => new Response("error", { status: 503 }));
    const adapter = new OpenAiCompatibleAdapter({ baseUrl: "http://local", apiKey: "local", model: "m", fetchImpl });
    await expect(adapter.classify("问题")).rejects.toThrow("HTTP 503");
    fetchImpl.mockRejectedValueOnce(new Error("offline"));
    await expect(adapter.classify("问题")).rejects.toThrow("连接失败");
  });
  it("显式空 reasoning 配置不发送该字段；模型必须来自配置", async () => {
    const { fetchImpl } = setup();
    const adapter = new OpenAiCompatibleAdapter({ baseUrl: "http://local", apiKey: "local", model: "m", reasoningEffort: "", fetchImpl });
    await adapter.classify("问题");
    const [, options] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(options.body as string).reasoning_effort).toBeUndefined();
    expect(() => new OpenAiCompatibleAdapter({ baseUrl: "http://local", apiKey: "local", model: "" })).toThrow("VOICE_LLM_MODEL");
  });
  it("兼容 stream 也透传禁思考并识别 reasoning-only", async () => {
    const fetchImpl = vi.fn(async () => new Response('data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\ndata: [DONE]\n\n'));
    const adapter = new OpenAiCompatibleAdapter({ baseUrl: "http://local", apiKey: "local", model: "m", fetchImpl });
    await expect(async () => { for await (const chunk of adapter.stream({ messages: [] })) void chunk; }).rejects.toThrow("思考模式");
    const [, options] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(options.body as string).reasoning_effort).toBe("none");
  });
  it("配置默认本地、reasoning none；无 key 的脚本分类无需快照", async () => {
    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    expect(cfg.llmReasoningEffort).toBe("none");
    expect(cfg.llmBaseUrl).toBe("http://127.0.0.1:1234/v1");
    expect(cfg.llmApiKey).toBe("");
    expect(cfg.llmModel).toBe("");
    expect(await new ScriptedAdapter({ firstTokenDelayMs: 0 }).classify("钱收回来多少了")).toBe("collection");
  });
  it("脚本分类遵守已中止和执行期间的 AbortSignal", async () => {
    const adapter = new ScriptedAdapter({ firstTokenDelayMs: 1000 });
    const controller = new AbortController();
    const pending = adapter.classify("问题", controller.signal);
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    await expect(adapter.classify("问题", controller.signal)).rejects.toThrow("cancelled");
  });
});
