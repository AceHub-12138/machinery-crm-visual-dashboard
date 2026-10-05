#!/usr/bin/env node
/**
 * 语音链路延迟报告(plan §16.2 验收:打点数据 P50/P95)。
 *
 *   node scripts/voice-latency-report.mjs [trace.jsonl] [-o docs/voice-8b-latency-report.md]
 *
 * 读取编排服务的 voice-trace.jsonl(每行一条 TurnTraceRecord),
 * 分阶段输出 P50/P95,默认打印到 stdout;给 -o 则生成 Markdown 报告骨架。
 */

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("-")) ?? "services/voice-orchestrator/logs/voice-trace.jsonl";
const outIndex = args.indexOf("-o");
const outFile = outIndex >= 0 ? args[outIndex + 1] : null;

const STAGES = [
  ["question", "提问基点"],
  ["prefetch", "预取完成"],
  ["llmFirstToken", "LLM 首字"],
  ["toolExec", "工具轮完成"],
  ["answerFull", "全答就绪"],
];

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const v = lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
  return Math.round(v * 10) / 10;
}

let records;
try {
  records = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
} catch (err) {
  console.error(`无法读取 ${file}: ${err.message}`);
  process.exit(1);
}

if (records.length === 0) {
  console.error(`${file} 中没有打点记录`);
  process.exit(1);
}

const stages = STAGES.map(([key, label]) => {
  const samples = records.map((r) => r.stages?.[key]).filter((v) => typeof v === "number");
  return { key, label, p50: percentile(samples, 50), p95: percentile(samples, 95), n: samples.length };
});
const totals = records.map((r) => r.totalMs).filter((v) => typeof v === "number");
const degraded = records.filter((r) => r.degraded).length;
const rows = stages
  .map(
    (s) =>
      `| ${s.label} | ${s.p50 == null ? "—" : `${s.p50} ms`} | ${s.p95 == null ? "—" : `${s.p95} ms`} | ${s.n} |`,
  )
  .join("\n");
const totalRow = `| 提问 → 全答(端到端) | ${
  percentile(totals, 50) == null ? "—" : `${percentile(totals, 50)} ms`
} | ${percentile(totals, 95) == null ? "—" : `${percentile(totals, 95)} ms`} | ${totals.length} |`;

const markdown = `# 8b 打点延迟报告(voice-orchestrator)

- 数据源:\`${file}\`
- 采样轮数:${records.length}(其中降级轮 ${degraded})
- 生成时间:${new Date().toISOString()}

## 各阶段耗时(相对提问 t0,毫秒)

| 阶段 | P50 | P95 | 样本数 |
| --- | --- | --- | --- |
${rows}
${totalRow}

> 说明:8b 无真实 TTS;「全答就绪」= 答案卡片数据构造完成并广播的时刻。
> P95 之后的等待由大屏 thinking 兜底(plan §4:thinking 超 8s 降级)。
`;

if (outFile) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outFile, markdown, "utf8");
  console.log(`报告已写入 ${outFile}`);
} else {
  console.log(markdown);
}
