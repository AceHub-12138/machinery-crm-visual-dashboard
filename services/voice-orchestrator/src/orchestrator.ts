/**
 * 会话编排(plan §16.2 C):提问 → 并行预取 → LLM(注入快照,主路径零
 * 工具轮)→ 卡片选型 → 事件广播;三条降级路径(数据源异常 / LLM 超时或
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

import { randomUUID } from "node:crypto";
import {
  buildBriefCard,
  clampAnswerText,
  VOICE_COVERAGE_FALLBACK,
} from "../../../src/lib/voice/card-builders.ts";
import type { PublicSalesScreenPayload } from "../../../src/lib/voice/public-payload.ts";
import type {
  ConsoleWireEvent,
  TurnTracePayload,
  VoiceErrorCode,
  VoiceWireEvent,
} from "../../../src/lib/voice/protocol.ts";
import { routeQuestion } from "./llm/scripted.ts";
import type { LlmAdapter, LlmMessage, LlmToolCall } from "./llm/types.ts";
import { LlmError } from "./llm/types.ts";
import { tokensMatch } from "./guard/token.ts";
import { buildInjectedContext, INJECTION_CONSTRAINT, sanitizeAnswer } from "./datasource/inject-context.ts";
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
import { LAUNCH } from "../../../src/lib/voice/params.ts";

export type OrchestratorOptions = {
  hub: VoiceHubServer;
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

/** console 控制事件 fail-closed 解析(大屏不发任何事件)。 */
export function parseConsoleEvent(raw: string): ConsoleWireEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const ev = data as ConsoleWireEvent;
  if (typeof (ev as { at?: unknown }).at !== "number") return null;
  switch (ev.type) {
    case "console.hello":
      return ev.role === "console" || ev.role === "screen" ? ev : null;
    case "hub.auth":
      return typeof ev.token === "string" && ev.token.length > 0 && ev.token.length <= 256 ? ev : null;
    case "session.wake":
    case "session.close":
      return ev;
    case "question.submit":
      return typeof ev.text === "string" && ev.text.trim().length > 0 && ev.text.length <= 500 ? ev : null;
    default:
      return null;
  }
}

