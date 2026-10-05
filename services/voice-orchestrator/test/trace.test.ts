import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { percentile, summarizeTraces, TraceSink, TurnTracer, type TurnTraceRecord } from "../src/trace/metrics.ts";
import { redactRecord, redactText } from "../src/guard/redaction.ts";

describe("trace — 全程打点(B④)", () => {
  it("阶段标记:question=0,首次命中生效,finish 汇总 totalMs", () => {
    const tracer = new TurnTracer("s1", 0, "本月销售情况怎么样?", 1000);
    expect(tracer.elapsed).toEqual({ question: 0, prefetch: null, llmFirstToken: null, toolExec: null, answerFull: null });
    tracer.mark("prefetch", 1012);
    tracer.mark("prefetch", 1020); // 二次标记忽略
    tracer.mark("llmFirstToken", 1038);
    tracer.mark("answerFull", 1074);
    const record = tracer.finish({ source: "payload", card: "target-progress", degraded: false }, 1074);
    expect(record.stages).toEqual({ question: 0, prefetch: 12, llmFirstToken: 38, toolExec: null, answerFull: 74 });
    expect(record.totalMs).toBe(74);
    expect(record.source).toBe("payload");
  });

  it("percentile:P50/P95 插值", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5.5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(9.5);
  });

  it("summarizeTraces 分阶段聚合 + 降级轮计数", () => {
    const mk = (over: Partial<TurnTraceRecord>): TurnTraceRecord => ({
      ts: "t", sessionId: "s", turn: 0, question: "q",
      stages: { question: 0, prefetch: 10, llmFirstToken: 30, toolExec: null, answerFull: 60 },
      source: "payload", card: null, degraded: false, totalMs: 60,
      ...over,
    });
    const summary = summarizeTraces([
      mk({}),
      mk({ stages: { question: 0, prefetch: 30, llmFirstToken: 90, toolExec: null, answerFull: 200 }, totalMs: 200, degraded: true }),
    ]);
    expect(summary.turns).toBe(2);
    expect(summary.degradedTurns).toBe(1);
    expect(summary.stages.prefetch).toEqual({ p50: 20, p95: 29, samples: 2 });
    expect(summary.total.p50).toBe(130);
  });

  it("TraceSink(null) 不落盘也不抛", async () => {
    const sink = new TraceSink(null);
    const tracer = new TurnTracer("s", 0, "q", 1);
    await sink.append(tracer.finish({ source: "payload", card: null, degraded: false }, 2));
  });
});

describe("redaction — 日志脱敏(F;沿用 step3 约定;2026-09-28 审核后重写)", () => {
  it("结构化记录:敏感键整字段打码(不区分大小写、包含匹配),其余保留", () => {
    const out = redactRecord({
      publicId: "pub-abc",
      nested: { apiKey: "k", keep: 1 },
      list: [{ authorization: "Bearer x", ok: "y" }],
      // 审核发现的大小写/变体键名
      Authorization: "Bearer sk-x",
      llmApiKey: "sk-y",
      accessToken: "at-z",
    });
    expect(out).toEqual({
      publicId: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", keep: 1 },
      list: [{ authorization: "[REDACTED]", ok: "y" }],
      Authorization: "[REDACTED]",
      llmApiKey: "[REDACTED]",
      accessToken: "[REDACTED]",
    });
  });

  it("自由文本:键值对形态(Bearer 连 token 一起打码)", () => {
    const out = redactText("authorization: Bearer sk-SECRET");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("sk-SECRET");
    expect(out).not.toContain("Bearer");
    expect(redactText("token=abc&x=1")).toContain("[REDACTED]");
  });

  it("自由文本:JSON 形态(键名带引号)", () => {
    const out = redactText('{"publicId":"abc123"}');
    expect(out).not.toContain("abc123");
    const out2 = redactText('{"authorization":"Bearer sk-1"}');
    expect(out2).not.toContain("sk-1");
  });

  it("自由文本:URL 路径形态的 publicId", () => {
    const out = redactText("GET /api/screen/sales/abc123 200");
    expect(out).not.toContain("abc123");
    expect(out).toContain("[REDACTED]");
  });

  it("非敏感内容原样保留", () => {
    expect(redactText("question=本月销售情况怎么样?")).not.toContain("[REDACTED]");
    expect(redactText("GET /api/screen/crm 200 in 56ms")).not.toContain("[REDACTED]");
  });

  it("打点记录序列化后不含 publicId 字段(防落盘红线)", () => {
    const record = {
      ts: "t", sessionId: "s", turn: 0, question: "q",
      stages: { question: 0, prefetch: 1, llmFirstToken: 2, toolExec: null, answerFull: 3 },
      source: "payload", card: null, degraded: false, totalMs: 3,
      publicId: "pub-abc", // 即使未来有人误加字段,落盘前也会被打码
    };
    const redacted = redactRecord(record) as Record<string, unknown>;
    expect(JSON.stringify(redacted)).not.toContain("pub-abc");
    expect(redacted.publicId).toBe("[REDACTED]");
  });
});

