/**
 * 「小川」语音事件协议(plan §9;8b 起大屏覆盖层与编排服务共用)。
 *
 * 两个进程、一条 WS:
 *   编排服务 services/voice-orchestrator  ── VoiceWireEvent ──▶  大屏 overlay / 文字对话台
 *   文字对话台 /voice-console             ── ConsoleWireEvent ──▶ 编排服务
 *
 * 设计红线(plan §9/§16.2):
 * - 状态机与粒子层不感知数据来源:数据从哪来(payload 预取 / 平台 MCP /
 *   8c 实时语音模型)只体现在 `tool.invoke.source` 上,渲染层零感知;
 * - 8c 换实时语音模型时本协议不变:asr.partial / tts.boundary 已预留;
 * - wire 事件与 session-machine 的 VoiceEvent 是两层:前者是传输语义,
 *   后者是覆盖层内部状态机语义,映射在 src/lib/voice/live-source.ts。
 *
 * §9 之外仅追加两个控制面事件(hub.hello / trace.turn),只给对话台用,
 * 大屏解析失败一律丢弃(fail-closed,见 parseWireEvent)。
 */

import type { AnswerCardData, VoiceStateName } from "./session-machine.ts";

/** 答案卡模板 id(tool.invoke 携带,驱动答案卡选型)。 */
export type CardTemplateId = AnswerCardData["kind"];

/** 数据来源:主路径=payload 预取注入(零工具轮);长尾=平台 MCP 工具轮。 */
export type AnswerDataSource = "payload" | "mcp";

/** 错误码(覆盖层按 code 映射降级话术,不感知细节)。 */
export type VoiceErrorCode =
  | "llm_timeout" // LLM 思考超 8s(VOICE_TIMING.thinkingMaxMs)
  | "llm_unavailable" // 适配器连接失败/鉴权失败
  | "datasource" // payload 预取失败(网络/500/结构不合法)
  | "mcp" // 平台 MCP 工具轮失败(仅长尾路径)
  | "rate_limited" // 每连接提问限流(安全审核项)
  | "internal"; // 编排内部意外错误

/**
 * 服务端 → 客户端(大屏 + 对话台广播)。
 * `at` 统一为服务端 Date.now() 域毫秒;客户端只用于展示排序,
 * 不与本域 performance.now() 混算。
 */
export type VoiceWireEvent =
  | { type: "speech.fixed"; at: number; text: string; speech: { turnId: string; fixed?: "wake" | "followup" | "goodbye" | "fallback" | "unheard" | "idle_exit"; style?: string; sentences: { index: number; displayStart: number; displayEnd: number }[] } }
  | { type: "input.listen"; at: number; sessionId: string; listenId: string; mode: "listening" | "followup" | "barge" | "off"; turnId?: string; phase?: "long" | "short"; timeoutMs?: number }
  | { type: "input.open" | "input.progress"; at: number; sessionId: string; listenId: string; remainingMs: number; timeoutMs: number; paused: boolean }
  | { type: "barge.result"; at: number; sessionId: string; listenId: string; attemptId: string; accepted: boolean; reason: "question" | "echo" | "unheard" | "timeout" | "misfire" | "rate_limited" }
  | { type: "session.start"; at: number; sessionId: string; screenId?: string }
  | {
      type: "state.change";
      at: number;
      from: VoiceStateName;
      to: VoiceStateName;
      /** 本轮接管内的问答轮次(0 起) */
      turn: number;
      /** to === "thinking" 时携带最终问题(大屏不依赖,对话台展示用) */
      question?: string;
    }
  | { type: "asr.partial"; at: number; text: string; final: boolean }
  | {
      type: "tool.invoke";
      at: number;
      /** 卡片模板选型;无数据模板的纯结论回答缺省 */
      card?: CardTemplateId;
      source: AnswerDataSource;
      /** 该来源从发起至就绪的耗时(毫秒;对话台打点展示) */
      latencyMs: number | null;
    }
  | {
      type: "answer.delta";
      at: number;
      /** 流式序号(0 起) */
      seq: number;
      /** 本片增量文本 */
      text: string;
      /** 末片为 true;此时携带完整答案卡(数字口径由编排侧构造) */
      full: boolean;
      card?: AnswerCardData;
      /** 音频资源与显示偏移；由本地播放器驱动句级高亮。 */
      speech?: { turnId: string; fixed?: "wake" | "followup" | "goodbye" | "fallback" | "unheard" | "idle_exit";
        style?: string; sentences: Array<{ index: number; displayStart: number; displayEnd: number }> };
    }
  | {
      type: "tts.boundary";
      at: number;
      /** 句索引(0 起);8b 由编排侧按句读合成,8c 换 TTS 真边界 */
      sentenceIndex: number;
      /** 该句在播报文案中的字符起点 */
      charIndex: number;
    }
  | { type: "session.end"; at: number; reason: SessionEndReason }
  | { type: "error"; at: number; code: VoiceErrorCode; message: string }
  /* ---- 以下为 8b 控制面追加(不进 §9 正集;大屏可安全忽略) ---- */
  | {
      type: "hub.hello";
      at: number;
      /** 当前在连的 大屏 / 对话台 数量 */
      screenId?: string; // 仅直接 hello 携带本连接身份
      screens: number;
      consoles: number;
    }
  | {
      type: "trace.turn";
      at: number;
      /** 与 turn 编号对应的一轮完整打点(plan §16.2 B④) */
      trace: TurnTracePayload;

      turn: number;
    };

