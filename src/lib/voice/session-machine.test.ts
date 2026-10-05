import { describe, expect, it } from "vitest";
import {
  followupRemaining,
  initSessionState,
  isSessionActive,
  sessionReducer,
  thinkingExpired,
  VOICE_TIMING,
  type VoiceEvent,
  type VoiceSessionState,
} from "./session-machine";

/** 以固定时钟走一步。Omit 对联合类型不分布,会丢掉各成员的专有字段。 */
type EventWithoutAt<T> = T extends unknown ? Omit<T, "at"> : never;
function step(state: VoiceSessionState, event: EventWithoutAt<VoiceEvent>, at: number): VoiceSessionState {
  return sessionReducer(state, { ...event, at } as VoiceEvent);
}

/** 目标进度卡样例(字段形状即 AnswerCardData 契约)。 */
function card() {
  return {
    kind: "target-progress" as const,
    title: "t",
    actualText: "a",
    targetText: "b",
    remainingText: "c",
    completionRate: 50,
    spoken: "s",
  };
}

describe("voice session machine — 全生命周期(plan §4)", () => {
  it("ambient → waking → listening → thinking → answering → followup → closing → ambient", () => {
    let s = initSessionState(0);
    expect(s.name).toBe("ambient");
    expect(isSessionActive(s)).toBe(false);

    s = step(s, { type: "WAKE" }, 1000);
    expect(s).toMatchObject({ name: "waking", since: 1000, cycles: 0, turns: 0 });
    expect(isSessionActive(s)).toBe(true);

    s = step(s, { type: "WOKEN" }, 1000 + VOICE_TIMING.wakingMs);
    expect(s.name).toBe("listening");

    s = step(s, { type: "PARTIAL", text: "本月" }, 2500);
    expect(s.partial).toBe("本月");
    expect(s.since).toBe(1000 + VOICE_TIMING.wakingMs); // 自环不刷新呼吸相位

    s = step(s, { type: "SUBMIT", question: "本月销售情况怎么样?" }, 3000);
    expect(s).toMatchObject({ name: "thinking", question: "本月销售情况怎么样?", partial: null });

    const c = card();
    s = step(s, { type: "ANSWER", card: c }, 4200);
    expect(s).toMatchObject({ name: "answering", turns: 1, card: c, spoken: "s" });

    s = step(s, { type: "SPOKEN" }, 9000);
    expect(s.name).toBe("followup");

    s = step(s, { type: "FOLLOWUP_TIMEOUT" }, 9000 + VOICE_TIMING.followupMs);
    expect(s.name).toBe("closing");

    s = step(s, { type: "CLOSED" }, 9800 + VOICE_TIMING.closingMs);
    expect(s).toMatchObject({ name: "ambient", cycles: 1, card: null, spoken: null, turns: 0 });
  });

  it("多问连续:followup 再开口不重播 waking,卡片原地回收,第二轮 turns=2", () => {
    let s = initSessionState(0);
    for (const e of [
      { type: "WAKE" as const },
      { type: "WOKEN" as const },
      { type: "SUBMIT" as const, question: "q1" },
    ]) {
      s = step(s, e, 100);
    }
    s = step(s, { type: "ANSWER", card: card() }, 200);
    s = step(s, { type: "SPOKEN" }, 300);
    s = step(s, { type: "SPEAK" }, 400);
    expect(s).toMatchObject({ name: "listening", card: null, spoken: null, turns: 1 });

    s = step(s, { type: "SUBMIT", question: "q2" }, 500);
    s = step(s, { type: "ANSWER", card: card() }, 600);
    expect(s).toMatchObject({ name: "answering", turns: 2 });
  });

  it("「没有了/谢谢」→ DECLINE 直接触发 closing(播告别语后不进 listening)", () => {
    let s = initSessionState(0);
    s = step(s, { type: "WAKE" }, 0);
    s = step(s, { type: "WOKEN" }, 900);
    s = step(s, { type: "SUBMIT", question: "q" }, 1000);
    s = step(s, { type: "ANSWER", card: card(), }, 2000);
    s = step(s, { type: "SPOKEN" }, 3000);
    s = step(s, { type: "DECLINE" }, 3500);
    expect(s.name).toBe("closing");
  });
});

