/**
 * 会话编排(plan §16.2 C):提问 → 并行预取 → LLM 意图分类(不含快照)
 * → 确定性卡片与播报 → 事件广播;三条降级路径(数据源异常 / LLM 超时或
 * 不可用 / 编排崩溃——最后者由大屏断链 FORCE_CLOSE 收场)全部收束到
 * error-fallback → closing,基线无感。
 *
 * 编排侧持有一份 8a 同一 reducer 的会话镜像(session-machine),转移与
 * 大屏逐字对齐;wire 事件由镜像转移推导。所有节奏常量(唤醒/思考上限/
 * 追问/打字速度)import 自 src/lib/voice/*,两侧共用不重复定义。
 *
 * 事件顺序契约(协议快照锁定):tool.invoke → answer.delta…(末片 full
 * 携卡)→ state.change(answering);大屏映射依赖该顺序取卡。
 */

import { PausableDeadline } from "../../../src/lib/voice/deadline.ts";
import { echoSimilarity } from "../../../src/lib/voice/echo-similarity.ts";
import { ListenWindow, type InputLease, type ListenAction } from "./listen-window.ts";
import { classifyScriptedQuestion } from "../../../src/lib/voice/intents.ts";
import type { Intent } from "../../../src/lib/voice/intents.ts";
import type { AudioTurn } from "./tts/audio-store.ts";
import { stripWakePrefix, isUnheard } from "../../../src/lib/voice/asr-text.ts";
import { speechStyleFor } from "../../../src/lib/voice/speech-style.ts";
import type { SpeechClient } from "./tts/voice-local-client.ts";
import { FIXED_LINES, type FixedLineKey } from "./tts/fixed-lines.ts";
import { buildBriefCard } from "../../../src/lib/voice/card-builders.ts";
import { InputError } from "./http-input.ts";
import type { AudioStore } from "./tts/audio-store.ts";
import { randomUUID } from "node:crypto";
import {
  clampAnswerText,
} from "../../../src/lib/voice/card-builders.ts";
import type { PublicSalesScreenPayload } from "../../../src/lib/voice/public-payload.ts";
import type {
  ConsoleWireEvent,
  TurnTracePayload,
  VoiceErrorCode,
  VoiceWireEvent,
} from "../../../src/lib/voice/protocol.ts";
import { buildIntentAnswer } from "../../../src/lib/voice/intent-answers.ts";
import { hasUnsupportedScope, isIntent } from "../../../src/lib/voice/intents.ts";
import { buildSpokenSentences } from "../../../src/lib/voice/spoken-normalize.ts";
import type { LlmAdapter } from "./llm/types.ts";
import { LlmError } from "./llm/types.ts";
import { tokensMatch } from "./guard/token.ts";
import { buildInjectedContext, sanitizeAnswer, verifyAnswerNumbers } from "./datasource/inject-context.ts";
import type { SalesScreenDataSource } from "./datasource/index.ts";
import type { PlatformMcpClient } from "./datasource/platform-mcp.ts";
import { TurnTracer, type TraceSink, type TurnTraceRecord } from "./trace/metrics.ts";
import type { HubConnection, VoiceHubServer } from "./ws/ws-server.ts";
import {
  initSessionState,
  sessionReducer,
  VOICE_TIMING,
  type AnswerCardData,
  type VoiceEvent,
  type VoiceSessionState,
} from "../../../src/lib/voice/session-machine.ts";
import { DEMO_TIMING } from "../../../src/lib/voice/demo-script.ts";
import { playbackFallbackMs } from "../../../src/lib/voice/playback-timing.ts";
import { LAUNCH } from "../../../src/lib/voice/params.ts";

export type OrchestratorOptions = {
  hub: VoiceHubServer;
  warn?: (message: string) => void;
  listenTimeoutMs?: number;
  audio?: AudioStore;
  speechClient?: SpeechClient;
  styleOverrides?: Record<string, string>;
  dataSource: SalesScreenDataSource;
  llm: LlmAdapter;
  mcp: PlatformMcpClient | null;
  trace: TraceSink;
  /** 思考死线(plan §4:thinking 超 8s 降级);与覆盖层本地兜底同值 */
  llmTimeoutMs: number;
  partialPaceMs: number;
  partialMaxTotalMs: number;
  /** 预取超时:平台接口挂起时该轮走数据源降级,而不是永远 thinking */
  prefetchTimeoutMs: number;
  /** 每连接提问限流:最小间隔 + 滑动窗口上限 */
  questionMinGapMs: number;
  questionWindowMs: number;
  questionWindowMax: number;
  /** MCP 工具白名单(空 = 全部拒绝):工具名来自 LLM,而问题是攻击者可控的 */
  mcpToolWhitelist: string[];
  /** 双令牌首帧鉴权(审核 H1);null = 非鉴权模式(仅回环),console.hello 行为不变 */
  hubAuth?: { consoleToken: string; screenToken: string } | null;
  /** 测试钩子:默认全局定时器(vi.useFakeTimers 可控) */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/** 客户端上行 fail-closed 解析；角色权限在处理入口检查。 */
export function parseConsoleEvent(raw: string): ConsoleWireEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const ev = data as ConsoleWireEvent;
  if (typeof (ev as { at?: unknown }).at !== "number" || !Number.isFinite(ev.at)) return null;
  switch (ev.type) {
    case "console.hello":
      return ev.role === "console" || ev.role === "screen" ? ev : null;
    case "hub.auth":
      return typeof ev.token === "string" && ev.token.length > 0 && ev.token.length <= 256 ? ev : null;
    case "session.dismiss":
      return typeof ev.sessionId === "string" && /^sess-[a-f0-9-]{1,40}$/.test(ev.sessionId) ? ev : null;
    case "session.wake":
    case "session.close":
      return ev;
    case "question.submit":
      return typeof ev.text === "string" && ev.text.trim().length > 0 && ev.text.length <= 500 ? ev : null;
    case "playback.failed":
      if (!["audio_unavailable", "invalid_audio", "audio_interrupted", "autoplay_blocked", "timeout", "dismissed"].includes(ev.reason)) return null;
      // fall through
    case "playback.skipped":
      if (ev.type === "playback.skipped" && (!Number.isInteger(ev.sentenceIndex) || ev.sentenceIndex < 0 || ev.sentenceIndex >= 100 || !["audio_unavailable", "invalid_audio", "audio_interrupted"].includes(ev.reason))) return null;
      // fall through
    case "playback.metrics":
      if (ev.type === "playback.metrics" && (!Number.isInteger(ev.playbackContextRate) || ev.playbackContextRate < 8000 || ev.playbackContextRate > 192000 || !Number.isInteger(ev.playbackUnderruns) || ev.playbackUnderruns < 0 || ev.playbackUnderruns > 100000)) return null;
      // fall through
    case "playback.started":
    case "playback.drained":
      return typeof ev.turnId === "string" && /^[a-f0-9-]{36}$/.test(ev.turnId) ? ev : null;
    default:
      return null;
  }
}

