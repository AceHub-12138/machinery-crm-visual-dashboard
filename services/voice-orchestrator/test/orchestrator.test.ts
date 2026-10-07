import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceOrchestrator, parseConsoleEvent } from "../src/orchestrator.ts";
import { ScriptedAdapter } from "../src/llm/scripted.ts";
import type { HubConnection, VoiceHubServer } from "../src/ws/ws-server.ts";
import { TraceSink } from "../src/trace/metrics.ts";
import { dataSourceError, type SalesScreenDataSource } from "../src/datasource/index.ts";
import fixture from "../fixtures/public-sales-screen.json";
import { validatePublicPayload, type PublicSalesScreenPayload } from "../../../src/lib/voice/public-payload.ts";
import { VOICE_COVERAGE_FALLBACK } from "../../../src/lib/voice/card-builders.ts";
import { buildIntentAnswer } from "../../../src/lib/voice/intent-answers.ts";
import { DEMO_QUESTIONS } from "../../../src/lib/voice/demo-questions.ts";
import { OpenAiCompatibleAdapter } from "../src/llm/zhipu.ts";
import { classifyScriptedQuestion } from "../../../src/lib/voice/intents.ts";
import type { VoiceWireEvent } from "../../../src/lib/voice/protocol.ts";

const payload = validatePublicPayload(fixture) as PublicSalesScreenPayload;

function fakeHub() {
  const events: VoiceWireEvent[] = [];
  const hub = {
    broadcast: (p: unknown) => events.push(structuredClone(p) as VoiceWireEvent),
    connections: new Set<HubConnection>(),
    counts: () => ({ screens: 1, consoles: 1 }),
  } as unknown as VoiceHubServer;
  return { hub, events };
}

function fakeConn(): HubConnection {
  return { id: "c1", role: "console", send: () => {}, close: () => {} };
}

function fakeSource(impl?: () => Promise<PublicSalesScreenPayload>): SalesScreenDataSource {
  return {
    name: "fake",
    fetchPayload: impl ?? (async () => payload),
  };
}

function consoleSend(text: string): string {
  return JSON.stringify({ type: "question.submit", at: Date.now(), text });
}

/** 去掉 asr.partial 的骨架序列(逐字条数与问题长度一致,单独断言)。 */
function skeleton(events: VoiceWireEvent[]): string[] {
  return events
    .filter((ev) => ev.type !== "asr.partial" && ev.type !== "trace.turn")
    .map((ev) => {
      switch (ev.type) {
        case "state.change":
          return `state.change ${ev.from}→${ev.to}`;
        case "answer.delta":
          return `answer.delta full=${ev.full}`;
        case "session.end":
          return `session.end ${ev.reason}`;
        case "error":
          return `error ${ev.code}`;
        case "tool.invoke":
          return `tool.invoke ${ev.source} card=${ev.card ?? "-"}`;
        case "session.start":
          return "session.start";
        default:
          return ev.type;
      }
    });
}

