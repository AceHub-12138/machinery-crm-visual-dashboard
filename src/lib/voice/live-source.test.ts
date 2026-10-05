import { describe, expect, it } from "vitest";
import {
  connectionLostEvents,
  initLiveSourceContext,
  resolveHubUrl,
  sanitizeHubParam,
  takeHubTokenFromHash,
  wireToMachineEvents,
} from "./live-source";
import {
  initSessionState,
  sessionReducer,
  VOICE_TIMING,
  type VoiceEvent,
  type VoiceSessionState,
} from "./session-machine";
import type { VoiceWireEvent } from "./protocol";

/** 与 OverlayStage.dispatchWire 同构:映射 → 同步镜像 → 事件(ANSWER/WAKE 由组件特判)。 */
function replay(wireEvents: VoiceWireEvent[]) {
  const ctx = initLiveSourceContext();
  let mirror: VoiceSessionState = initSessionState(0);
  const dispatched: VoiceEvent[] = [];
  let answerCards = 0;

  for (const ev of wireEvents) {
    const result = wireToMachineEvents(mirror.name, ev, ctx);
    ctx.lastFullCard = result.ctx.lastFullCard;
    ctx.lastErrorMessage = result.ctx.lastErrorMessage;
    for (const machineEvent of result.events) {
      if (machineEvent.type === "ANSWER") {
        answerCards += 1;
        dispatched.push({ ...machineEvent, at: 1 } as VoiceEvent);
        mirror = sessionReducer(mirror, { ...machineEvent, at: 1 } as VoiceEvent);
      } else {
        dispatched.push({ ...machineEvent, at: 1 } as VoiceEvent);
        mirror = sessionReducer(mirror, { ...machineEvent, at: 1 } as VoiceEvent);
      }
    }
  }
  return { dispatched, finalName: mirror.name, answerCards };
}

/** hub 实测序列(2026-09-28 抓包;数字取自 fixture 口径)。 */
function capturedTurn(): VoiceWireEvent[] {
  const card = {
    kind: "region" as const,
    title: "2026年9月 · 区域发运分布",
    summaryText: "覆盖 12 个省市 · 12 车次 / 18 台",
    rows: [
      { region: "广东省", shipments: 1, units: 3, sharePercent: 16.7 },
      { region: "上海市", shipments: 1, units: 2, sharePercent: 11.1 },
    ],
    spoken: "先生,本期发运覆盖 12 个省市、共 18 台,台数最多的是广东省 3 台、上海市 2 台。",
  };
  const question = "各区域发货分布怎么样?";
  const partials = Array.from({ length: question.length }, (_, i) => ({
    type: "asr.partial" as const,
    at: 1000 + i * 45,
    text: question.slice(0, i + 1),
    final: i === question.length - 1,
  }));
  return [
    { type: "session.start", at: 900, sessionId: "sess-x" },
    { type: "state.change", at: 900, from: "ambient", to: "waking", turn: 0 },
    { type: "state.change", at: 1800, from: "waking", to: "listening", turn: 0 },
    ...partials,
    { type: "state.change", at: 2400, from: "listening", to: "thinking", turn: 0, question },
    { type: "tool.invoke", at: 2480, card: "region", source: "payload", latencyMs: 70 },
    { type: "answer.delta", at: 2500, seq: 0, text: "先生,本期发运覆盖 12 个省市、共 18 台", full: false },
    { type: "answer.delta", at: 2530, seq: 1, text: ",台数最多的是广东省 3 台", full: false },
    { type: "answer.delta", at: 2560, seq: 2, text: "、上海市 2 台。", full: true, card },
    { type: "state.change", at: 2560, from: "thinking", to: "answering", turn: 1 },
  ];
}

