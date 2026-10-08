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
const playback = records.map(r => r.playbackStartMs).filter(v => typeof v === "number" && Number.isFinite(v));
const playbackRow = `| 提问 → 收到首音回报 | ${percentile(playback,50) ?? "—"} ms | ${percentile(playback,95) ?? "—"} ms | ${playback.length} |`;
const outcomes = records.reduce((counts,r) => { if (r.playbackOutcome) counts[r.playbackOutcome] = (counts[r.playbackOutcome] ?? 0) + 1; return counts; }, {});
const predictionRows = ["hit", "miss", "none"].map(group => {
  const rows=records.filter(r=>(r.speculative??"none")===group);
  const samples=rows.map(r=>r.playbackStartMs).filter(v=>typeof v==='number'&&Number.isFinite(v));
  return `| ${group} | ${rows.length} | ${percentile(samples,50)??"—"} ms | ${percentile(samples,95)??"—"} ms | ${samples.length} |`;
}).join("\n");
const rows = stages
  .map(
    (s) =>
      `| ${s.label} | ${s.p50 == null ? "—" : `${s.p50} ms`} | ${s.p95 == null ? "—" : `${s.p95} ms`} | ${s.n} |`,
  )
  .join("\n");
const totalRow = `| 提问 → 全答(端到端) | ${
  percentile(totals, 50) == null ? "—" : `${percentile(totals, 50)} ms`
} | ${percentile(totals, 95) == null ? "—" : `${percentile(totals, 95)} ms`} | ${totals.length} |`;

const markdown = `# 语音打点延迟报告(voice-orchestrator)

- 数据源:\`${file}\`
- 采样轮数:${records.length}(其中降级轮 ${degraded})
- 播放结果:${JSON.stringify(outcomes)}
- 生成时间:${new Date().toISOString()}

## 各阶段耗时(相对提问 t0,毫秒)

| 阶段 | P50 | P95 | 样本数 |
| --- | --- | --- | --- |
${rows}
${totalRow}
${playbackRow}

## 预测性合成分组

| 分组 | 记录数 | 上传后 → 首音回报 P50 | P95 | 有首音样本 |
| --- | --- | --- | --- | --- |
${predictionRows}

> 「全答就绪」= 答案卡构造完成；不代表首音。「收到首音回报」= 提问到hub收到浏览器首个样本开始回报，含回传耗时，不跨机器混算时钟。
> 语音上传轮的首音回报是 L1 的服务端观察值，含回传；文字提问轮不能算 VAD L1。真实 L1/L2 以浏览器或同步现场计时为准，分类与预测 TTS 并行，阶段耗时不能直接相加。
> Task 6接入VAD/ASR后才能按L1/L2做现场验收；旧记录缺播放字段时不计入首音样本。
`;

if (outFile) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outFile, markdown, "utf8");
  console.log(`报告已写入 ${outFile}`);
} else {
  console.log(markdown);
}
