import { describe, expect, it } from "vitest";
import { routeQuestion, ScriptedAdapter } from "../src/llm/scripted.ts";
import { buildInjectedContext } from "../src/datasource/inject-context.ts";
import { verifyAnswerNumbers } from "../src/datasource/inject-context.ts";
import fixture from "../fixtures/public-sales-screen.json";
import { validatePublicPayload, type PublicSalesScreenPayload } from "../../../src/lib/voice/public-payload.ts";
import { VOICE_COVERAGE_FALLBACK } from "../../../src/lib/voice/card-builders.ts";
import { DEMO_QUESTIONS } from "../../../src/lib/voice/demo-questions.ts";

const payload = validatePublicPayload(fixture) as PublicSalesScreenPayload;
const label = payload.period.label;

describe("scripted — 问题路由(8 条验收问题全命中)", () => {
  for (const demo of DEMO_QUESTIONS) {
    it(`#${demo.id} ${demo.question} → ${demo.expectCard}`, () => {
      const routed = routeQuestion(demo.question, payload, label);
      if (demo.expectCard === "unanswerable") {
        expect(routed.unanswerable).toBe(true);
        expect(routed.spoken).toBe(VOICE_COVERAGE_FALLBACK);
      } else {
        expect(routed.unanswerable).toBe(false);
        expect(routed.cardId).toBe(demo.expectCard);
        expect(routed.card?.kind).toBe(demo.expectCard);
        // 答案里的数字必须能在注入口径里构造出来(即非编造)
        expect(routed.spoken.length).toBeGreaterThan(4);
      }
    });
  }

  it("数字护栏:路由产出的播报文本全部通过 verifyAnswerNumbers(注入快照)", () => {
    const snapshot = buildInjectedContext(payload);
    for (const q of DEMO_QUESTIONS.filter((d) => d.expectCard !== "unanswerable")) {
      const routed = routeQuestion(q.question, payload, label);
      expect(verifyAnswerNumbers(routed.spoken, snapshot).ok).toBe(true);
    }
  });

  it("fail-closed:未匹配问题一律降级", () => {
    for (const q of ["明天天气怎么样?", "利润率多少?", "华南退货率是多少?"]) {
      const routed = routeQuestion(q, payload, label);
      expect(routed.unanswerable).toBe(true);
      expect(routed.spoken).toBe(VOICE_COVERAGE_FALLBACK);
    }
  });
});

describe("scripted — 适配器形态(与真实 LLM 同构)", () => {
  it("stream:delta + done,fullText 与 delta 一致", async () => {
    const adapter = new ScriptedAdapter({ firstTokenDelayMs: 0 });
    adapter.usePayload(payload);
    const chunks = [];
    for await (const chunk of adapter.stream({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "本月销售情况怎么样?" },
      ],
    })) {
      chunks.push(chunk);
    }
    expect(chunks[0].type).toBe("delta");
    const done = chunks[chunks.length - 1];
    expect(done).toMatchObject({ type: "done", finishReason: "stop" });
    expect((chunks[0] as { text: string }).text).toBe((done as { fullText: string }).fullText);
  });

  it("timeoutAfterMs:模拟超时 → done(timeout)", async () => {
    const adapter = new ScriptedAdapter({ timeoutAfterMs: 10 });
    adapter.usePayload(payload);
    const chunks = [];
    for await (const chunk of adapter.stream({ messages: [{ role: "user", content: "q" }] })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ type: "done", fullText: "", finishReason: "timeout" }]);
  });
});