export type SessionEndReason =
  | "listen_timeout"
  | "followup_timeout" // 追问 3s 无输入
  | "decline" // 「没有了/谢谢」
  | "force" // 运维/对话台强制退场
  | "error"; // 错误路径走完降级话术后退场

/** 跳过的播报句；索引与 answer.delta.speech.sentences 对齐。 */
export type SkippedPlaybackSentence = {
  sentenceIndex: number;
  reason: "audio_unavailable" | "invalid_audio" | "audio_interrupted";
};

/** 一轮问答的全程打点(plan §16.2 B④;毫秒,相对 question 起点)。 */
export type TurnTracePayload = {
  playbackContextRate?: number;
  playbackUnderruns?: number;
  style?: string;
  styleFallback?: string;
  speculative?: "hit" | "miss" | "none";
  /** 真实语音耗时；尚未接入的采集/播放字段为 null。 */
  asrMs?: number | null;
  asrQueueMs?: number;
  playbackStartMs?: number | null;
  playbackOutcome?: "drained" | "failed" | "timeout" | "cancelled";
  playbackFailureReason?: string;
  playbackScreenId?: string;
  playbackEndMs?: number;
  playbackScreenCount?: number;
  followupDelayMs?: number;
  playbackSkipped?: SkippedPlaybackSentence[];
  ttsFirstByteMs?: number;
  ttsRegenerated?: number;
  ttsTruncated?: number;
  ttsFail?: number;
  /** 8c 完整分类调用耗时。 */
  classifyMs?: number;
  numberGuardViolations?: string[];
  question: string;
  turn: number;
  /** 各阶段完成时刻(相对提问 t0;未发生的阶段为 null) */
  stages: {
    question: number;
    prefetch: number | null;
    llmFirstToken: number | null;
    toolExec: number | null;
    answerFull: number | null;
  };
  source: AnswerDataSource;
  /** 答案卡模板;无卡(纯结论)为 null */
  card: CardTemplateId | null;
  /** 是否走了降级话术(错误路径 / 覆盖缺口) */
  degraded: boolean;
  totalMs: number | null;
};

/**
 * 客户端 → 服务端：对话台控制会话；大屏仅鉴权/声明角色和回报当前轮播放状态。
 */
export type ConsoleWireEvent =
  | { type: "playback.metrics"; at: number; turnId: string; playbackContextRate: number; playbackUnderruns: number }
  | { type: "console.hello"; at: number; role: "console" | "screen" }
  | { type: "hub.auth"; at: number; token: string } // 首帧鉴权(审核 H1;仅鉴权模式生效)
  | { type: "session.wake"; at: number } // 开始一轮接管(等价 8c 唤醒词)
  | { type: "question.submit"; at: number; text: string }
  | { type: "playback.started"; at: number; turnId: string }
  | { type: "playback.failed"; at: number; turnId: string; reason: "audio_unavailable" | "invalid_audio" | "audio_interrupted" | "autoplay_blocked" | "timeout" | "dismissed" }
  | ({ type: "playback.skipped"; at: number; turnId: string } & SkippedPlaybackSentence)
  | { type: "playback.drained"; at: number; turnId: string } // 大屏播放器耗尽，必须匹配当前音频轮
  | { type: "session.dismiss"; at: number; sessionId: string }
  | { type: "session.close"; at: number }; // 强制退场(Esc 语义)

export const WIRE_EVENT_TYPES = [
  "input.listen", "input.open", "input.progress", "barge.result",
  "speech.fixed",
  "session.start",
  "state.change",
  "asr.partial",
  "tool.invoke",
  "answer.delta",
  "tts.boundary",
  "session.end",
  "error",
  "hub.hello",
  "trace.turn",
] as const satisfies readonly VoiceWireEvent["type"][];