describe("orchestrator — 完整问答链路(脚本适配器,假定时器)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("提问 → 预取 → 作答 → 追问 → 退场,事件顺序符合协议", async () => {
    const { hub, events } = fakeHub();
    const llm = new ScriptedAdapter();
    const orch = createVoiceOrchestrator({
      hub,
      dataSource: fakeSource(),
      llm,
      mcp: null,
      trace: new TraceSink(null),
      llmTimeoutMs: 8000,
      partialPaceMs: 45,
      partialMaxTotalMs: 1200,
      prefetchTimeoutMs: 5000,
      questionMinGapMs: 0,
      questionWindowMs: 60_000,
      questionWindowMax: 100,
      mcpToolWhitelist: [],
    });

    orch.handleClientMessage(fakeConn(), consoleSend("本月销售情况怎么样?"));
    // ambient → 直接排队唤醒
    expect(events[0].type).toBe("session.start");

    for (let i = 0; i < 60 && orch.state.name !== "ambient"; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(orch.state.name).toBe("ambient");

    const question = "本月销售情况怎么样?";
    const partials = events.filter((ev) => ev.type === "asr.partial");
    expect(partials).toHaveLength(question.length);

    expect(skeleton(events)).toEqual([
      "session.start",
      "state.change ambient→waking",
      "state.change waking→listening",
      "state.change listening→thinking",
      "tool.invoke payload card=target-progress",
      "answer.delta full=false",
      "answer.delta full=false",
      "answer.delta full=true",
      "state.change thinking→answering",
      "state.change answering→followup",
      "state.change followup→closing",
      "session.end followup_timeout",
      "state.change closing→ambient",
    ]);

    // 末片携卡,数字与 fixture 同源(口径一致性在 wire 层的投影)
    const full = events.find((ev) => ev.type === "answer.delta" && ev.full)! as Extract<
      VoiceWireEvent,
      { type: "answer.delta" }
    >;
    expect(full.card).toMatchObject({
      kind: "target-progress",
      actualText: "¥1,286.0万",
      completionRate: 85.7,
    });

    // 非流式分类耗时单独记录，不冒充首 token。
    const trace = events.find((ev) => ev.type === "trace.turn") as Extract<VoiceWireEvent, { type: "trace.turn" }>;
    expect(trace.trace.stages.prefetch).not.toBeNull();
    expect(trace.trace.stages.llmFirstToken).toBeNull();
    expect(trace.trace.classifyMs).toBeGreaterThanOrEqual(0);
    expect(trace.trace.stages.answerFull).not.toBeNull();
    expect(trace.trace.degraded).toBe(false);
  });

  it("覆盖缺口问题(华南退货率)必降级为固定话术", async () => {
    const { hub, events } = fakeHub();
    const orch = createVoiceOrchestrator({
      hub,
      dataSource: fakeSource(),
      llm: new ScriptedAdapter(),
      mcp: null,
      trace: new TraceSink(null),
      llmTimeoutMs: 8000,
      partialPaceMs: 45,
      partialMaxTotalMs: 1200,
      prefetchTimeoutMs: 5000,
      questionMinGapMs: 0,
      questionWindowMs: 60_000,
      questionWindowMax: 100,
      mcpToolWhitelist: [],
    });

    orch.handleClientMessage(fakeConn(), consoleSend("华南退货率是多少?"));
    for (let i = 0; i < 60 && orch.state.name !== "ambient"; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }

    const full = events.find((ev) => ev.type === "answer.delta" && ev.full)! as Extract<
      VoiceWireEvent,
      { type: "answer.delta" }
    >;
    expect(full.card?.kind).toBe("brief");
    expect(full.card?.spoken).toBe(VOICE_COVERAGE_FALLBACK);
    const trace = events.find((ev) => ev.type === "trace.turn") as Extract<VoiceWireEvent, { type: "trace.turn" }>;
    expect(trace.trace.degraded).toBe(true);
  });
});

