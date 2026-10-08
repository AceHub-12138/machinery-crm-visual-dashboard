/**
 * 全程打点(plan §16.2 B④):question → prefetch → llm_first_token →
 * tool_exec → answer_full,毫秒级;JSONL 落盘 + P50/P95 汇总。
 *
 * 打点记录经 redactRecord 脱敏后才落盘(§10.3);publicId 永不出现在
 * 记录里。延迟报告由 scripts/voice-latency-report.mjs 消费同一 JSONL。
 */

import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { redactRecord } from "../guard/redaction.ts";
import type { SkippedPlaybackSentence } from "../../../../src/lib/voice/protocol.ts";

export type TurnStage = "question" | "prefetch" | "llmFirstToken" | "toolExec" | "answerFull";

export type TurnTraceRecord = {
  style?: string;
  styleFallback?: string;
  speculative?: "hit" | "miss" | "none";
  uploadMs?: number;
  asrRoundTripMs?: number;
  ts: string;
  sessionId: string;
  turn: number;
  question: string;
  stages: {
    question: number;
    prefetch: number | null;
    llmFirstToken: number | null;
    toolExec: number | null;
    answerFull: number | null;
  };
  source: "payload" | "mcp";
  card: string | null;
  degraded: boolean;
  totalMs: number | null;
  /** 完整结构化分类的耗时；与旧流式首 token 指标分开。 */
  asrMs?: number | null;
  playbackStartMs?: number | null;
  playbackOutcome?: "drained" | "failed" | "timeout" | "cancelled";
  playbackSkipped?: SkippedPlaybackSentence[];
  ttsFirstByteMs?: number;
  voiceLocalFirstByteMs?: number;
  ttsRegenerated?: number;
  ttsTruncated?: number;
  ttsFail?: number;
  classifyMs?: number;
  /** 备用数字护栏异常，仅告警，不用模型文字替换模板。 */
  numberGuardViolations?: string[];
};

export class TurnTracer {
  private startedAt = 0;
  private readonly marks = new Map<TurnStage, number>();
  readonly startedWallClock: string;
  readonly sessionId: string;
  readonly turn: number;
  readonly question: string;

  constructor(sessionId: string, turn: number, question: string, now: number = Date.now()) {
    this.sessionId = sessionId;
    this.turn = turn;
    this.question = question;
    this.startedAt = now;
    this.startedWallClock = new Date(now).toISOString();
    this.marks.set("question", 0);
  }

  mark(stage: TurnStage, now: number = Date.now()): void {
    if (!this.marks.has(stage)) this.marks.set(stage, now - this.startedAt);
  }

  /** 只记录第一次命中(首 token 语义),后续调用忽略。 */
  get elapsed(): TurnTraceRecord["stages"] {
    return {
      question: 0,
      prefetch: this.marks.get("prefetch") ?? null,
      llmFirstToken: this.marks.get("llmFirstToken") ?? null,
      toolExec: this.marks.get("toolExec") ?? null,
      answerFull: this.marks.get("answerFull") ?? null,
    };
  }

  finish(options: {
    source: "payload" | "mcp"; card: string | null; degraded: boolean;
    classifyMs?: number; numberGuardViolations?: string[];
  }, now = Date.now()): TurnTraceRecord {
    const stages = this.elapsed;
    const totalMs = stages.answerFull == null ? null : now - this.startedAt;
    return {
      ts: this.startedWallClock,
      sessionId: this.sessionId,
      turn: this.turn,
      question: this.question,
      stages,
      source: options.source,
      card: options.card,
      degraded: options.degraded,
      totalMs,
      ...(options.classifyMs !== undefined ? { classifyMs: options.classifyMs } : {}),
      ...(options.numberGuardViolations?.length ? { numberGuardViolations: options.numberGuardViolations } : {}),
    };
  }
}

/** JSONL 追加落盘;文件不可写时静默放弃(打点永不能弄垮编排)。 */
export class TraceSink {
  private readonly filePath: string | null;

  constructor(filePath: string | null) {
    this.filePath = filePath;
  }

  async append(record: TurnTraceRecord): Promise<void> {
    if (!this.filePath) return;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${JSON.stringify(redactRecord(record))}\n`, "utf8");
    } catch {
      /* 打点失败不影响主路径 */
    }
  }
}

/* ---- 汇总(延迟报告用;纯函数便于单测) ---- */

const STAGE_KEYS: Array<keyof TurnTraceRecord["stages"]> = [
  "question",
  "prefetch",
  "llmFirstToken",
  "toolExec",
  "answerFull",
];

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return Number((sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)).toFixed(1));
}

export function summarizeTraces(records: TurnTraceRecord[]): {
  turns: number;
  stages: Record<string, { p50: number | null; p95: number | null; samples: number }>;
  total: { p50: number | null; p95: number | null };
  degradedTurns: number;
} {
  const stages: Record<string, { p50: number | null; p95: number | null; samples: number }> = {};
  for (const key of STAGE_KEYS) {
    const samples = records.map((r) => r.stages[key]).filter((v): v is number => v != null);
    stages[key] = { p50: percentile(samples, 50), p95: percentile(samples, 95), samples: samples.length };
  }
  const totals = records.map((r) => r.totalMs).filter((v): v is number => v != null);
  return {
    turns: records.length,
    stages,
    total: { p50: percentile(totals, 50), p95: percentile(totals, 95) },
    degradedTurns: records.filter((r) => r.degraded).length,
  };
}