/** fail-closed 解析:任何不合法/未知消息一律返回 null(大屏与编排共用)。 */
export function parseWireEvent(raw: unknown): VoiceWireEvent | null {
  if (typeof raw !== "string") return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const { type, at } = record;
  if (typeof type !== "string" || !(WIRE_EVENT_TYPES as readonly string[]).includes(type)) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;

  const ev = data as VoiceWireEvent;
  switch (ev.type) {
    case "input.listen":
      return typeof ev.sessionId === "string" && ev.sessionId.length <= 64 && /^sess-[a-f0-9-]+$/.test(ev.sessionId) && /^[a-f0-9-]{36}$/.test(ev.listenId) && ["listening", "followup", "barge", "off"].includes(ev.mode) && (ev.mode !== "barge" || /^[a-f0-9-]{36}$/.test(ev.turnId ?? "")) && (ev.timeoutMs === undefined || (Number.isFinite(ev.timeoutMs) && ev.timeoutMs > 0 && ev.timeoutMs <= 60000)) && (ev.phase === undefined || ["long", "short"].includes(ev.phase)) ? ev : null;
    case "input.open":
    case "input.progress":
      return /^sess-[a-f0-9-]{1,40}$/.test(ev.sessionId) && /^[a-f0-9-]{36}$/.test(ev.listenId) && (Number.isFinite(ev.timeoutMs) && ev.timeoutMs > 0 && ev.timeoutMs <= 60000) && Number.isFinite(ev.remainingMs) && ev.remainingMs >= 0 && ev.remainingMs <= ev.timeoutMs && typeof ev.paused === "boolean" ? ev : null;
    case "barge.result":
      return /^sess-[a-f0-9-]{1,40}$/.test(ev.sessionId) && /^[a-f0-9-]{36}$/.test(ev.listenId) && /^[a-f0-9-]{36}$/.test(ev.attemptId) && typeof ev.accepted === "boolean" && ev.accepted === (ev.reason === "question") && ["question","echo","unheard","timeout","misfire","rate_limited"].includes(ev.reason) ? ev : null;
    case "speech.fixed":
      if (typeof ev.text !== "string" || !ev.speech?.fixed || !["wake", "followup", "unheard", "goodbye", "fallback", "idle_exit"].includes(ev.speech.fixed)) return null;
      return parseWireEvent(JSON.stringify({ ...ev, type: "answer.delta", seq: 0, full: true, card: { kind: "brief", title: "小川", lines: [], spoken: ev.text } })) ? ev : null;
    case "session.start":
      return typeof ev.sessionId === "string" && ev.sessionId.length > 0 && (ev.screenId === undefined || (typeof ev.screenId === "string" && /^[a-f0-9-]{36}$/.test(ev.screenId))) ? ev : null;
    case "state.change":
      return typeof ev.from === "string" && typeof ev.to === "string" && typeof ev.turn === "number"
        ? ev
        : null;
    case "asr.partial":
      return typeof ev.text === "string" && typeof ev.final === "boolean" ? ev : null;
    case "tool.invoke":
      return typeof ev.source === "string" ? ev : null;
    case "answer.delta":
      if (typeof ev.seq !== "number" || typeof ev.text !== "string" || typeof ev.full !== "boolean") {
        return null;
      }
      if (ev.full && !isValidAnswerCard(ev.card)) return null;
      if (ev.speech !== undefined) {
        const s = ev.speech;
        if (!ev.full || !s || (s.fixed !== undefined && !["wake", "followup", "goodbye", "fallback", "idle_exit", "unheard"].includes(s.fixed)) || (s.style !== undefined && (typeof s.style !== "string" || !/^[a-z_]{1,32}$/.test(s.style))) || typeof s.turnId !== "string" || !/^[a-f0-9-]{36}$/.test(s.turnId) || !Array.isArray(s.sentences) || s.sentences.length === 0 || s.sentences.length > 100 ||
          !s.sentences.every((v, i) => v && v.index === i && Number.isInteger(v.displayStart) && Number.isInteger(v.displayEnd) && v.displayStart >= 0 && v.displayEnd > v.displayStart && v.displayEnd <= (ev.card?.spoken.length ?? 0) && (i === 0 || v.displayStart >= s.sentences[i - 1].displayEnd))) return null;
      }
      // 卡片来自网络:逐 kind schema 校验(防原型链/脏字段打崩渲染层)
      return ev;
    case "tts.boundary":
      return typeof ev.sentenceIndex === "number" && typeof ev.charIndex === "number" ? ev : null;
    case "session.end":
      return typeof ev.reason === "string" ? ev : null;
    case "error":
      return typeof ev.code === "string" && typeof ev.message === "string" ? ev : null;
    case "hub.hello":
      return typeof ev.screens === "number" && typeof ev.consoles === "number" && (ev.screenId === undefined || (typeof ev.screenId === "string" && /^[a-f0-9-]{36}$/.test(ev.screenId))) ? ev : null;
    case "trace.turn":
      return typeof ev.turn === "number" && typeof ev.trace === "object" && ev.trace !== null ? ev : null;
    default:
      return null;
  }
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 答案卡上限(前端校验与服务端截断共用,只在此处定义) */
export const ANSWER_TEXT_MAX = 300;
export const ANSWER_SPOKEN_MAX = 600;
export const ANSWER_ROWS_MAX = 20;
export const ANSWER_MAP_POINTS_MAX = 200;
const isText = (v: unknown, max = ANSWER_TEXT_MAX): v is string => isStr(v) && v.length <= max;
/** 完成率可超过 999%，只对图形限幅，不丢弃合法卡片。 */
const isPercent = (v: unknown): v is number => isNum(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
/** 计数:0–1e9 */
const isCount = (v: unknown): v is number => isNum(v) && v >= 0 && v <= 1e9;

/** 网络侧答案卡 schema:kind 必须是注册表已知 id,字段逐个验型;
 *  未知 kind(含 "constructor" 等原型链键)一律拒绝。 */
export function isValidAnswerCard(card: unknown): card is AnswerCardData {
  if (typeof card !== "object" || card === null) return false;
  const c = card as Record<string, unknown>;
  if (!isText(c.spoken, ANSWER_SPOKEN_MAX) || !isText(c.title)) return false;
  switch (c.kind) {
    case "target-progress":
      return (c.targetConfigured === undefined || typeof c.targetConfigured === "boolean") && (c.targetAvailable === undefined || typeof c.targetAvailable === "boolean") && (c.paidText === undefined || isText(c.paidText)) && (c.newContractUnpaidText === undefined || isText(c.newContractUnpaidText)) && isText(c.actualText) && isText(c.targetText) && isText(c.remainingText) && isPercent(c.completionRate);
    case "completion-ring":
      return (c.targetConfigured === undefined || typeof c.targetConfigured === "boolean") && (c.targetAvailable === undefined || typeof c.targetAvailable === "boolean") && isPercent(c.ratePercent) && isText(c.collectedText) && isText(c.targetText) && isText(c.remainingText);
    case "region":
      return (
        (c.unresolved === undefined || (typeof c.unresolved === "object" && c.unresolved !== null && isCount((c.unresolved as Record<string, unknown>).shipments) && isCount((c.unresolved as Record<string, unknown>).units))) &&
        (c.other === undefined || (typeof c.other === "object" && c.other !== null && isCount((c.other as Record<string, unknown>).regions) && isCount((c.other as Record<string, unknown>).units))) &&
        (c.mapPoints === undefined || (Array.isArray(c.mapPoints) && c.mapPoints.length <= ANSWER_MAP_POINTS_MAX && c.mapPoints.every(p => {
          if (typeof p !== "object" || p === null) return false;
          const point = p as Record<string, unknown>;
          return isText(point.region) && isNum(point.lng) && point.lng >= -180 && point.lng <= 180 && isNum(point.lat) && point.lat >= -90 && point.lat <= 90;
        }))) &&
        isText(c.summaryText) &&
        Array.isArray(c.rows) &&
        c.rows.length <= ANSWER_ROWS_MAX &&
        c.rows.every((row): boolean => {
          if (typeof row !== "object" || row === null) return false;
          const r = row as Record<string, unknown>;
          return isText(r.region) && isCount(r.shipments) && isCount(r.units) && isPercent(r.sharePercent);
        })
      );
    case "customers-shipments":
      return (
        (c.sampleTotal === undefined || isCount(c.sampleTotal)) &&
        (c.omittedCount === undefined || isCount(c.omittedCount)) &&
        (c.counts === undefined || (typeof c.counts === "object" && c.counts !== null && ["today", "sevenDays", "overdue"].every(key => isCount((c.counts as Record<string, unknown>)[key])))) &&
        isText(c.summaryText) &&
        Array.isArray(c.rows) &&
        c.rows.length <= ANSWER_ROWS_MAX &&
        c.rows.every((row): boolean => {
          if (typeof row !== "object" || row === null) return false;
          const r = row as Record<string, unknown>;
          return isText(r.equipmentText) && isText(r.detailText) && isText(r.statusText) && isText(r.dateLabel);
        })
      );
    case "customer-kpi": return isCount(c.newCustomers) && isCount(c.totalCustomers);
    case "followup-buckets": return isCount(c.today) && isCount(c.sevenDays) && isCount(c.overdue);
    case "collection-split": return isPercent(c.ratePercent) && isText(c.paidText) && isText(c.unpaidText);
    case "brief":
      return Array.isArray(c.lines) && c.lines.length <= ANSWER_ROWS_MAX && c.lines.every((line) => isText(line));
    default:
      return false;
  }
}

/** 编排服务的默认监听端口(与本机大屏 3015 无冲突)。 */
export const VOICE_HUB_DEFAULT_PORT = 3210;