export function createVoiceOrchestrator(options: OrchestratorOptions) {
  const {
    hub, dataSource, llm, trace, llmTimeoutMs, partialPaceMs, partialMaxTotalMs,
    prefetchTimeoutMs, questionMinGapMs, questionWindowMs, questionWindowMax,
    hubAuth = null,
  } = options;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));

  let state: VoiceSessionState = initSessionState(Date.now());
  let sessionId = "";
  let voiceSession = false;
  let sessionScreenId: string | null = null;
  let answerShownAt = 0;
  const ownsSession = (conn: HubConnection) => !sessionScreenId || conn.id === sessionScreenId;
  let listenWindow: ListenWindow | null = null;
  let wakeGuard: unknown = null;
  let failures = 0;
  let answerIntent: Intent | "unheard" | null = null;
  let wakeAt: number[] = [];
  let turnSeq = 0; // 每次提问递增;一切延迟回调持有所属 seq,过期即弃
  let pendingQuestion: string | null = null;
  let answer: ReturnType<typeof buildIntentAnswer> | null = null;
  const timers = new Set<PausableDeadline>();
  let bargeLease: InputLease | null = null;
  let candidate: { lease: InputLease; watchdog: unknown; judging: boolean; controller: AbortController | null } | null = null;
  let deferredFixed: string | null = null;
  const finishedAttempts = new Set<string>();

  /** 进行中的一轮:新问题到来时中止旧轮(LLM 流/死线一并释放) */
  let inputController: AbortController | null = null;
  let inputMeta: { asrMs: number; asrQueueMs?: number; uploadMs: number; asrRoundTripMs: number; started: number } | null = null;
  let fixedPlayback: { id: string; next: "listening" | "followup" | "close" | "exit"; seq: number; started: number } | null = null;
  let activeTurn: { controller: AbortController; deadline: NodeJS.Timeout | null } | null = null;
  /** 提问限流账本:全局一份(审核 M4:按连接计可被多连接绕过) */
  let askedAt: number[] = [];
  let audioId: string | null = null;
  let goodbyeId: string | null = null;
  let playback: { id: string; seq: number; record: TurnTraceRecord; synthesisDone: boolean; finished: boolean; written: boolean; waitingForScreens: boolean } | null = null;
  function persistPlayback(p: NonNullable<typeof playback>): void {
    if (!p.finished || !p.synthesisDone || p.written) return;
    p.written = true;
    void trace.append({ ...p.record });
  }
  function endPlayback(outcome: NonNullable<TurnTraceRecord["playbackOutcome"]>): void {
    if (!playback || playback.finished) return;
    playback.finished = true;
    playback.waitingForScreens = false;
    playback.record.playbackOutcome = outcome;
    playback.record.playbackEndMs = Math.max(0, Date.now() - Date.parse(playback.record.ts));
    playback.record.playbackScreenCount = hub.counts().screens;
    if (sessionScreenId) playback.record.playbackScreenId = sessionScreenId;
    emitTrace(playback.record);
    persistPlayback(playback);
  }
  function cancelAudio(): void {
    clearBarge();
    if (audioId) options.audio?.cancel(audioId);
    endPlayback("cancelled");
    audioId = null; goodbyeId = null; playback = null;
    if (fixedPlayback) options.audio?.cancel(fixedPlayback.id);
    fixedPlayback = null;
  }
  function spoken(seq: number, outcome: "drained" | "failed" | "timeout"): void {
    if (seq !== turnSeq || state.name !== "answering" || playback?.finished) return;
    clearTimers();
    if ((outcome === "failed" || (outcome === "timeout" && !goodbyeId)) && audioId) options.audio?.cancel(audioId);
    if (playback && outcome === "timeout") playback.record.playbackFailureReason ??= "timeout";
    endPlayback(outcome);
    if (outcome !== "drained") {
      clearBarge();
      broadcast({ type: "input.listen", at: Date.now(), sessionId, listenId: randomUUID(), mode: "off" });
      clearWakeGuard();
      // Keep the complete card readable; failure must never manufacture a
      // spoken followup. Leave enough time for the card's remaining reveal.
      const revealMs = LAUNCH.unfoldStartMs + LAUNCH.unfoldMs + (answer?.spoken.length ?? 0) / LAUNCH.typeCps * 1000 + 2000;
      later(Math.max(VOICE_TIMING.failedCardHoldMs, revealMs - (Date.now() - answerShownAt)), () => {
        if (seq === turnSeq && state.name === "answering") forceClose("error");
      });
      return;
    }
    if (goodbyeId) { forceClose("decline"); return; }
    if (voiceSession && failures >= 2) { idleExit(); return; }
    if (answerIntent === "greeting" || answerIntent === "unheard") {
      dispatch({ type: "SPOKEN", at: Date.now() });
      dispatch({ type: "SPEAK", at: Date.now() });
      if (voiceSession) startListen("listening"); return;
    }
    dispatch({ type: "SPOKEN", at: Date.now() });
    if (voiceSession) startListen("followup", "long");
    else {
      later(VOICE_TIMING.longListenMs, () => {
        if (seq !== turnSeq || state.name !== "followup") return;
        followupTimeout(seq);
      });
    }
  }

  function followupTimeout(seq: number): void {
    later(VOICE_TIMING.shortListenMs, () => {
      if (seq !== turnSeq || state.name !== "followup") return;
      dispatch({ type: "FOLLOWUP_TIMEOUT", at: Date.now() });
      broadcast({ type: "session.end", at: Date.now(), reason: "followup_timeout" });
      later(VOICE_TIMING.closingMs, () => dispatch({ type: "CLOSED", at: Date.now() }));
    });
  }

  function clearActiveTurn(): void {
    if (!activeTurn) return;
    activeTurn.controller.abort(new Error("superseded"));
    if (activeTurn.deadline) clearTimeout(activeTurn.deadline);
    activeTurn = null;
  }

  /* ---------- 底座:镜像派发 + wire 广播 ---------- */

  function dispatch(event: VoiceEvent): void {
    const from = state.name;
    const next = sessionReducer(state, event);
    if (next === state) return; // 非法转移(镜像与覆盖层同守)
    state = next;
    if (next.name === "answering" && from !== "answering") answerShownAt = Date.now();
    if (next.name !== from) {
      listenWindow?.stop(); listenWindow = null;
      if (next.name === "closing" || next.name === "ambient") clearWakeGuard();
    }
    if (next.name !== from) {
      broadcast({
        type: "state.change",
        at: Date.now(),
        from,
        to: next.name,
        turn: next.turns,
        ...(next.name === "thinking" && next.question ? { question: next.question } : {}),
      });
    }
  }

  // Listening starts only after the browser reports its actual open microphone.
  function clearWakeGuard(): void { if (wakeGuard !== null) clearTimer(wakeGuard); wakeGuard = null; }
  function interaction(event: string, lease: InputLease, extra: Partial<import("./trace/metrics.ts").InteractionTrace> = {}): void {
    void trace.appendInteraction?.({ ts: new Date().toISOString(), sessionId, turn: state.turns, event, listenId: lease.listenId, ...(lease.turnId ? { turnId: lease.turnId } : {}), ...(lease.attemptId ? { attemptId: lease.attemptId } : {}), ...extra });
  }
  function startListen(mode: "listening" | "followup", phase: "long" | "short" = "short"): void {
    listenWindow?.stop();

    const lease = { sessionId, listenId: randomUUID(), ...(sessionScreenId ? { screenId: sessionScreenId } : {}) };
    const timeoutMs = mode === "listening" ? options.listenTimeoutMs ?? VOICE_TIMING.shortListenMs : phase === "long" ? VOICE_TIMING.longListenMs : VOICE_TIMING.shortListenMs;
    let opened = false;
    listenWindow = new ListenWindow(lease, mode, { timeoutMs, setTimer, clearTimer,
      speechTimeout: () => {
        if (!candidate) return false;
        rejectBarge("timeout"); return true;
      },
      progress: (remainingMs, paused, isOpen) => {
        if (!isOpen) return;
        broadcast({ type: opened ? "input.progress" : "input.open", at: Date.now(), ...lease, remainingMs, paused, timeoutMs });
        interaction(opened ? "listen.progress" : "listen.open", lease, { phase, remainingMs, paused }); opened = true;
      }, expire: missing => {
        if (lease.sessionId !== sessionId || !["listening", "followup"].includes(state.name)) return;
        interaction("listen.expire", lease, { phase, reason: missing ? "missing_report" : "silence" });
        if (missing) { forceClose("listen_timeout"); return; }
        if (phase === "long") {
          if (!playFixed("followup", "followup")) startListen("followup", "short");
        } else idleExit();
      } });
    if (candidate) listenWindow.report("speech_start");
    broadcast({ type: "input.listen", at: Date.now(), ...lease, mode, phase, timeoutMs });
  }
  function clearBarge(): void {
    if (candidate) { clearTimer(candidate.watchdog); candidate.controller?.abort(); }
    if (candidate?.lease.attemptId) finishedAttempts.add(candidate.lease.attemptId);
    candidate = null; bargeLease = null; deferredFixed = null;
    for (const timer of timers) timer.resume();
  }
  function startBarge(turnId: string): void {
    if (!voiceSession) return;
    clearBarge();
    bargeLease = { sessionId, listenId: randomUUID(), turnId, ...(sessionScreenId ? { screenId: sessionScreenId } : {}) };
    broadcast({ type: "input.listen", at: Date.now(), ...bargeLease, mode: "barge" });
  }
  function rejectBarge(reason: Extract<VoiceWireEvent, { type: "barge.result" }>["reason"]): void {
    const attempt = candidate;
    if (!attempt) return;
    clearTimer(attempt.watchdog); attempt.controller?.abort(); finishedAttempts.add(attempt.lease.attemptId!); candidate = null;
    broadcast({ type: "barge.result", at: Date.now(), sessionId, listenId: attempt.lease.listenId, attemptId: attempt.lease.attemptId!, accepted: false, reason });
    interaction("barge.rejected", attempt.lease, { reason });
    for (const timer of timers) timer.resume();
    listenWindow?.report("misfire");
    if (deferredFixed) { const id = deferredFixed; deferredFixed = null; completeFixed(id); }
    else if (listenWindow) bargeLease = null;
  }
  function inputActivity(lease: InputLease, action: ListenAction): void {
    if (lease.sessionId !== sessionId || (sessionScreenId && lease.screenId !== sessionScreenId)) throw new InputError(409, "stale_listen_window");
    if (bargeLease?.listenId === lease.listenId) {
      if (lease.attemptId && finishedAttempts.has(lease.attemptId)) throw new InputError(409, "stale_attempt");
      if (!lease.attemptId) throw new InputError(400, "attempt_identity_required");
      if (action === "duck") {
        if (!candidate && finishedAttempts.size >= 128) throw new InputError(429, "attempt_limit");
        if (candidate) { if (candidate.lease.attemptId !== lease.attemptId) throw new InputError(409, "barge_busy"); return; }
        const count = options.audio?.lookup(bargeLease.turnId!)?.descriptor.sentences.length ?? 0;
        if (!Number.isInteger(lease.sentenceIndex) || lease.sentenceIndex! >= count || lease.sentenceIndex! < 0) throw new InputError(400, "invalid_sentence");
        candidate = { lease: { ...bargeLease, attemptId: lease.attemptId, sentenceIndex: lease.sentenceIndex }, judging: false, controller: null, watchdog: setTimer(() => rejectBarge("timeout"), 16000) };
        for (const timer of timers) timer.pause();
        listenWindow?.report("speech_start");
        interaction("barge.duck", candidate.lease, { sentenceIndex: lease.sentenceIndex });
      } else {
        if (!candidate || candidate.lease.attemptId !== lease.attemptId) throw new InputError(409, "stale_attempt");
        if (action === "misfire") rejectBarge("misfire");
        else if (action === "pause") interaction("barge.pause", candidate.lease);
      }
      return;
    }
    if (!listenWindow || lease.listenId !== listenWindow.lease.listenId || fixedPlayback || !["listening", "followup"].includes(state.name) || !["ready","speech_start","misfire"].includes(action)) throw new InputError(409, "stale_listen_window");
    if (action === "ready") { clearWakeGuard(); if (!candidate) bargeLease = null; }
    listenWindow.report(action);
  }
  async function submitBarge(pcm: Uint8Array, signal: AbortSignal, uploadMs: number, lease: InputLease): Promise<void> {
    const attempt = candidate;
    if (!attempt || attempt.judging || lease.attemptId !== attempt.lease.attemptId || lease.listenId !== attempt.lease.listenId) throw new InputError(409, "stale_attempt");
    attempt.judging = true; interaction("barge.speech_end", attempt.lease, { sentenceIndex: attempt.lease.sentenceIndex }); clearTimer(attempt.watchdog);
    const controller = new AbortController(); attempt.controller = controller;
    attempt.watchdog = setTimer(() => rejectBarge("timeout"), 6000);
    const started = Date.now(); const seq = turnSeq;
    const combined = AbortSignal.any([signal, controller.signal]);
    try {
      if (!options.speechClient) throw new InputError(503, "asr_unavailable");
      const result = await options.speechClient.asr(pcm, combined);
      combined.throwIfAborted();
      if (candidate !== attempt || seq !== turnSeq) return;
      const text = stripWakePrefix(result.text).slice(0, 500);
      const sentences = options.audio?.lookup(attempt.lease.turnId!)?.spokenSentences ?? [];
      const index = attempt.lease.sentenceIndex!;
      const reference = [sentences[index - 1], sentences[index], sentences[index + 1]].filter(Boolean).map(sentence => sentence.spokenText).join("");
      const similarity = echoSimilarity(text, reference);
      interaction("barge.asr", attempt.lease, { asrMs: result.ms, asrQueueMs: result.asrQueueMs });
      if (isUnheard(text)) { rejectBarge("unheard"); return; }
      if (similarity >= .5) { rejectBarge("echo"); return; }
      if (rateLimited()) {
        // This branch replaces playback with an apology, so it must not resume it.
        clearTimers(); cancelAudio();
        broadcast({ type: "barge.result", at: Date.now(), sessionId, listenId: attempt.lease.listenId, attemptId: attempt.lease.attemptId!, accepted: false, reason: "rate_limited" });
        interaction("barge.rejected", attempt.lease, { reason: "rate_limited" });
        if (state.name === "waking") dispatch({ type: "WOKEN", at: Date.now() });
        if (state.name === "answering") dispatch({ type: "BARGE_IN", at: Date.now() });
        if (state.name === "followup") dispatch({ type: "SPEAK", at: Date.now() });
        answerUnheard(started, result.ms, false); return;
      }
      clearTimer(attempt.watchdog); finishedAttempts.add(attempt.lease.attemptId!); candidate = null; bargeLease = null; deferredFixed = null;
      broadcast({ type: "barge.result", at: Date.now(), sessionId, listenId: lease.listenId, attemptId: lease.attemptId!, accepted: true, reason: "question" });
      interaction("barge.accepted", attempt.lease);
      inputMeta = { asrMs: result.ms, asrQueueMs: result.asrQueueMs, uploadMs, asrRoundTripMs: Date.now() - started, started };
      if (state.name === "waking") dispatch({ type: "WOKEN", at: Date.now() });
      acceptQuestion(text);
    } catch { if (candidate === attempt) rejectBarge(combined.aborted ? "timeout" : "unheard"); }
  }
  function idleExit(): void {
    listenWindow?.stop(); listenWindow = null; clearWakeGuard(); clearTimers();
    if (!voiceSession || !playFixed("idle_exit", "exit")) forceClose("listen_timeout");
  }

  /** 业务事件只发给已声明角色的连接(审核 M6:未声明连接不得旁听问题原文/回答流) */
  function broadcast(payload: VoiceWireEvent): void {
    hub.broadcast(payload, (conn) => conn.role !== "unknown");
  }

  /** 打点只发给对话台角色(含问题原文;大屏/未知连接不收,安全审核项) */
  function emitTrace(record: TurnTraceRecord): void {
    hub.broadcast(
      {
        type: "trace.turn",
        at: Date.now(),
        turn: record.turn,
        trace: {
          question: record.question,
          turn: record.turn,
          stages: record.stages,
          source: record.source,
          card: record.card as TurnTracePayload["card"],
          degraded: record.degraded,
          totalMs: record.totalMs,
          ...(record.style ? { style: record.style, ...(record.styleFallback ? { styleFallback: record.styleFallback } : {}) } : {}),
          speculative: record.speculative ?? "none",
          asrMs: record.asrMs ?? null,
          ...(record.asrQueueMs !== undefined ? { asrQueueMs: record.asrQueueMs } : {}),
          playbackStartMs: record.playbackStartMs ?? null,
          ...(record.playbackOutcome ? { playbackOutcome: record.playbackOutcome } : {}),
          ...(record.playbackFailureReason ? { playbackFailureReason: record.playbackFailureReason } : {}),
          ...(record.playbackScreenId ? { playbackScreenId: record.playbackScreenId } : {}),
          ...(record.playbackEndMs !== undefined ? { playbackEndMs: record.playbackEndMs } : {}),
          ...(record.playbackScreenCount !== undefined ? { playbackScreenCount: record.playbackScreenCount } : {}),
          ...(record.playbackContextRate !== undefined ? { playbackContextRate: record.playbackContextRate } : {}),
          ...(record.playbackUnderruns !== undefined ? { playbackUnderruns: record.playbackUnderruns } : {}),
          ...(record.playbackSkipped ? { playbackSkipped: record.playbackSkipped.map(s => ({ ...s })) } : {}),
          ...(record.ttsFirstByteMs !== undefined ? { ttsFirstByteMs: record.ttsFirstByteMs } : {}),
          ...(record.ttsRegenerated !== undefined ? { ttsRegenerated: record.ttsRegenerated, ttsTruncated: record.ttsTruncated, ttsFail: record.ttsFail } : {}),
          ...(record.classifyMs !== undefined ? { classifyMs: record.classifyMs } : {}),
          ...(record.numberGuardViolations ? { numberGuardViolations: record.numberGuardViolations } : {}),
        },
      },
      (conn) => conn.role === "console",
    );
  }

  function later(ms: number, fn: () => void): void {
    const handle = new PausableDeadline(Math.max(0, ms), () => { timers.delete(handle); fn(); }, setTimer, clearTimer);
    timers.add(handle);
    if (candidate) handle.pause();
  }
  function clearTimers(): void { for (const handle of timers) handle.cancel(); timers.clear(); }

  /* ---------- 会话生命周期 ---------- */

  function beginSession(withVoice = false, screenId?: string): boolean {
    const screens = [...(hub.connections ?? [])].filter(c => c.role === "screen");
    if (screenId && !screens.some(c => c.id === screenId)) throw new InputError(409, "screen_not_connected");
    if (state.name !== "ambient") return false;
    if (withVoice) {
      const now = Date.now(); wakeAt = wakeAt.filter(t => now - t < questionWindowMs);
      if (wakeAt.length >= questionWindowMax || (wakeAt.length && now - wakeAt.at(-1)! < questionMinGapMs)) throw new InputError(429, "wake_rate_limited");
      wakeAt.push(now);
    }
    failures = 0; answerIntent = null; finishedAttempts.clear(); clearWakeGuard();
    voiceSession = withVoice;
    sessionScreenId = screenId ?? screens[0]?.id ?? null;
    sessionId = `sess-${randomUUID().slice(0, 8)}`;
    answer = null;
    broadcast({ type: "session.start", at: Date.now(), sessionId, ...(sessionScreenId ? { screenId: sessionScreenId } : {}) });
    dispatch({ type: "WAKE", at: Date.now() });
    if (withVoice && playFixed("wake", "listening")) {
      return true;
    }
    later(VOICE_TIMING.wakingMs, () => {
      dispatch({ type: "WOKEN", at: Date.now() });
      if (voiceSession) startListen("listening");
      if (pendingQuestion) {
        const question = pendingQuestion;
        pendingQuestion = null;
        acceptQuestion(question);
      }
    });
    return true;
  }

  function playFixed(key: FixedLineKey, next: "listening" | "followup" | "close" | "exit"): boolean {
    const text = FIXED_LINES[key];
    const sentence = [{ index: 0, text, spokenText: text, displayStart: 0, displayEnd: text.length }];
    if (!options.audio?.ready || hub.counts().screens < 1) return false;
    const turn = options.audio.startFixed(key, sentence);
    if (!turn) return false;
    listenWindow?.stop(); listenWindow = null;
    fixedPlayback = { id: turn.id, next, seq: turnSeq, started: Date.now() };
    broadcast({ type: "speech.fixed", at: Date.now(), text, speech: turn.descriptor });
    later(turn.bytes / 48000 * 2000 + 2000, () => failFixed(turn.id));
    if (!["goodbye", "fallback"].includes(key)) startBarge(turn.id);
    return true;
  }
  function failFixed(id: string, reason = "timeout"): void {
    if (fixedPlayback?.id !== id) return;
    options.warn?.(`fixed playback failed: ${JSON.stringify({reason,screenId:sessionScreenId,screens:hub.counts().screens,fixed:options.audio?.lookup(id)?.descriptor.fixed})}`);
    forceClose("error");
  }
  function completeFixed(id: string): void {
    const p = fixedPlayback;
    if (!p || p.id !== id || p.seq !== turnSeq) return;
    if (candidate) { deferredFixed = id; return; }
    fixedPlayback = null;
    clearTimers();
    const finish = () => {
      if (p.seq !== turnSeq) return;
      if (p.next === "listening") {
        if (state.name === "waking") dispatch({ type: "WOKEN", at: Date.now() });
        else if (state.name === "followup") dispatch({ type: "SPEAK", at: Date.now() });
        startListen("listening");
        if (pendingQuestion) { const q = pendingQuestion; pendingQuestion = null; acceptQuestion(q); }
      } else if (p.next === "exit") { forceClose("listen_timeout");
      } else if (p.next === "close" && state.name === "error-fallback") {
        dispatch({ type: "ERROR_SPOKEN", at: Date.now() });
        broadcast({ type: "session.end", at: Date.now(), reason: "error" });
        later(VOICE_TIMING.closingMs, () => dispatch({ type: "CLOSED", at: Date.now() }));
      } else if (state.name === "followup") { if (voiceSession) startListen("followup"); else followupTimeout(p.seq); }
    };
    later(Math.max(0, VOICE_TIMING.wakingMs - (Date.now() - p.started)), finish);
  }

  async function submitUtterance(pcm: Uint8Array, signal: AbortSignal, uploadMs = 0, lease?: InputLease): Promise<void> {
    if (sessionScreenId && lease?.screenId !== sessionScreenId) throw new InputError(409, "screen_not_session_owner");
    if (lease && lease.listenId === bargeLease?.listenId) { await submitBarge(pcm, signal, uploadMs, lease); return; }
    if (candidate) throw new InputError(409, "barge_busy");
    if (lease && (lease.sessionId !== sessionId || lease.listenId !== listenWindow?.lease.listenId)) throw new InputError(409, "stale_listen_window");
    if (!["listening", "followup"].includes(state.name) || fixedPlayback || inputController) throw new InputError(409, "microphone_closed");
    const controller = new AbortController(); inputController = controller;
    const seq = turnSeq; const started = Date.now();
    const combined = AbortSignal.any([signal, controller.signal]);
    try {
      if (!options.speechClient) throw new InputError(503, "asr_unavailable");
      if (listenWindow) interaction("listen.complete", listenWindow.lease, { reason: "utterance" });
      clearTimers(); listenWindow?.stop(); listenWindow = null; clearWakeGuard();
      if (state.name === "followup") dispatch({ type: "SPEAK", at: Date.now() });
      const result = await options.speechClient.asr(pcm, combined);
      combined.throwIfAborted();
      if (seq !== turnSeq || state.name !== "listening") throw new InputError(409, "session_changed");
      const text = stripWakePrefix(result.text).slice(0, 500);
      inputMeta = { asrMs: result.ms, ...(result.asrQueueMs !== undefined ? { asrQueueMs: result.asrQueueMs } : {}), uploadMs, asrRoundTripMs: Date.now() - started, started };
      if (isUnheard(text)) answerUnheard(started, result.ms);
      else if (rateLimited()) answerUnheard(started, result.ms, false);
      else acceptQuestion(text);
    } catch (error) {
      if (!combined.aborted && state.name === "listening") {
        answerUnheard(started, 0);
      } else if (combined.aborted && state.name === "listening") forceClose("force");
      throw error;
    } finally { if (inputController === controller) inputController = null; }
  }

  function answerUnheard(started: number, asrMs: number, countFailure = true): void {
    answerIntent = "unheard"; if (countFailure) failures++;
    if (voiceSession && failures >= 2) { inputMeta = null; idleExit(); return; }
    const seq = turnSeq;
    dispatch({ type: "SUBMIT", at: Date.now(), question: "未听清" });
    answer = { card: buildBriefCard("小川", [FIXED_LINES.unheard]), cardId: "brief", spoken: FIXED_LINES.unheard, sentences: [], unanswerable: false };
    answer.sentences = [{ index: 0, text: FIXED_LINES.unheard, spokenText: FIXED_LINES.unheard, displayStart: 0, displayEnd: FIXED_LINES.unheard.length }];
    const turn = options.audio?.startFixed("unheard", answer.sentences);
    audioId = turn?.id ?? null;
    const record = new TurnTracer(sessionId, state.turns, "未听清", started).finish({ source: "payload", card: "brief", degraded: false });
    record.asrMs = asrMs; record.style = turn?.descriptor.style ?? "apologetic";
    if (record.style !== "apologetic") record.styleFallback = "apologetic";
    if (turn) playback = { id: turn.id, seq: turnSeq, record, synthesisDone: true, finished: false, written: false, waitingForScreens: true };
    broadcast({ type: "answer.delta", at: Date.now(), seq: 0, text: answer.spoken, full: true, card: answer.card, ...(turn ? { speech: turn.descriptor } : {}) });
    dispatch({ type: "ANSWER", at: Date.now(), card: answer.card });
    clearWakeGuard();
    if (turn) startBarge(turn.id);
    later(turn ? turn.bytes / 48000 * 2000 + 2000 : 2000, () => spoken(seq, turn ? "timeout" : "drained"));
    inputMeta = null;
    if (!playback) void trace.append(record);
  }

  function forceClose(reason: import("../../../src/lib/voice/protocol.ts").SessionEndReason): void {
    if (listenWindow) interaction("listen.complete", listenWindow.lease, { reason });
    listenWindow?.stop(); listenWindow = null; clearWakeGuard();
    inputController?.abort(); inputController = null; inputMeta = null; pendingQuestion = null;
    if (reason !== "decline") cancelAudio();
    if (state.name === "ambient" || state.name === "closing") return;
    clearTimers();
    goodbyeId = null;
    clearActiveTurn(); // 审核 M1:关闭即中止进行中的 LLM 流/预取/死线
    turnSeq += 1;
    answer = null;
    dispatch({ type: "FORCE_CLOSE", at: Date.now() });
    broadcast({ type: "session.end", at: Date.now(), reason });
    later(VOICE_TIMING.closingMs, () => dispatch({ type: "CLOSED", at: Date.now() }));
  }

  /* ---------- 入口:console 控制事件 ---------- */

  function handleClientMessage(conn: HubConnection, raw: string): void {
    const event = parseConsoleEvent(raw);
    if (!event) return;
    if (event.type === "session.dismiss") {
      if (conn.role === "screen" && ownsSession(conn) && event.sessionId === sessionId && state.name !== "ambient") forceClose("force");
      return;
    }
    if (event.type.startsWith("playback.") && "turnId" in event && fixedPlayback?.id === event.turnId && conn.role === "screen" && ownsSession(conn)) {
      if (event.type === "playback.failed" && event.reason === "dismissed") forceClose("force");
      else if (event.type === "playback.drained") completeFixed(event.turnId);
      else if (event.type === "playback.failed") failFixed(event.turnId, event.reason);
      return;
    }
    switch (event.type) {
      case "playback.metrics":
      case "playback.started":
      case "playback.failed":
      case "playback.drained":
      case "playback.skipped":
        if (conn.role !== "screen" || !ownsSession(conn) || !playback || event.turnId !== audioId || playback.seq !== turnSeq) return;
        // Esc remains meaningful after drained, throughout the current followup.
        if (event.type === "playback.failed" && event.reason === "dismissed") {
          if (state.name === "answering" || state.name === "followup") forceClose("force");
          return;
        }
        if (playback.finished || state.name !== "answering") return;
        if (event.type === "playback.metrics") {
          playback.record.playbackContextRate = event.playbackContextRate;
          playback.record.playbackUnderruns = Math.max(playback.record.playbackUnderruns ?? 0, event.playbackUnderruns);
          emitTrace(playback.record);
          return;
        }
        if (event.type === "playback.skipped") {
          if (event.sentenceIndex >= (answer?.sentences.length ?? 0)) return;
          const skipped = playback.record.playbackSkipped ??= [];
          if (skipped.some(s => s.sentenceIndex === event.sentenceIndex)) return;
          skipped.push({ sentenceIndex: event.sentenceIndex, reason: event.reason });
          emitTrace(playback.record);
          return;
        }
        if (event.type === "playback.started") {
          if (playback.record.playbackStartMs == null) {
            // Hub receipt clock: no subtraction of clocks on different machines.
            playback.record.playbackStartMs = Math.max(0, Date.now() - Date.parse(playback.record.ts));
            emitTrace(playback.record);
          }
        } else {
          if (event.type === "playback.failed") playback.record.playbackFailureReason = event.reason;
          spoken(playback.seq, event.type === "playback.drained" ? "drained" : event.reason === "timeout" ? "timeout" : "failed");
        }
        return;
      case "hub.auth": {
        if (!hubAuth || conn.role !== "unknown") return;
        if (tokensMatch(hubAuth.consoleToken, event.token)) conn.role = "console";
        else if (tokensMatch(hubAuth.screenToken, event.token)) conn.role = "screen";
        else {
          conn.close(4401);
          return;
        }
        conn.send({ type: "hub.hello", at: Date.now(), ...hub.counts(), ...(conn.role === "screen" ? { screenId: conn.id } : {}) });
        broadcast({ type: "hub.hello", at: Date.now(), ...hub.counts() });
        return;
      }
      case "console.hello":
        if (hubAuth) return; // 鉴权模式下角色只由令牌决定
        // 角色只允许声明一次,防止已接入连接中途切换成 console 提权;
        // 重复 hello 直接忽略,不再广播(审核 L6)
        if (conn.role !== "unknown") return;
        conn.role = event.role;
        conn.send({ type: "hub.hello", at: Date.now(), ...hub.counts(), ...(conn.role === "screen" ? { screenId: conn.id } : {}) });
        broadcast({ type: "hub.hello", at: Date.now(), ...hub.counts() });
        return;
      case "session.wake":
      case "session.close":
      case "question.submit":
        // 控制面仅 console 角色(大屏与未声明角色一律只读)
        if (conn.role !== "console") return;
        break;
    }
    switch (event.type) {
      case "session.wake":
        beginSession();
        return;
      case "session.close":
        forceClose("force");
        return;
      case "question.submit": {
        if (rateLimited()) {
          conn.send({ type: "error", at: Date.now(), code: "rate_limited", message: "提问太频繁,请稍候。" });
          return;
        }
        inputController?.abort(); inputController = null;
        acceptQuestion(event.text.trim());
        return;
      }
    }
  }

  /** 全局限流:最小间隔 + 滑动窗口上限(按 hub 计,不按连接计) */
  function rateLimited(): boolean {
    const now = Date.now();
    askedAt = askedAt.filter((t) => now - t < questionWindowMs);
    const last = askedAt[askedAt.length - 1] ?? 0;
    if (now - last < questionMinGapMs || askedAt.length >= questionWindowMax) return true;
    askedAt.push(now);
    return false;
  }

  function acceptQuestion(question: string): void {
    switch (state.name) {
      case "ambient":
        pendingQuestion = question;
        beginSession();
        return;
      case "waking":
        pendingQuestion = question; // 成型动画走完再进主链路
        return;
      case "closing":
      case "error-fallback":
        return; // 退场必须走完;降级播报不打断
      case "listening":
        break;
      case "thinking":
        dispatch({ type: "THINKING_VOICE", at: Date.now() });
        break;
      case "answering":
        dispatch({ type: "BARGE_IN", at: Date.now() });
        break;
      case "followup":
        dispatch({ type: "SPEAK", at: Date.now() });
        break;
    }
    clearTimers(); listenWindow?.stop(); listenWindow = null; clearWakeGuard();
    cancelAudio();
    clearActiveTurn(); // 旧轮的分类/死线立即释放
    answer = null;
    void runQuestion(question);
  }

  /* ---------- 提问主链路:预取并行于 ASR 视觉节奏 ---------- */

  function runQuestion(question: string): void {
    const voiceInput = inputMeta !== null;
    const seq = ++turnSeq;

    // 预取立刻启动(方案灵魂:与逐字/思考并行,主路径零工具轮)。
    // 带超时:平台接口挂起时该轮走数据源降级,而不是永远 thinking;
    // 与轮控制器 any 组合:被新问题顶替时立即中止外呼。
    const controller = new AbortController();
    const prefetch = dataSource.fetchPayload(
      AbortSignal.any([controller.signal, AbortSignal.timeout(prefetchTimeoutMs)]),
    );
    prefetch.catch(() => {}); // 拒绝在 answerPhase 接手前不触发 unhandledRejection
    runQuestionTurn(seq, question, prefetch, controller);

    if (voiceInput) {
      dispatch({ type: "PARTIAL", at: Date.now(), text: question });
      broadcast({ type: "asr.partial", at: Date.now(), text: question, final: true });
      dispatch({ type: "SUBMIT", at: Date.now(), question });
      return;
    }
    const pace = Math.min(
      partialPaceMs,
      Math.max(1, Math.floor(partialMaxTotalMs / Math.max(1, question.length))),
    );
    const typeDoneMs = pace * question.length + pace;
    for (let i = 1; i <= question.length; i++) {
      later(pace * i, () => {
        if (seq !== turnSeq || state.name !== "listening") return;
        const text = question.slice(0, i);
        // PARTIAL 是镜像自环(dispatch 不广播),转写要单独上线
        dispatch({ type: "PARTIAL", at: Date.now(), text });
        broadcast({ type: "asr.partial", at: Date.now(), text, final: i === question.length });
      });
    }
    later(typeDoneMs, () => {
      if (seq !== turnSeq || state.name !== "listening") return;
      dispatch({ type: "SUBMIT", at: Date.now(), question });
    });
  }

  /** 思考阶段:partial 视觉节奏走完再起 LLM;死线与轮控制器归入 activeTurn,
   *  被新问题顶替时统一释放(安全审核:旧轮不再空跑到死线/误判超时)。 */
  function runQuestionTurn(
    seq: number,
    question: string,
    prefetch: Promise<PublicSalesScreenPayload>,
    controller: AbortController,
  ): void {
    const meta = inputMeta; inputMeta = null;
    const tracer = new TurnTracer(sessionId, state.turns, question, meta?.started);
    if (meta) Object.assign(tracer, { voiceMeta: meta });
    const pace = Math.min(
      partialPaceMs,
      Math.max(1, Math.floor(partialMaxTotalMs / Math.max(1, question.length))),
    );
    const deadlineState: { fired: boolean; timer: NodeJS.Timeout | null } = { fired: false, timer: null };
    deadlineState.timer = setTimeout(() => {
      deadlineState.fired = true;
      controller.abort(new Error("llm deadline"));
    }, llmTimeoutMs);
    activeTurn = { controller, deadline: deadlineState.timer! };

    if (meta) {
      later(0, () => { if (seq === turnSeq) void answerPhase(seq, tracer, question, prefetch, controller, deadlineState); });
      return;
    }
    // partial 视觉节奏(pace*len)走完并 SUBMIT(typeDoneMs)后再起 LLM 阶段
    later(pace * question.length + pace * 2, () => {
      if (seq !== turnSeq) return;
      void answerPhase(seq, tracer, question, prefetch, controller, deadlineState);
    });
  }

  async function answerPhase(
    seq: number,
    tracer: TurnTracer,
    question: string,
    prefetch: Promise<PublicSalesScreenPayload>,
    controller: AbortController,
    deadlineState: { fired: boolean; timer: NodeJS.Timeout | null },
  ): Promise<void> {
    let predicted: AudioTurn | null = null;
    let predictionAccepted = false;
    let speculativeRecord: TurnTraceRecord | null = null;
    const cancelPrediction = () => { if (predicted) options.audio?.cancel(predicted.id); };
    controller.signal.addEventListener("abort", cancelPrediction, { once: true });
    try {
      /* ---- 预取 ---- */
      const payload = await prefetch;
      if (seq !== turnSeq || controller.signal.aborted) { controller.signal.removeEventListener("abort", cancelPrediction); return; }
      tracer.mark("prefetch");
      /* ---- LLM 只选意图；不发送快照、不执行工具轮 ---- */
      const classifyStart = performance.now();
      const classification = llm.classify(question, controller.signal);
      classification.catch(() => {});
      const guess = classifyScriptedQuestion(question);
      if (options.audio?.ready && !["unanswerable", "greeting", "chitchat_or_end"].includes(guess) && !controller.signal.aborted) {
        const draft = buildIntentAnswer(guess, payload);
        predicted = options.audio?.start(buildSpokenSentences(clampAnswerText(draft.spoken)), metrics => {
          if (predictionAccepted && speculativeRecord && seq === turnSeq) { Object.assign(speculativeRecord, metrics); emitTrace(speculativeRecord); }
        }, speechStyleFor(guess, payload, options.styleOverrides)) ?? null;
      }
      const classified = await classification;
      const classifyMs = performance.now() - classifyStart;
      if (seq !== turnSeq) { cancelPrediction(); controller.signal.removeEventListener("abort", cancelPrediction); return; }
      if (controller.signal.aborted) throw new LlmError("LLM 分类超时", "llm_timeout");
      clearTimeout(deadlineState.timer ?? undefined);
      activeTurn = null;
      const intent = isIntent(classified) && !hasUnsupportedScope(question) ? classified : "unanswerable";
      const speculative = predicted ? intent === guess ? "hit" : "miss" : "none";
      predictionAccepted = speculative === "hit";
      if (predicted && speculative === "miss") { cancelPrediction(); predicted = null; }
      controller.signal.removeEventListener("abort", cancelPrediction);
      answerIntent = intent;
      failures = intent === "unanswerable" ? failures + 1 : 0;
      if (voiceSession && failures >= 2) {
        const record = tracer.finish({ source: "payload", card: null, degraded: true, classifyMs });
        record.speculative = speculative; await trace.append(record); emitTrace(record); idleExit(); return;
      }
      const routed = buildIntentAnswer(intent, payload);
      const snapshot = buildInjectedContext(payload); // 仅供本地备用护栏，不进入模型
      const verdict = sanitizeAnswer(routed.spoken, snapshot);
      const violations = verdict.degraded ? verifyAnswerNumbers(routed.spoken, snapshot).violations : [];
      const degraded = routed.unanswerable;
      const finalSpoken = clampAnswerText(routed.spoken);
      const card: AnswerCardData = { ...routed.card, spoken: finalSpoken };
      answer = { ...routed, card, spoken: finalSpoken, sentences: buildSpokenSentences(finalSpoken) };
      const source = "payload" as const;

      tracer.mark("answerFull");
      const record = tracer.finish({
        source,
        card: card.kind,
        degraded,
        classifyMs,
        ...(violations.length ? { numberGuardViolations: violations } : {}),
      });
      const requestedStyle = speechStyleFor(intent, payload, options.styleOverrides);
      const style = options.audio?.resolveStyle(requestedStyle) ?? requestedStyle;
      record.speculative = speculative;
      record.style = style;
      if (style !== requestedStyle) record.styleFallback = requestedStyle;
      Object.assign(record, (tracer as TurnTracer & { voiceMeta?: object }).voiceMeta ?? {});
      const fixedKey = intent === "chitchat_or_end" ? "goodbye" : intent === "greeting" ? "wake" : null;
      const fixedSentences = [{ index: 0, text: finalSpoken, spokenText: finalSpoken, displayStart: 0, displayEnd: finalSpoken.length }];
      speculativeRecord = record;
      const audioTurn = predicted ?? (fixedKey ? options.audio?.startFixed(fixedKey, fixedSentences) : options.audio?.start(answer.sentences, (metrics) => {
        Object.assign(record, metrics);
        if (seq === turnSeq) emitTrace(record);
      }, requestedStyle));
      if (predicted) Object.assign(record, predicted.metrics);
      if (audioTurn?.descriptor.style) { record.style = audioTurn.descriptor.style; if (record.style !== requestedStyle) record.styleFallback = requestedStyle; }
      audioId = audioTurn?.id ?? null;
      if (audioTurn) {
        record.asrMs ??= null; record.playbackStartMs = null;
        const p = { id: audioTurn.id, seq, record, synthesisDone: false, finished: false, written: false, waitingForScreens: false };
        playback = p;
        void audioTurn.completed.then(() => {
          Object.assign(record, audioTurn.metrics);
          p.synthesisDone = true;
          persistPlayback(p);
        });
      } else await trace.append(record);
      if (seq !== turnSeq) return;
      emitTrace(record);

      /* ---- 发射:tool.invoke → answer.delta…(末片携卡)→ ANSWER ---- */
      broadcast({
        type: "tool.invoke",
        at: Date.now(),
        card: card.kind,
        source,
        latencyMs: record.stages.prefetch,
      });

      const chunkSize = Math.max(8, Math.ceil(finalSpoken.length / 3));
      const pieces: string[] = [];
      for (let offset = 0; offset < finalSpoken.length; offset += chunkSize) {
        pieces.push(finalSpoken.slice(offset, offset + chunkSize));
      }
      if (pieces.length === 0) pieces.push("");

      const turn = state.turns + 1;
      pieces.forEach((text, index) => {
        const isLast = index === pieces.length - 1;
        later(record.asrMs != null ? 0 : index * 40, () => {
          if (seq !== turnSeq) return;
          broadcast({
            type: "answer.delta",
            at: Date.now(),
            seq: index,
            text,
            full: isLast,
            ...(isLast ? { card, ...(audioTurn ? { speech: audioTurn.descriptor } : {}) } : {}),
          });
          if (!isLast) return;
          // 末片落卡:镜像进 answering(大屏由随后的 state.change 驱动 ANSWER)
          dispatch({ type: "ANSWER", at: Date.now(), card });
          if (audioTurn && intent !== "chitchat_or_end") startBarge(audioTurn.id);
          if (audioTurn && intent === "chitchat_or_end") goodbyeId = audioTurn.id;
          if (audioTurn && hub.counts().screens > 0) {
            if (playback) playback.waitingForScreens = true;
            const timeout = audioTurn.descriptor.fixed
              ? (audioTurn.bytes / 48000) * 2000 + 2000
              : playbackFallbackMs(finalSpoken);
            later(timeout, () => spoken(seq, "timeout"));
          } else if (!audioTurn && intent === "chitchat_or_end") forceClose("decline");
          else {
            // Text-only/no-screen installations preserve exhibition pacing and
            // keep synthesis/cache alive; nobody can acknowledge browser audio.
            const typeMs = (finalSpoken.length / LAUNCH.typeCps) * 1000;
            later(LAUNCH.unfoldStartMs + LAUNCH.unfoldMs + typeMs + DEMO_TIMING.answerHoldMs, () => spoken(seq, "drained"));
          }
        });
      });
      void turn;
    } catch (err) {
      cancelPrediction(); controller.signal.removeEventListener("abort", cancelPrediction);
      if (seq !== turnSeq) return;
      clearTimeout(deadlineState.timer ?? undefined);
      activeTurn = null;
      await degrade(seq, tracer, classify(err, deadlineState.fired));
    }
  }

  /* ---------- 降级路径(plan §16.2 C) ---------- */

  function classify(err: unknown, deadlineDidFire: boolean): { code: VoiceErrorCode; message: string } {
    if (deadlineDidFire) return { code: "llm_timeout", message: "LLM 思考超时" };
    if (err instanceof LlmError) return { code: err.code, message: err.message };
    if ((err as { code?: string })?.code === "datasource") {
      return { code: "datasource", message: (err as Error).message };
    }
    return { code: "internal", message: (err as Error)?.message ?? String(err) };
  }

  async function degrade(
    seq: number,
    tracer: TurnTracer,
    err: { code: VoiceErrorCode; message: string },
  ): Promise<void> {
    cancelAudio(); failures++;
    if (voiceSession && failures >= 2) { idleExit(); return; }
    const record = tracer.finish({ source: "payload", card: null, degraded: true });
    await trace.append(record);
    emitTrace(record);
    clearTimers();
    // 大屏只读 code 映射降级话术;细节日志本地打印(已脱敏)
    broadcast({
      type: "error",
      at: Date.now(),
      code: err.code,
      message: "抱歉先生,数据暂时无法调取,请稍后再试。",
    });
    dispatch({ type: "ERROR", at: Date.now(), message: err.code });
    if (voiceSession && playFixed("fallback", "close")) return;
    later(DEMO_TIMING.errorHoldMs, () => {
      if (seq !== turnSeq || state.name !== "error-fallback") return;
      dispatch({ type: "ERROR_SPOKEN", at: Date.now() });
      broadcast({ type: "session.end", at: Date.now(), reason: "error" });
      later(VOICE_TIMING.closingMs, () => dispatch({ type: "CLOSED", at: Date.now() }));
    });
  }

  return {
    handleClientMessage,
    inputActivity,
    submitUtterance,
    beginListening(): boolean { if (state.name !== "followup" || fixedPlayback) return false; clearTimers(); dispatch({ type: "SPEAK", at: Date.now() }); if (voiceSession) startListen("listening"); return true; },
    beginSession,
    forceClose,
    attach(conn: HubConnection): void {
      conn.send({ type: "hub.hello", at: Date.now(), ...hub.counts() });
    },
    detach(conn: HubConnection): void {
      if (conn.role === "screen" && conn.id === sessionScreenId && state.name !== "ambient") { if (playback && !playback.finished) playback.record.playbackFailureReason = "screen_disconnected"; forceClose("error"); return; }
      if (conn.role === "screen" && hub.counts().screens === 0 && playback?.waitingForScreens && !playback.finished) {
        spoken(playback.seq, "drained");
      }
    },
    get state(): VoiceSessionState {
      return state;
    },
    /** 显示文本与中文读法分离，供后续 TTS 管线消费。 */
    get answer(): ReturnType<typeof buildIntentAnswer> | null {
      return answer;
    },
    get inputLease(): InputLease | null { return listenWindow?.lease ?? null; },
    get sessionId(): string {
      return sessionId;
    },
  };
}