describe("live-source — wire→状态机 映射(hub 实测序列回放)", () => {
  it("完整一轮:答案卡恰好发射一次,终态 answering", () => {
    const { dispatched, finalName, answerCards } = replay(capturedTurn());
    expect(answerCards).toBe(1);
    expect(finalName).toBe("answering");
    expect(dispatched.map((e) => e.type)).toEqual([
      "WAKE",
      "WOKEN", // hub 的 waking→listening(本地已 listening,reducer 忽略重复)
      ...Array(11).fill("PARTIAL"),
      "SUBMIT",
      "ANSWER",
    ]);
  });

  it("answer.delta full 与 state.change(answering) 同 tick 连发也只发射一次", () => {
    // 复发回归:两事件在同一渲染帧内到达时,prev 不得依赖 React 提交
    const events = capturedTurn().slice(-2); // [delta full, state.change answering]
    // 直接从 thinking 镜像开始
    const ctx = initLiveSourceContext();
    let mirror: VoiceSessionState = initSessionState(0);
    mirror = sessionReducer(mirror, { type: "WAKE", at: 0 });
    mirror = sessionReducer(mirror, { type: "WOKEN", at: 900 });
    mirror = sessionReducer(mirror, { type: "SUBMIT", at: 1800, question: "q" });

    let answers = 0;
    for (const ev of events) {
      const result = wireToMachineEvents(mirror.name, ev, ctx);
      ctx.lastFullCard = result.ctx.lastFullCard;
      ctx.lastErrorMessage = result.ctx.lastErrorMessage;
      for (const machineEvent of result.events) {
        if (machineEvent.type === "ANSWER") answers += 1;
        mirror = sessionReducer(mirror, { ...machineEvent, at: 2 } as VoiceEvent);
      }
    }
    expect(answers).toBe(1);
    expect(mirror.name).toBe("answering");
  });

  it("错误路径:error 文案缓冲 → error-fallback → closing 强收", () => {
    const events: VoiceWireEvent[] = [
      { type: "session.start", at: 0, sessionId: "s" },
      { type: "state.change", at: 0, from: "ambient", to: "waking", turn: 0 },
      { type: "state.change", at: VOICE_TIMING.wakingMs, from: "waking", to: "listening", turn: 0 },
      { type: "state.change", at: 2000, from: "listening", to: "thinking", turn: 0, question: "q" },
      { type: "error", at: 3000, code: "llm_timeout", message: "降级" },
      { type: "state.change", at: 3001, from: "thinking", to: "error-fallback", turn: 0 },
      { type: "state.change", at: 6300, from: "error-fallback", to: "closing", turn: 0 },
      { type: "session.end", at: 6301, reason: "error" },
    ];
    const { dispatched, finalName } = replay(events);
    expect(dispatched.map((e) => e.type)).toEqual([
      "WAKE",
      "WOKEN",
      "SUBMIT",
      "ERROR", // 文案来自 error 事件缓冲
      "FORCE_CLOSE", // closing 兜底
      // session.end 到达时已在 closing → 映射惰性(reducer 亦会忽略),只收一次
    ]);
    expect(finalName).toBe("closing");
    const error = dispatched.find((e) => e.type === "ERROR") as Extract<VoiceEvent, { type: "ERROR" }>;
    expect(error.message).toBe("降级");
  });

  it("断链:活跃会话 FORCE_CLOSE,ambient 无感", () => {
    expect(connectionLostEvents("answering")).toEqual([{ type: "FORCE_CLOSE" }]);
    expect(connectionLostEvents("ambient")).toEqual([]);
    expect(connectionLostEvents("closing")).toEqual([]);
  });

  it("追问期新问题:直接 SPEAK 回 listening", () => {
    const events: VoiceWireEvent[] = [
      { type: "session.start", at: 0, sessionId: "s" },
      { type: "state.change", at: 0, from: "ambient", to: "waking", turn: 0 },
      { type: "state.change", at: 900, from: "waking", to: "listening", turn: 0 },
      { type: "state.change", at: 1500, from: "listening", to: "thinking", turn: 0, question: "q" },
      {
        type: "answer.delta",
        at: 1800,
        seq: 0,
        text: "答",
        full: true,
        card: {
          kind: "brief",
          title: "小川",
          lines: ["答。"],
          spoken: "答。",
        },
      },
      { type: "state.change", at: 1801, from: "thinking", to: "answering", turn: 1 },
      { type: "state.change", at: 9000, from: "answering", to: "followup", turn: 1 },
      { type: "state.change", at: 9500, from: "followup", to: "listening", turn: 1 },
    ];
    const { dispatched } = replay(events);
    expect(dispatched.filter((e) => e.type === "SPEAK")).toHaveLength(1);
    expect(dispatched.filter((e) => e.type === "ANSWER")).toHaveLength(1);
  });

  it("resolveHubUrl:?hub= 仅接受本机地址(安全审核:?hub= 不可指向任意服务器)", () => {
    expect(resolveHubUrl("ws://localhost:9999", "localhost:3015")).toBe("ws://localhost:9999");
    expect(resolveHubUrl("ws://127.0.0.1", "localhost:3015")).toBe("ws://127.0.0.1");
    // 非本机地址一律拒绝,回落默认
    expect(resolveHubUrl("ws://example.com:9999", "localhost:3015")).toBe("ws://localhost:3210");
    expect(resolveHubUrl("ws://192.168.1.5:3210", "localhost:3015")).toBe("ws://localhost:3210");
    expect(resolveHubUrl(null, "localhost:3015")).toBe("ws://localhost:3210");
    expect(resolveHubUrl(undefined, "192.168.1.5:3015")).toBe("ws://192.168.1.5:3210");
  });

  it("sanitizeHubParam:白名单外返回 null", () => {
    expect(sanitizeHubParam("ws://evil.example:3210")).toBeNull();
    expect(sanitizeHubParam("http://localhost:3210")).toBeNull();
    expect(sanitizeHubParam("ws://localhost.evil.com:3210")).toBeNull();
    expect(sanitizeHubParam("ws://127.0.0.1:3210/")).toBe("ws://127.0.0.1:3210/");
  });

  it("sanitizeHubParam:额外主机白名单 + [::1](审核 H2)", () => {
    expect(sanitizeHubParam("ws://192.168.1.5:3210", ["192.168.1.5"])).toBe("ws://192.168.1.5:3210");
    expect(sanitizeHubParam("ws://192.168.1.6:3210", ["192.168.1.5"])).toBeNull();
    expect(sanitizeHubParam("ws://[::1]:3210")).toBe("ws://[::1]:3210");
    expect(sanitizeHubParam("http://localhost:3210")).toBeNull();
    expect(sanitizeHubParam("ws://localhost.evil.com:3210")).toBeNull();
  });

  it("takeHubTokenFromHash", () => {
    expect(takeHubTokenFromHash("#hubToken=abc")).toBe("abc");
    expect(takeHubTokenFromHash("#x=1&hubToken=abc")).toBe("abc");
    expect(takeHubTokenFromHash("")).toBeNull();
    expect(takeHubTokenFromHash("#hubToken=")).toBeNull();
    expect(takeHubTokenFromHash(`#hubToken=${"a".repeat(300)}`)).toBeNull();
  });
});
