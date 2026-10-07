#!/usr/bin/env node
/** 真实本地模型验收；模型 ID 只从环境变量读取，不落报告或源码。
 * VOICE_LLM_MODEL=<loaded-model> node --experimental-strip-types scripts/voice-intent-report.mjs [report.md]
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { OpenAiCompatibleAdapter } from "../services/voice-orchestrator/src/llm/zhipu.ts";
import { buildInjectedContext, verifyAnswerNumbers } from "../services/voice-orchestrator/src/datasource/inject-context.ts";
import { percentile } from "../services/voice-orchestrator/src/trace/metrics.ts";
import { INTENT_CASES } from "../src/lib/voice/intent-cases.ts";
import { DEMO_QUESTIONS } from "../src/lib/voice/demo-questions.ts";
import { classifyScriptedQuestion } from "../src/lib/voice/intents.ts";
import { buildIntentAnswer } from "../src/lib/voice/intent-answers.ts";
import { validatePublicPayload } from "../src/lib/voice/public-payload.ts";

const baseUrl = process.env.VOICE_LLM_BASE_URL ?? "http://127.0.0.1:1234/v1";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname), "本验收脚本只允许本机模型端点");
const adapter = new OpenAiCompatibleAdapter({
  baseUrl, apiKey: process.env.VOICE_LLM_API_KEY || "local-placeholder",
  model: process.env.VOICE_LLM_MODEL ?? "", reasoningEffort: process.env.VOICE_LLM_REASONING_EFFORT ?? "none",
});
const payload = validatePublicPayload(JSON.parse(readFileSync(new URL("../services/voice-orchestrator/fixtures/public-sales-screen.json", import.meta.url), "utf8")));
const snapshot = buildInjectedContext(payload);
const cases = [
  ...DEMO_QUESTIONS.map((demo) => ({ question: demo.question, expected: classifyScriptedQuestion(demo.question) })),
  ...INTENT_CASES,
];
await adapter.classify("本月销售情况怎么样", AbortSignal.timeout(15000)); // 预热不计入样本
const results = [];
for (let round = 1; round <= 2; round++) {
  for (const test of cases) {
    const started = performance.now();
    const intent = await adapter.classify(test.question, AbortSignal.timeout(15000));
    const ms = performance.now() - started;
    const answer = buildIntentAnswer(intent, payload);
    const numbersOk = verifyAnswerNumbers(answer.spoken, snapshot).ok;
    const speechOk = answer.sentences.every((sentence) => !/[\d¥%]/.test(sentence.spokenText));
    const ok = intent === test.expected && numbersOk && speechOk;
    results.push({ round, ...test, intent, ms, numbersOk, speechOk, ok });
    console.log(`${ok ? "PASS" : "FAIL"} ${ms.toFixed(1)}ms ${test.question} → ${intent}`);
  }
}
const times = results.map((result) => result.ms);
const p50 = percentile(times, 50);
const p95 = percentile(times, 95);
const passed = results.filter((result) => result.ok).length;
const report = `# 8c 阶段 1–2 本地意图分类验收

- 数据源：本仓公开 fixture；真实本机 OpenAI 兼容模型，strict JSON Schema，禁思考，temperature=0。
- 采样：8 条对话台问题 + 原型 13 条问题，各 2 轮，共 ${results.length} 轮；预热不计入。
- 分类与播报检查通过：${passed}/${results.length}。
- 完整分类耗时：P50 **${p50}ms**，P95 **${p95}ms**；P50 ≤500ms：${p50 <= 500 ? "通过" : "未通过"}。
- 数字检查：${results.filter((result) => result.numbersOk).length}/${results.length}；中文读法检查：${results.filter((result) => result.speechOk).length}/${results.length}。
- 模型不接收业务快照；卡片和显示播报由同一 builder 生成；TTS 读法单独生成。
- 本阶段未接入库存，两条库存提问预期为 unanswerable。此处不代表 ASR、TTS、首音延迟或展厅现场验收。
- 分类计时从适配器调用开始到完整 JSON 解析结束，不含对话台动画或逐字效果。

| 轮次 | 问题 | 预期 | 实际 | 分类耗时 | 结果 |
| --- | --- | --- | --- | --- | --- |
${results.map((result) => `| ${result.round} | ${result.question} | ${result.expected} | ${result.intent} | ${result.ms.toFixed(1)}ms | ${result.ok ? "通过" : "失败"} |`).join("\n")}
`;
if (process.argv[2]) writeFileSync(process.argv[2], report);
else console.log(report);
if (passed !== results.length || p50 > 500) process.exitCode = 1;