describe("orchestrator — 三条降级路径", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function runTurn(
    source: SalesScreenDataSource,
    llm: ScriptedAdapter,
    question = "本月销售情况怎么样?",
  ): Promise<{ events: VoiceWireEvent[]; stateName: () => string }> {
    const { hub, events } = fakeHub();
    const orch = createVoiceOrchestrator({
      hub,
      dataSource: source,
      llm,
      mcp: null,
      trace: new TraceSink(null),
      llmTimeoutMs: 2000,
      partialPaceMs: 45,
      partialMaxTotalMs: 1200,
      prefetchTimeoutMs: 5000,
      questionMinGapMs: 0,
      questionWindowMs: 60_000,
      questionWindowMax: 100,
      mcpToolWhitelist: [],
    });
    orch.handleClientMessage(fakeConn(), consoleSend(question));
    for (let i = 0; i < 60 && orch.state.name !== "ambient"; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }
    return { events, stateName: () => orch.state.name };
  }

  it("数据源异常(payload 500)→ error(datasource) → 优雅退场", async () => {
    const { events, stateName } = await runTurn(
      fakeSource(async () => {
        throw dataSourceError("payload 响应异常: HTTP 500", 500);
      }),
      new ScriptedAdapter(),
    );
    expect(events.some((ev) => ev.type === "error" && ev.code === "datasource")).toBe(true);
    expect(skeleton(events)).toEqual([
      "session.start",
      "state.change ambient→waking",
      "state.change waking→listening",
      "state.change listening→thinking",
      "error datasource",
      "state.change thinking→error-fallback",
      "state.change error-fallback→closing",
      "session.end error",
      "state.change closing→ambient",
    ]);
    expect(stateName()).toBe("ambient");
  });

  it("LLM 超时(脚本适配器模拟)→ error(llm_timeout) → 优雅退场", async () => {
    const { events, stateName } = await runTurn(
      fakeSource(),
      new ScriptedAdapter({ timeoutAfterMs: 3000 }),
      "各区域发货分布怎么样?",
    );
    expect(events.some((ev) => ev.type === "error" && ev.code === "llm_timeout")).toBe(true);
    expect(events.some((ev) => ev.type === "session.end" && ev.reason === "error")).toBe(true);
    expect(stateName()).toBe("ambient");
  });

  it("追问期再提问 → 旧卡回收直接 listening,二轮正常作答", async () => {
    const { hub, events } = fakeHub();
    const orch = createVoiceOrchestrator({
      hub,
      dataSource: fakeSource(),
      llm: new ScriptedAdapter(),
      mcp: null,
      trace: new TraceSink(null),
      llmTimeoutMs: 8000,
      partialPaceMs: 45,
      partialMaxTotalMs: 1200,
      prefetchTimeoutMs: 5000,
      questionMinGapMs: 0,
      questionWindowMs: 60_000,
      questionWindowMax: 100,
      mcpToolWhitelist: [],
    });
    const conn = fakeConn();
    orch.handleClientMessage(conn, consoleSend("本月销售情况怎么样?"));

    // 推进到 followup(第一问作答完成)
    for (let i = 0; i < 40 && orch.state.name !== "followup"; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(orch.state.name).toBe("followup");

    orch.handleClientMessage(conn, consoleSend("本月目标完成率是多少?"));
    await vi.advanceTimersByTimeAsync(500);
    expect(orch.state.name).toBe("listening");

    for (let i = 0; i < 60 && orch.state.name !== "ambient"; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(skeleton(events)).toContain("state.change thinking→answering");
    const fulls = events.filter((ev) => ev.type === "answer.delta" && ev.full);
    expect(fulls).toHaveLength(2);
    expect((fulls[1] as Extract<VoiceWireEvent, { type: "answer.delta" }>).card?.kind).toBe("completion-ring");
  });
});

describe("orchestrator — 安全加固(2026-09-28 审核)", () => {
  function setup(extra: Partial<Record<string, unknown>> = {}) {
    const { hub, events } = fakeHub();
    const orch = createVoiceOrchestrator({
      hub,
      dataSource: fakeSource(),
      llm: new ScriptedAdapter(),
      mcp: null,
      trace: new TraceSink(null),
      llmTimeoutMs: 8000,
      partialPaceMs: 45,
      partialMaxTotalMs: 1200,
      prefetchTimeoutMs: 5000,
      questionMinGapMs: 0,
      questionWindowMs: 60_000,
      questionWindowMax: 100,
      mcpToolWhitelist: [],
      ...extra,
    } as never);
    return { orch, events };
  }

  it("screen 角色与未声明角色发控制事件一律被忽略(只读)", () => {
    vi.useFakeTimers();
    const { orch, events } = setup();
    const screenConn = fakeConn();
    screenConn.role = "screen";
    orch.handleClientMessage(screenConn, consoleSend("本月销售情况怎么样?"));
    const unknownConn = fakeConn();
    unknownConn.role = "unknown";
    orch.handleClientMessage(unknownConn, consoleSend("本月销售情况怎么样?"));
    expect(events).toEqual([]); // 没有会话被创建
    vi.useRealTimers();
  });

  it("角色只允许声明一次(防中途提权)", () => {
    const { hub, events } = fakeHub();
    const orch = createVoiceOrchestrator({
      hub, dataSource: fakeSource(), llm: new ScriptedAdapter(), mcp: null,
      trace: new TraceSink(null), llmTimeoutMs: 8000, partialPaceMs: 45,
      partialMaxTotalMs: 1200, prefetchTimeoutMs: 5000, questionMinGapMs: 0,
      questionWindowMs: 60_000, questionWindowMax: 100, mcpToolWhitelist: [],
    });
    const conn = fakeConn();
    conn.role = "unknown";
    orch.handleClientMessage(conn, JSON.stringify({ type: "console.hello", at: 1, role: "screen" }));
    orch.handleClientMessage(conn, JSON.stringify({ type: "console.hello", at: 2, role: "console" }));
    expect(conn.role).toBe("screen"); // 第二次声明不生效
    orch.handleClientMessage(conn, consoleSend("x"));
    expect(events.filter((e: { type: string }) => e.type === "session.start")).toHaveLength(0);
  });

  it("限流:窗口内超过上限的提问被拒并回 rate_limited", () => {
    const { hub } = fakeHub();
    const orch = createVoiceOrchestrator({
      hub, dataSource: fakeSource(), llm: new ScriptedAdapter(), mcp: null,
      trace: new TraceSink(null), llmTimeoutMs: 8000, partialPaceMs: 45,
      partialMaxTotalMs: 1200, prefetchTimeoutMs: 5000, questionMinGapMs: 0,
      questionWindowMs: 60_000, questionWindowMax: 2, mcpToolWhitelist: [],
    });
    const sent: unknown[] = [];
    const conn: HubConnection = { id: "c", role: "console", send: (p) => sent.push(p), close: () => {} };
    orch.handleClientMessage(conn, consoleSend("问1"));
    orch.handleClientMessage(conn, consoleSend("问2"));
    orch.handleClientMessage(conn, consoleSend("问3"));
    expect(sent.some((e) => (e as { code?: string }).code === "rate_limited")).toBe(true);
  });

  it("trace.turn 只发给 console 角色(问题原文不给其他连接)", async () => {
    vi.useFakeTimers();
    const seenByRole: Array<{ role: string; types: string[] }> = [];
    const hub = {
      broadcast: (payload: unknown, filter?: (c: HubConnection) => boolean) => {
        for (const role of ["screen", "unknown", "console"]) {
          const conn = { role } as HubConnection;
          if (filter && !filter(conn)) continue;
          let entry = seenByRole.find((r) => r.role === role);
          if (!entry) seenByRole.push(entry = { role, types: [] });
          entry.types.push((payload as { type: string }).type);
        }
      },
      connections: new Set<HubConnection>(),
      counts: () => ({ screens: 1, consoles: 1 }),
    } as unknown as VoiceHubServer;
    const orch = createVoiceOrchestrator({
      hub, dataSource: fakeSource(), llm: new ScriptedAdapter(), mcp: null,
      trace: new TraceSink(null), llmTimeoutMs: 8000, partialPaceMs: 45,
      partialMaxTotalMs: 1200, prefetchTimeoutMs: 5000, questionMinGapMs: 0,
      questionWindowMs: 60_000, questionWindowMax: 100, mcpToolWhitelist: [],
    });
    orch.handleClientMessage(fakeConn(), consoleSend("本月销售情况怎么样?"));
    for (let i = 0; i < 40 && orch.state.name !== "ambient"; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }
    const byRole = Object.fromEntries(seenByRole.map((r) => [r.role, r.types]));
    expect(byRole.console).toContain("trace.turn");
    expect(byRole.screen ?? []).not.toContain("trace.turn");
    expect(byRole.unknown ?? []).not.toContain("trace.turn");
    vi.useRealTimers();
  });
});

describe("orchestrator — console 控制事件解析(fail-closed)", () => {
  it("非法事件一律拒绝", () => {
    expect(parseConsoleEvent("not json")).toBeNull();
    expect(parseConsoleEvent(JSON.stringify({ type: "mystery", at: 1 }))).toBeNull();
    expect(parseConsoleEvent(JSON.stringify({ type: "question.submit", at: 1, text: "  " }))).toBeNull();
    expect(parseConsoleEvent(JSON.stringify({ type: "question.submit", at: 1, text: "x".repeat(501) }))).toBeNull();
    expect(parseConsoleEvent(JSON.stringify({ type: "console.hello", at: 1, role: "hacker" }))).toBeNull();
  });

  it("合法事件放行", () => {
    expect(parseConsoleEvent(JSON.stringify({ type: "session.wake", at: 1 }))).not.toBeNull();
    expect(parseConsoleEvent(JSON.stringify({ type: "question.submit", at: 1, text: "回款情况" }))).not.toBeNull();
  });
});

describe("orchestrator — 2026-09-30 审核修复", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(extra: Partial<Record<string, unknown>> = {}) {
    const { hub, events } = fakeHub();
    const orch = createVoiceOrchestrator({
      hub,
      dataSource: fakeSource(),
      llm: new ScriptedAdapter(),
      mcp: null,
      trace: new TraceSink(null),
      llmTimeoutMs: 8000,
      partialPaceMs: 45,
      partialMaxTotalMs: 1200,
      prefetchTimeoutMs: 5000,
      questionMinGapMs: 0,
      questionWindowMs: 60_000,
      questionWindowMax: 100,
      mcpToolWhitelist: [],
      ...extra,
    } as never);
    return { orch, events };
  }

  it("session.close 立即中止进行中的 LLM 流(审核 M1)", async () => {
    let seen: AbortSignal | undefined;
    const hangingLlm = {
      name: "hanging",
      async classify(_question: string, signal?: AbortSignal) {
        seen = signal;
        await new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(signal?.reason));
        });
        return "sales_progress" as const;
      },
      async *stream() { throw new Error("主路径不得调用 stream"); yield { type: "done", fullText: "", finishReason: "aborted" } as const; },
    };
    const { orch, events } = setup({ llm: hangingLlm });
    const conn = fakeConn();
    orch.handleClientMessage(conn, consoleSend("本月销售情况怎么样?"));
    await vi.advanceTimersByTimeAsync(3000); // 走完唤醒 + 逐字,进入 LLM
    expect(seen).toBeDefined();
    expect(seen?.aborted).toBe(false);

    orch.handleClientMessage(conn, JSON.stringify({ type: "session.close", at: Date.now() }));
    expect(seen?.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(3000);
    // 中止不得额外产生 error 事件(关闭是正常退场)
    expect(events.filter((e) => e.type === "error")).toEqual([]);
  });

  it("限流按全局计:两条连接轮流提问同样被限(审核 M4)", () => {
    const { orch } = setup({ questionMinGapMs: 1500 });
    const sent: unknown[] = [];
    const a: HubConnection = { id: "a", role: "console", send: (p) => sent.push(p), close: () => {} };
    const b: HubConnection = { id: "b", role: "console", send: (p) => sent.push(p), close: () => {} };
    orch.handleClientMessage(a, consoleSend("本月销售情况怎么样?"));
    orch.handleClientMessage(b, consoleSend("本月销售情况怎么样?"));
    expect(sent).toEqual([expect.objectContaining({ type: "error", code: "rate_limited" })]);
  });

  it("未声明角色的连接收不到任何广播(审核 M6)", async () => {
    const received = new Map<string, string[]>();
    const conns: HubConnection[] = [
      { id: "console", role: "console", send: () => {}, close: () => {} },
      { id: "screen", role: "screen", send: () => {}, close: () => {} },
      { id: "lurker", role: "unknown", send: () => {}, close: () => {} },
    ];
    for (const c of conns) received.set(c.id, []);
    const hub = {
      connections: new Set(conns),
      counts: () => ({ screens: 1, consoles: 1 }),
      broadcast: (p: unknown, filter?: (c: HubConnection) => boolean) => {
        for (const c of conns) {
          if (filter && !filter(c)) continue;
          received.get(c.id)?.push((p as { type: string }).type);
        }
      },
    } as unknown as VoiceHubServer;
    const { orch } = setup({ hub });
    orch.handleClientMessage(conns[0], consoleSend("本月销售情况怎么样?"));
    for (let i = 0; i < 40 && orch.state.name !== "ambient"; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(received.get("console")).toContain("answer.delta");
    expect(received.get("screen")).toContain("answer.delta");
    expect(received.get("lurker")).toEqual([]);
  });

  it("重复 console.hello 只在首次声明时广播 hub.hello(审核 L6)", () => {
    const { orch, events } = setup();
    const conn: HubConnection = { id: "c", role: "unknown", send: () => {}, close: () => {} };
    const hello = JSON.stringify({ type: "console.hello", at: Date.now(), role: "console" });
    orch.handleClientMessage(conn, hello);
    orch.handleClientMessage(conn, hello);
    orch.handleClientMessage(conn, hello);
    expect(events.filter((e) => e.type === "hub.hello")).toHaveLength(1);
  });

  const T_CONSOLE = "console-token-0123456789";
  const T_SCREEN = "screen-token-0123456789";
  const auth = (token: string) => JSON.stringify({ type: "hub.auth", at: Date.now(), token });

  it("鉴权模式:console 令牌 → console 角色,可提问(审核 H1)", () => {
    const { orch, events } = setup({ hubAuth: { consoleToken: T_CONSOLE, screenToken: T_SCREEN } });
    const conn: HubConnection = { id: "c", role: "unknown", send: () => {}, close: () => {} };
    orch.handleClientMessage(conn, auth(T_CONSOLE));
    expect(conn.role).toBe("console");
    orch.handleClientMessage(conn, consoleSend("本月销售情况怎么样?"));
    expect(events.some((e) => e.type === "session.start")).toBe(true);
  });

  it("鉴权模式:screen 令牌 → screen 角色", () => {
    const { orch } = setup({ hubAuth: { consoleToken: T_CONSOLE, screenToken: T_SCREEN } });
    const conn: HubConnection = { id: "s", role: "unknown", send: () => {}, close: () => {} };
    orch.handleClientMessage(conn, auth(T_SCREEN));
    expect(conn.role).toBe("screen");
  });

  it("鉴权模式:错误令牌 → 4401 关闭,角色不变", () => {
    const { orch } = setup({ hubAuth: { consoleToken: T_CONSOLE, screenToken: T_SCREEN } });
    const closes: number[] = [];
    const conn: HubConnection = { id: "x", role: "unknown", send: () => {}, close: (c) => closes.push(c ?? 1000) };
    orch.handleClientMessage(conn, auth("wrong-token-0123456789"));
    expect(closes).toEqual([4401]);
    expect(conn.role).toBe("unknown");
  });

  it("鉴权模式:console.hello 自报角色被忽略", () => {
    const { orch } = setup({ hubAuth: { consoleToken: T_CONSOLE, screenToken: T_SCREEN } });
    const conn: HubConnection = { id: "h", role: "unknown", send: () => {}, close: () => {} };
    orch.handleClientMessage(conn, JSON.stringify({ type: "console.hello", at: 1, role: "console" }));
    expect(conn.role).toBe("unknown");
  });

  it("非鉴权模式:hub.auth 被忽略,console.hello 行为不变", () => {
    const { orch } = setup({ hubAuth: null });
    const conn: HubConnection = { id: "n", role: "unknown", send: () => {}, close: () => {} };
    orch.handleClientMessage(conn, auth(T_CONSOLE));
    expect(conn.role).toBe("unknown");
    orch.handleClientMessage(conn, JSON.stringify({ type: "console.hello", at: 1, role: "console" }));
    expect(conn.role).toBe("console");
  });
});