export function createVoiceOrchestrator(options: OrchestratorOptions) {
  const {
    hub, dataSource, llm, mcp, trace, llmTimeoutMs, partialPaceMs, partialMaxTotalMs,
    prefetchTimeoutMs, questionMinGapMs, questionWindowMs, questionWindowMax, mcpToolWhitelist,
    hubAuth = null,
  } = options;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));

  /** scripted 适配器注入预取 payload 的口子(替代真实 LLM 的上下文注入) */
  const scripted = llm as LlmAdapter & { usePayload?: (p: PublicSalesScreenPayload) => void };

  let state: VoiceSessionState = initSessionState(Date.now());
  let sessionId = "";
  let turnSeq = 0; // 每次提问递增;一切延迟回调持有所属 seq,过期即弃
  let pendingQuestion: string | null = null;
  const history: LlmMessage[] = [];
  const timers = new Set<{ clear: () => void }>();

  /** 进行中的一轮:新问题到来时中止旧轮(LLM 流/死线一并释放) */
  let activeTurn: { controller: AbortController; deadline: NodeJS.Timeout | null } | null = null;
  /** 提问限流账本:全局一份(审核 M4:按连接计可被多连接绕过) */
  let askedAt: number[] = [];

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
        },
      },
      (conn) => conn.role === "console",
    );
  }

  function later(ms: number, fn: () => void): void {
    const handle = { clear: () => clearTimer(t) };
    const t = setTimer(() => {
      timers.delete(handle);
      fn();
    }, Math.max(0, ms));
    timers.add(handle);
  }

  function clearTimers(): void {
    for (const handle of timers) handle.clear();
    timers.clear();
  }

  /* ---------- 会话生命周期 ---------- */

  function beginSession(): void {
    if (state.name !== "ambient") return;
    sessionId = `sess-${randomUUID().slice(0, 8)}`;
    history.length = 0; // 跨会话不共享上下文(展厅换人不带上一任的问答)
    broadcast({ type: "session.start", at: Date.now(), sessionId });
    dispatch({ type: "WAKE", at: Date.now() });
    later(VOICE_TIMING.wakingMs, () => {
      dispatch({ type: "WOKEN", at: Date.now() });
      if (pendingQuestion) {
        const question = pendingQuestion;
        pendingQuestion = null;
        acceptQuestion(question);
      }
    });
  }

  function forceClose(reason: "force" | "decline"): void {
    if (state.name === "ambient" || state.name === "closing") return;
    clearTimers();
    clearActiveTurn(); // 审核 M1:关闭即中止进行中的 LLM 流/预取/死线
    turnSeq += 1;
    dispatch({ type: "FORCE_CLOSE", at: Date.now() });
    broadcast({ type: "session.end", at: Date.now(), reason });
    later(VOICE_TIMING.closingMs, () => dispatch({ type: "CLOSED", at: Date.now() }));
  }

  /* ---------- 入口:console 控制事件 ---------- */

  function handleClientMessage(conn: HubConnection, raw: string): void {
    const event = parseConsoleEvent(raw);
    if (!event) return;
    switch (event.type) {
      case "hub.auth": {
        if (!hubAuth || conn.role !== "unknown") return;
        if (tokensMatch(hubAuth.consoleToken, event.token)) conn.role = "console";
        else if (tokensMatch(hubAuth.screenToken, event.token)) conn.role = "screen";
        else {
          conn.close(4401);
          return;
        }
        broadcast({ type: "hub.hello", at: Date.now(), ...hub.counts() });
        return;
      }
      case "console.hello":
        if (hubAuth) return; // 鉴权模式下角色只由令牌决定
        // 角色只允许声明一次,防止已接入连接中途切换成 console 提权;
        // 重复 hello 直接忽略,不再广播(审核 L6)
        if (conn.role !== "unknown") return;
        conn.role = event.role;
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
    clearTimers();
    clearActiveTurn(); // 旧轮的 LLM 流/死线立即释放,不再空跑到死线
    void runQuestion(question);
  }

  /* ---------- 提问主链路:预取并行于 ASR 视觉节奏 ---------- */

  function runQuestion(question: string): void {
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
    const tracer = new TurnTracer(sessionId, state.turns, question);
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

    try {
      /* ---- 预取 ---- */
      const payload = await prefetch;
      if (seq !== turnSeq) return;
      tracer.mark("prefetch");
      scripted.usePayload?.(payload);

      /* ---- LLM 流式(工具轮仅长尾;主路径零工具轮) ---- */
      const snapshot = buildInjectedContext(payload);
      const { spoken, source, toolLatencyMs } = await streamAnswer(question, snapshot, controller.signal, tracer);
      if (seq !== turnSeq) return;
      clearTimeout(deadlineState.timer ?? undefined);
      activeTurn = null;

      /* ---- 卡片选型 + 数字护栏(防幻觉红线,F) ---- */
      const routed = routeQuestion(question, payload, payload.period.label);
      const verdict = sanitizeAnswer(spoken, snapshot);
      const degraded = verdict.degraded || routed.unanswerable;
      // 与卡片上限对齐:逐字流与末片卡片用同一份截断后的文本(审核 第 8 步)
      const finalSpoken = clampAnswerText(degraded ? VOICE_COVERAGE_FALLBACK : verdict.text);
      const card: AnswerCardData = degraded
        ? buildBriefCard("小川", [finalSpoken])
        : (routed.card ?? buildBriefCard("小川", [finalSpoken]));

      tracer.mark("answerFull");
      const record = tracer.finish({
        source,
        card: degraded ? "brief" : (routed.cardId ?? "brief"),
        degraded,
      });
      await trace.append(record);
      emitTrace(record);

      /* ---- 发射:tool.invoke → answer.delta…(末片携卡)→ ANSWER ---- */
      broadcast({
        type: "tool.invoke",
        at: Date.now(),
        card: card.kind,
        source,
        latencyMs: toolLatencyMs ?? record.stages.prefetch,
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
        later(index * 40, () => {
          if (seq !== turnSeq) return;
          broadcast({
            type: "answer.delta",
            at: Date.now(),
            seq: index,
            text,
            full: isLast,
            ...(isLast ? { card } : {}),
          });
          if (!isLast) return;
          // 末片落卡:镜像进 answering(大屏由随后的 state.change 驱动 ANSWER)
          dispatch({ type: "ANSWER", at: Date.now(), card });
          history.push({ role: "user", content: question }, { role: "assistant", content: finalSpoken });
          if (history.length > 8) history.splice(0, history.length - 8);

          /* ---- 播报计时 → 追问 → 退场(与覆盖层同常量) ---- */
          const typeMs = (finalSpoken.length / LAUNCH.typeCps) * 1000;
          later(LAUNCH.unfoldStartMs + LAUNCH.unfoldMs + typeMs + DEMO_TIMING.answerHoldMs, () => {
            if (seq !== turnSeq || state.name !== "answering") return;
            dispatch({ type: "SPOKEN", at: Date.now() });
            later(VOICE_TIMING.followupMs, () => {
              if (seq !== turnSeq || state.name !== "followup") return;
              dispatch({ type: "FOLLOWUP_TIMEOUT", at: Date.now() });
              broadcast({ type: "session.end", at: Date.now(), reason: "followup_timeout" });
              later(VOICE_TIMING.closingMs, () => dispatch({ type: "CLOSED", at: Date.now() }));
            });
          });
        });
      });
      void turn;
    } catch (err) {
      if (seq !== turnSeq) return;
      clearTimeout(deadlineState.timer ?? undefined);
      activeTurn = null;
      await degrade(seq, tracer, classify(err, deadlineState.fired));
    }
  }

  /** LLM 流式聚合;长尾工具轮在这里发生。 */
  async function streamAnswer(
    question: string,
    snapshot: string,
    signal: AbortSignal,
    tracer: TurnTracer,
  ): Promise<{ spoken: string; source: "payload" | "mcp"; toolLatencyMs: number | null }> {
    const messages: LlmMessage[] = [
      { role: "system", content: INJECTION_CONSTRAINT },
      ...history,
      { role: "user", content: `【经营数据快照】\n${snapshot}\n\n【先生的问题】${question}` },
    ];

    let spoken = "";
    let toolCall: LlmToolCall | null = null;
    let firstToken = false;
    for await (const chunk of llm.stream({ messages, signal })) {
      if (chunk.type === "delta") {
        if (!firstToken) {
          firstToken = true;
          tracer.mark("llmFirstToken");
        }
        spoken += chunk.text;
      } else if (chunk.type === "tool_call") {
        toolCall = chunk.call;
      } else if (chunk.type === "done" && chunk.finishReason === "timeout") {
        throw new LlmError("LLM 思考超时", "llm_timeout");
      }
    }
    if (signal.aborted) throw new LlmError("LLM 思考超时", "llm_timeout");

    let source: "payload" | "mcp" = "payload";
    let toolLatencyMs: number | null = null;
    if (toolCall) {
      if (!mcp) {
        // 视觉仓阶段 MCP flag 关:长尾问题没有数据来源 → fail-closed 降级
        return { spoken: VOICE_COVERAGE_FALLBACK, source: "payload", toolLatencyMs: null };
      }
      // 工具白名单:工具名/参数来自 LLM,而问题是攻击者可控的(提示词注入),
      // 只依赖平台端只读 key 不够——不在名单内的工具一律按覆盖缺口降级。
      if (!mcpToolWhitelist.includes(toolCall.name)) {
        return { spoken: VOICE_COVERAGE_FALLBACK, source: "payload", toolLatencyMs: null };
      }
      const startedAt = Date.now();
      tracer.mark("toolExec");
      let toolAnswer = "";
      try {
        const result = await mcp.callTool(toolCall.name, safeJson(toolCall.arguments), signal);
        toolAnswer = result.content.map((part) => part.text ?? "").join("\n");
      } catch (err) {
        throw new LlmError(`MCP 工具轮失败: ${(err as Error).message}`, "llm_unavailable");
      }
      toolLatencyMs = Date.now() - startedAt;
      source = "mcp";

      // 带工具结果进行第二轮(同样受死线约束)
      const secondRound: LlmMessage[] = [
        ...messages,
        { role: "assistant", content: "" },
        { role: "tool", name: toolCall.name, content: toolAnswer },
      ];
      let second = "";
      let secondFirst = false;
      for await (const chunk of llm.stream({ messages: secondRound, signal })) {
        if (chunk.type === "delta") {
          if (!secondFirst) {
            secondFirst = true;
            tracer.mark("llmFirstToken");
          }
          second += chunk.text;
        }
      }
      if (signal.aborted) throw new LlmError("LLM 思考超时", "llm_timeout");
      spoken = second;
    }

    return { spoken, source, toolLatencyMs };
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
    later(DEMO_TIMING.errorHoldMs, () => {
      if (seq !== turnSeq || state.name !== "error-fallback") return;
      dispatch({ type: "ERROR_SPOKEN", at: Date.now() });
      broadcast({ type: "session.end", at: Date.now(), reason: "error" });
      later(VOICE_TIMING.closingMs, () => dispatch({ type: "CLOSED", at: Date.now() }));
    });
  }

  return {
    handleClientMessage,
    beginSession,
    forceClose,
    attach(conn: HubConnection): void {
      conn.send({ type: "hub.hello", at: Date.now(), ...hub.counts() });
    },
    get state(): VoiceSessionState {
      return state;
    },
    get sessionId(): string {
      return sessionId;
    },
  };
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