describe("voice session machine — 超时规则", () => {
  it("followup 3s 能量环倒计时:走完前不为负,3s 整归零,随后派发 FOLLOWUP_TIMEOUT", () => {
    let s = initSessionState(0);
    s = step(s, { type: "WAKE" }, 0);
    s = step(s, { type: "WOKEN" }, 900);
    s = step(s, { type: "SUBMIT", question: "q" }, 1000);
    s = step(s, { type: "ANSWER", card: card() }, 2000);
    s = step(s, { type: "SPOKEN" }, 3000);
    expect(s.name).toBe("followup");
    expect(s.since).toBe(3000);

    expect(followupRemaining(s, 3000)).toBe(VOICE_TIMING.followupMs);
    expect(followupRemaining(s, 5999)).toBe(1);
    expect(followupRemaining(s, 6000)).toBe(0);
    expect(followupRemaining(s, 9999)).toBe(0); // 不为负
    expect(followupRemaining({ ...s, name: "answering" }, 6000)).toBeNull();

    s = step(s, { type: "FOLLOWUP_TIMEOUT" }, 6000);
    expect(s.name).toBe("closing");
  });

  it("thinking 超 8s → THINK_TIMEOUT → error-fallback(降级话术路径)", () => {
    let s = initSessionState(0);
    s = step(s, { type: "WAKE" }, 0);
    s = step(s, { type: "WOKEN" }, 900);
    s = step(s, { type: "SUBMIT", question: "q" }, 1000);

    expect(thinkingExpired(s, 1000 + VOICE_TIMING.thinkingMaxMs - 1)).toBe(false);
    expect(thinkingExpired(s, 1000 + VOICE_TIMING.thinkingMaxMs)).toBe(true);

    s = step(s, { type: "THINK_TIMEOUT" }, 1000 + VOICE_TIMING.thinkingMaxMs);
    expect(s).toMatchObject({ name: "error-fallback", error: "thinking-timeout", card: null });

    s = step(s, { type: "ERROR_SPOKEN" }, 14000);
    expect(s.name).toBe("closing");
  });

  it("thinking 中再开口(⇄)回到 listening,不触发超时", () => {
    let s = initSessionState(0);
    s = step(s, { type: "WAKE" }, 0);
    s = step(s, { type: "WOKEN" }, 900);
    s = step(s, { type: "SUBMIT", question: "q" }, 1000);
    s = step(s, { type: "THINKING_VOICE" }, 2000);
    expect(s.name).toBe("listening");
    expect(thinkingExpired(s, 99999)).toBe(false);
  });
});

describe("voice session machine — 打断与错误路径", () => {
  it("answering 允许 barge-in:回 listening,旧卡折叠回收(8c 实装,状态机先行)", () => {
    let s = initSessionState(0);
    s = step(s, { type: "WAKE" }, 0);
    s = step(s, { type: "WOKEN" }, 900);
    s = step(s, { type: "SUBMIT", question: "q" }, 1000);
    s = step(s, { type: "ANSWER", card: card() }, 2000);
    s = step(s, { type: "BARGE_IN" }, 2500);
    expect(s).toMatchObject({ name: "listening", card: null, spoken: null });
  });

  it("任意会话态 ERROR → error-fallback → closing;ambient/closing 不响应 ERROR", () => {
    let s = initSessionState(0);
    // ambient 出错不接管屏幕
    expect(step(s, { type: "ERROR", message: "ws" }, 100).name).toBe("ambient");

    s = step(s, { type: "WAKE" }, 0);
    s = step(s, { type: "WOKEN" }, 900);
    s = step(s, { type: "SUBMIT", question: "q" }, 1000);
    s = step(s, { type: "ANSWER", card: card() }, 2000);
    s = step(s, { type: "ERROR", message: "tts-lost" }, 2500);
    expect(s).toMatchObject({ name: "error-fallback", error: "tts-lost", card: null });

    s = step(s, { type: "ERROR_SPOKEN" }, 5500);
    expect(s.name).toBe("closing");
    // 退场不可被打断:基线永远能回来
    expect(step(s, { type: "ERROR", message: "x" }, 5600).name).toBe("closing");
  });

  it("error-fallback 自环幂等(重复 ERROR 不刷新 since)", () => {
    let s = initSessionState(0);
    s = step(s, { type: "WAKE" }, 0);
    s = step(s, { type: "WOKEN" }, 900);
    s = step(s, { type: "ERROR", message: "a" }, 1000);
    const again = step(s, { type: "ERROR", message: "b" }, 1100);
    expect(again).toEqual(s);
  });
});

describe("voice session machine — 非法转移与运维事件", () => {
  it("非法事件一律原样返回(全函数 reducer)", () => {
    const s = initSessionState(5);
    expect(step(s, { type: "WOKEN" }, 10)).toEqual(s);
    expect(step(s, { type: "SUBMIT", question: "q" }, 10)).toEqual(s);
    expect(step(s, { type: "ANSWER", card: card() }, 10)).toEqual(s);
    expect(step(s, { type: "SPOKEN" }, 10)).toEqual(s);
    expect(step(s, { type: "FOLLOWUP_TIMEOUT" }, 10)).toEqual(s);
    expect(step(s, { type: "CLOSED" }, 10)).toEqual(s);
    // 重复唤醒不重置已有会话
    const w = step(s, { type: "WAKE" }, 10);
    expect(step(w, { type: "WAKE" }, 20)).toEqual(w);
  });

  it("FORCE_CLOSE:任何会话态立即进 closing,卡片回收;ambient/closing 不动", () => {
    let s = initSessionState(0);
    expect(step(s, { type: "FORCE_CLOSE" }, 10)).toEqual(s);

    s = step(s, { type: "WAKE" }, 0);
    s = step(s, { type: "WOKEN" }, 900);
    s = step(s, { type: "SUBMIT", question: "q" }, 1000);
    s = step(s, { type: "ANSWER", card: card() }, 2000);
    const closed = step(s, { type: "FORCE_CLOSE" }, 2100);
    expect(closed).toMatchObject({ name: "closing", card: null, spoken: null });

    const back = step(closed, { type: "CLOSED" }, 2100 + VOICE_TIMING.closingMs);
    expect(back.name).toBe("ambient");
  });
});