describe("orchestrator — 8c 分类与确定性播报", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(llm = new OpenAiCompatibleAdapter({
    baseUrl: "http://local/v1", apiKey: "local", model: "test-model",
    fetchImpl: vi.fn(async () => Response.json({ choices: [{ message: { content: '{"intent":"sales_progress"}' } }] })),
  }), data = payload, trace = new TraceSink(null)) {
    const { hub, events } = fakeHub();
    const orch = createVoiceOrchestrator({
      hub, dataSource: fakeSource(async () => data), llm, mcp: null, trace,
      llmTimeoutMs: 8000, partialPaceMs: 1, partialMaxTotalMs: 100,
      prefetchTimeoutMs: 5000, questionMinGapMs: 0, questionWindowMs: 60000,
      questionWindowMax: 100, mcpToolWhitelist: [],
    });
    return { orch, events };
  }

  async function ask(text: string, adapter?: OpenAiCompatibleAdapter, data = payload, trace?: TraceSink) {
    const { orch, events } = setup(adapter, data, trace);
    orch.handleClientMessage(fakeConn(), consoleSend(text));
    await vi.advanceTimersByTimeAsync(3000);
    return { orch, events, full: events.find((ev) => ev.type === "answer.delta" && ev.full) as Extract<VoiceWireEvent, { type: "answer.delta" }> };
  }

  for (const demo of DEMO_QUESTIONS) {
    it(`分类主路径：#${demo.id} 同源播报与数字一致`, async () => {
      const expected = classifyScriptedQuestion(demo.question);
      const fetchImpl = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ intent: expected }) } }] }));
      const adapter = new OpenAiCompatibleAdapter({ baseUrl: "http://local/v1", apiKey: "local", model: "m", fetchImpl });
      const stream = vi.spyOn(adapter, "stream");
      const { orch, events, full } = await ask(demo.question, adapter);
      expect(full.card).toEqual(buildIntentAnswer(expected, payload).card);
      expect(events.filter((e) => e.type === "answer.delta").map((e) => (e as { text: string }).text).join("")).toBe(full.card?.spoken);
      expect(stream).not.toHaveBeenCalled();
      expect(orch.answer?.sentences.map((s) => s.text).join("")).toBe(full.card?.spoken);
      expect(orch.answer?.sentences.map((s) => s.spokenText).join("")).not.toMatch(/[0-9¥%]/);
      const record = events.find((ev) => ev.type === "trace.turn") as Extract<VoiceWireEvent, { type: "trace.turn" }>;
      expect(record.trace.degraded).toBe(expected === "unanswerable");
      expect(record.trace.numberGuardViolations).toBeUndefined();
      const [, options] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(options.body).not.toContain("经营数据快照");
    });
  }

  it("模型附带快照外数字3138，严格拒绝额外字段且不播报", async () => {
    const adapter = new OpenAiCompatibleAdapter({ baseUrl: "http://local", apiKey: "local", model: "m", fetchImpl: async () =>
      Response.json({ choices: [{ message: { content: '{"intent":"sales_progress","spoken":"共3138件"}' } }] }) });
    const { events, full } = await ask("本月销售情况怎么样", adapter);
    expect(full.card?.spoken).toBe(VOICE_COVERAGE_FALLBACK);
    expect(JSON.stringify(events)).not.toContain("3138");
  });

  it("业务数值由模板恢复，不使用 reasoning 中的错误数字或触发降级", async () => {
    const adapter = new OpenAiCompatibleAdapter({ baseUrl: "http://local", apiKey: "local", model: "m", fetchImpl: async () =>
      Response.json({ choices: [{ message: { content: '{"intent":"sales_progress"}', reasoning_content: "共3138件" } }] }) });
    const { events, full } = await ask("这个月卖得咋样", adapter);
    expect(full.card?.spoken).toContain("¥1,286.0万");
    expect(JSON.stringify(events)).not.toContain("3138");
    const record = events.find((e) => e.type === "trace.turn") as Extract<VoiceWireEvent, { type: "trace.turn" }>;
    expect(record.trace.degraded).toBe(false);
  });

  it("模型误选总览也不能绕过不支持的筛选边界", async () => {
    const { full } = await ask("广东销售情况怎么样");
    expect(full.card?.spoken).toBe(VOICE_COVERAGE_FALLBACK);
  });

  it("模板数字异常记录trace告警，不静默替换整句", async () => {
    // 故意注入模板 bug，校验备用护栏留下可见告警。
    const builderSpy = vi.spyOn(await import("../../../src/lib/voice/card-builders.ts"), "buildTargetProgressCardFromPublic");
    builderSpy.mockReturnValueOnce({ kind: "target-progress", title: "测试", actualText: "¥1,286.0万", targetText: "¥1,500.0万", remainingText: "¥214.0万", completionRate: 0, spoken: "先生,测试模板错误3138。" });
    const { events, full } = await ask("销售情况");
    expect(full.card?.spoken).toContain("3138");
    const record = events.find((e) => e.type === "trace.turn") as Extract<VoiceWireEvent, { type: "trace.turn" }>;
    expect(record.trace.numberGuardViolations).toContain("3138");
    expect(record.trace.degraded).toBe(false);
    builderSpy.mockRestore();
  });

  it("感谢结束走固定告别话术，直接退场而不是追问", async () => {
    const adapter = new OpenAiCompatibleAdapter({ baseUrl: "http://local", apiKey: "local", model: "m", fetchImpl: async () =>
      Response.json({ choices: [{ message: { content: '{"intent":"chitchat_or_end"}' } }] }) });
    const { events, full } = await ask("好的谢谢没有了", adapter);
    expect(full.card?.spoken).toBe("为您服务是我的荣幸,先生。");
    expect(events.some((ev) => ev.type === "session.end" && ev.reason === "decline")).toBe(true);
    expect(events.some((ev) => ev.type === "state.change" && ev.to === "followup")).toBe(false);
  });
});