describe("redaction — 2026-09-30 审核修复(M2/M3)", () => {
  it("结构化记录:延迟/计数类键名不误打码,凭证键照常打码", () => {
    const out = redactRecord({
      stages: { question: 0, llmFirstToken: 38 },
      usage: { tokens: 12, totalTokens: 40, promptTokens: 28 },
      hubToken: "h",
      nested: { accessToken: "a", apiKey: "k" },
    });
    expect(out).toEqual({
      stages: { question: 0, llmFirstToken: 38 },
      usage: { tokens: 12, totalTokens: 40, promptTokens: 28 },
      hubToken: "[REDACTED]",
      nested: { accessToken: "[REDACTED]", apiKey: "[REDACTED]" },
    });
  });

  it("TraceSink 落盘后 stages 数值完整保留", async () => {
    const dir = await mkdtemp(join(tmpdir(), "voice-trace-"));
    const file = join(dir, "t.jsonl");
    const sink = new TraceSink(file);
    const tracer = new TurnTracer("s", 0, "q", 1000);
    tracer.mark("prefetch", 1012);
    tracer.mark("llmFirstToken", 1038);
    tracer.mark("answerFull", 1074);
    await sink.append(tracer.finish({ source: "payload", card: null, degraded: false }, 1074));
    const line = JSON.parse((await readFile(file, "utf8")).trim());
    expect(line.stages.llmFirstToken).toBe(38);
    expect(line.stages.prefetch).toBe(12);
  });

  const leaks: Array<[string, string[]]> = [
    ["VOICE_LLM_API_KEY=sk-abcdef123456", ["abcdef123456"]],
    ["VOICE_HUB_TOKEN=hubsecret9", ["hubsecret9"]],
    ["calling with Bearer abcdefgh12345678 now", ["abcdefgh12345678"]],
    ["key is sk-ABCDEFGH12345678", ["ABCDEFGH12345678"]],
    ["https://admin:P@ssw0rd@host.example/x", ["admin:", "P@ssw0rd", "ssw0rd"]],
    ["mcp url=https://h.example/x?token=zz99&a=1", ["zz99"]],
    ["public id pub_ABC123 loaded", ["pub_ABC123"]],
    ["password: 'hunter2'", ["hunter2"]],
    ['{"publicId": "abc123", "ok": 1}', ["abc123"]],
  ];
  it.each(leaks)("自由文本不泄露:%s", (input, secrets) => {
    const out = redactText(input);
    for (const s of secrets) expect(out).not.toContain(s);
    expect(out).toContain("[REDACTED]");
  });

  const keeps = [
    "(origin policy: local-only, auth: enabled)",
    "stage llmFirstToken: 38ms",
    "WS hub listening on ws://127.0.0.1:3210 (x)",
    "mcp url=https://h.example/x?token=zz99&a=1",
  ];
  it("自由文本不误伤:非敏感片段原样保留", () => {
    expect(redactText(keeps[0])).toBe(keeps[0]);
    expect(redactText(keeps[1])).toBe(keeps[1]);
    expect(redactText(keeps[2])).toBe(keeps[2]);
    expect(redactText(keeps[3])).toContain("&a=1");
    expect(redactText(keeps[3])).toContain("h.example/x");
  });

  it("已打码值不被二次匹配,且 redactText 幂等(审核 2b)", () => {
    expect(redactText("x?token=zz99&a=1")).toBe("x?token=[REDACTED]&a=1");
    expect(redactText("token=[REDACTED]")).toBe("token=[REDACTED]");
    for (const [input] of leaks) {
      const once = redactText(input);
      expect(once).not.toContain("]]");
      expect(redactText(once)).toBe(once);
    }
  });
});
