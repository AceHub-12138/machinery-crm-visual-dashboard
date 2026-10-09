import { describe, expect, it } from "vitest";
import {
  isValidAnswerCard,
  parseWireEvent,
  WIRE_EVENT_TYPES,
  type TurnTracePayload,
  type VoiceWireEvent,
} from "./protocol";
import type { AnswerCardData } from "./session-machine";

describe("protocol — fail-closed 解析(plan §10 风格)", () => {
  it("非字符串 / 非法 JSON / 未知类型 / 缺 at 一律 null", () => {
    expect(parseWireEvent(null)).toBeNull();
    expect(parseWireEvent(42)).toBeNull();
    expect(parseWireEvent("{not json")).toBeNull();
    expect(parseWireEvent(JSON.stringify({ type: "mystery", at: 1 }))).toBeNull();
    expect(parseWireEvent(JSON.stringify({ type: "error" }))).toBeNull(); // 缺 at
    expect(parseWireEvent(JSON.stringify({ type: "session.start", at: "x", sessionId: "s" }))).toBeNull();
  });

  it("成员字段形状不符返回 null(answer.delta full 缺卡等)", () => {
    expect(parseWireEvent(JSON.stringify({ type: "answer.delta", at: 1, seq: 0, text: "", full: true }))).toBeNull();
    expect(
      parseWireEvent(JSON.stringify({ type: "session.start", at: 1, sessionId: "" })),
    ).toBeNull();
    expect(parseWireEvent(JSON.stringify({ type: "asr.partial", at: 1, text: "你好" }))).toBeNull(); // 缺 final
  });

  it("answer.delta 卡片 schema 校验:原型链键与脏字段拒绝(安全审核)", () => {
    const base = { at: 1, seq: 0, text: "", full: true };
    expect(parseWireEvent(JSON.stringify({ ...base, type: "answer.delta", card: { kind: "constructor" } }))).toBeNull();
    expect(parseWireEvent(JSON.stringify({ ...base, type: "answer.delta", card: { kind: "brief", title: 1, spoken: "", lines: [] } }))).toBeNull();
    expect(
      parseWireEvent(
        JSON.stringify({
          ...base,
          type: "answer.delta",
          card: { kind: "target-progress", title: "t", spoken: "s", actualText: 1, targetText: "b", remainingText: "c", completionRate: 50 },
        }),
      ),
    ).toBeNull();
    expect(
      parseWireEvent(
        JSON.stringify({
          ...base,
          type: "answer.delta",
          card: { kind: "brief", title: "小川", spoken: "s", lines: ["一"] },
        }),
      ),
    ).not.toBeNull();
  });

  it("合法事件原样透传", () => {
    const raw = JSON.stringify({ type: "session.end", at: 5, reason: "force" });
    expect(parseWireEvent(raw)).toEqual({ type: "session.end", at: 5, reason: "force" });
  });

  it("类型清单与联合完全同步(satisfies 锁定)", () => {
    expect(WIRE_EVENT_TYPES).toHaveLength(15);
  });
});

/**
 * §9 事件序列快照:一轮完整问答(目标进度卡)应有的 wire 事件金样序列。
 * 编排服务集成测试用同一序列做集成断言;此处锁定协议形状本身。
 */
describe("protocol — 事件序列快照(单轮:提问→作答→退场)", () => {
  it("golden sequence:session.start → … → session.end", () => {
    const card: AnswerCardData = {
      kind: "target-progress",
      title: "2026年9月 · 合同额目标进度",
      actualText: "¥1,286.0万",
      targetText: "¥1,500.0万",
      remainingText: "¥214.0万",
      completionRate: 85.7,
      spoken:
        "先生,2026年9月合同额 ¥1,286.0万,完成月度目标的 85.7%,距离目标还差 ¥214.0万。",
    };
    const trace: TurnTracePayload = {
      question: "本月销售情况怎么样?",
      turn: 0,
      stages: { question: 0, prefetch: 12, llmFirstToken: 38, toolExec: null, answerFull: 74 },
      source: "payload",
      card: "target-progress",
      degraded: false,
      totalMs: 74,
    };

    const sequence: VoiceWireEvent[] = [
      { type: "session.start", at: 1000, sessionId: "sess-1" },
      { type: "state.change", at: 1000, from: "ambient", to: "waking", turn: 0 },
      { type: "state.change", at: 1900, from: "waking", to: "listening", turn: 0 },
      { type: "asr.partial", at: 2000, text: "本月销售", final: false },
      { type: "asr.partial", at: 2080, text: "本月销售情况怎么样?", final: true },
      { type: "state.change", at: 2100, from: "listening", to: "thinking", turn: 0, question: "本月销售情况怎么样?" },
      { type: "tool.invoke", at: 2130, card: "target-progress", source: "payload", latencyMs: 12 },
      { type: "answer.delta", at: 2140, seq: 0, text: "先生,2026年9月合同额 ¥1,286.0万", full: false },
      {
        type: "answer.delta",
        at: 2160,
        seq: 1,
        text: ",完成月度目标的 85.7%,距离目标还差 ¥214.0万。",
        full: true,
        card,
      },
      { type: "state.change", at: 2161, from: "thinking", to: "answering", turn: 1 },
      { type: "tts.boundary", at: 2161, sentenceIndex: 0, charIndex: 0 },
      { type: "state.change", at: 8000, from: "answering", to: "followup", turn: 1 },
      { type: "state.change", at: 11000, from: "followup", to: "closing", turn: 1 },
      { type: "session.end", at: 11000, reason: "followup_timeout" },
      { type: "trace.turn", at: 2160, turn: 1, trace },
    ];

    // 快照:整条序列逐字入金样(±1 处需人工评审)
    expect(sequence).toMatchSnapshot();
    // 每条都能被 fail-closed 解析放行
    for (const ev of sequence) {
      expect(parseWireEvent(JSON.stringify(ev))).toEqual(ev);
    }
  });
});

const baseTargetProgress = {
  kind: "target-progress", title: "目标进度", spoken: "本月完成 62%",
  actualText: "620 万", targetText: "1000 万", remainingText: "380 万", completionRate: 62,
};
const baseRing = {
  kind: "completion-ring", title: "回款", spoken: "回款 48%",
  ratePercent: 48, collectedText: "480 万", targetText: "1000 万", remainingText: "520 万",
};
const baseRegion = {
  kind: "region", title: "区域", spoken: "华东最多", summaryText: "华东领先",
  rows: [{ region: "华东", shipments: 12, units: 30, sharePercent: 40 }],
};
const baseBrief = { kind: "brief", title: "小川", spoken: "好的", lines: ["好的"] };

describe("isValidAnswerCard — 数值与长度上限(审核 L5)", () => {
  it("基础卡片本身合法(防止样例写错导致假通过)", () => {
    for (const c of [baseTargetProgress, baseRing, baseRegion, baseBrief]) expect(isValidAnswerCard(c)).toBe(true);
  });
  it("负数及超大数值被拒，合法超额比例保留", () => {
    expect(isValidAnswerCard({ ...baseTargetProgress, completionRate: -1 })).toBe(false);
    expect(isValidAnswerCard({ ...baseTargetProgress, completionRate: 1e308 })).toBe(false);
    expect(isValidAnswerCard({ ...baseRing, ratePercent: 1001 })).toBe(true);
  });
  it("行数与字符串长度超限被拒", () => {
    const row = baseRegion.rows[0];
    expect(isValidAnswerCard({ ...baseRegion, rows: Array.from({ length: 21 }, () => row) })).toBe(false);
    expect(isValidAnswerCard({ ...baseRegion, title: "长".repeat(301) })).toBe(false);
    expect(isValidAnswerCard({ ...baseBrief, lines: Array.from({ length: 21 }, () => "x") })).toBe(false);
  });
  it("正常卡片仍然通过(含超额完成 >100%)", () => {
    expect(isValidAnswerCard(baseTargetProgress)).toBe(true);
    expect(isValidAnswerCard({ ...baseTargetProgress, completionRate: 135.2 })).toBe(true);
  });
});

describe('8c speech descriptor', () => {
  it('accepts optional sentence offsets and rejects malformed or non-full descriptors', () => {
    const speech = {turnId:'12345678-1234-1234-1234-123456789abc',sentences:[{index:0,displayStart:0,displayEnd:2}]};
    const full={type:'answer.delta',at:1,seq:0,text:'好的',full:true,card:baseBrief,speech};
    expect(parseWireEvent(JSON.stringify(full))).toEqual(full);
    expect(parseWireEvent(JSON.stringify({...full,card:{kind:"brief"}}))).toBeNull();
    expect(parseWireEvent(JSON.stringify({...full,speech:{...speech,fixed:'goodbye'}}))).not.toBeNull();
    expect(parseWireEvent(JSON.stringify({...full,speech:{...speech,fixed:'unknown'}}))).toBeNull();
    for(const changed of [null,{...speech,sentences:[]},{...speech,sentences:[{index:0,displayStart:0,displayEnd:3}]},{...speech,turnId:'bad'},{...speech,sentences:[{index:0,displayStart:-1,displayEnd:2}]},{...speech,sentences:[{index:1,displayStart:0,displayEnd:2}]},{...speech,sentences:[{index:0,displayStart:0,displayEnd:2},{index:1,displayStart:1,displayEnd:3}]}]) {
      expect(parseWireEvent(JSON.stringify({...full,speech:changed}))).toBeNull();
    }
    expect(parseWireEvent(JSON.stringify({...full,full:false}))).toBeNull();
  });
});

// Legacy sequence above stays compatible; 8c uses local sentence boundaries.
describe("8c PCM playback protocol snapshot", () => {
  it("full speech descriptor and screen reports have stable additive shapes", () => {
    const event: VoiceWireEvent = { type: "answer.delta", at: 1234, seq: 2, text: "好的", full: true,
      card: {kind:"brief",title:"小川",spoken:"好的",lines:["好的"]},
      speech: {turnId:"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",fixed:"goodbye",sentences:[{index:0,displayStart:0,displayEnd:2}]},
    };
    expect(parseWireEvent(JSON.stringify(event))).toEqual(event);
    expect([event, {type:"playback.started",at:1500,turnId:event.speech!.turnId}, {type:"playback.drained",at:2500,turnId:event.speech!.turnId}]).toMatchSnapshot();
  });
});

it('cached wake metadata is valid without being an answer card, rejects missing boundaries',()=>{
  const event={type:'speech.fixed',at:1,text:'我在,先生。请讲。',speech:{turnId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',fixed:'wake',style:'cheerful',sentences:[{index:0,displayStart:0,displayEnd:9}]}};
  expect(parseWireEvent(JSON.stringify(event))).toMatchObject(event);
  expect(parseWireEvent(JSON.stringify({...event,speech:{...event.speech,sentences:[]}}))).toBeNull();
});

it("listen and barge diagnostics reject invalid budgets, modes, attempts and contradictory decisions", () => {
  const base={at:1,sessionId:'sess-aaaaaaaa',listenId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
  const read=(event:unknown)=>parseWireEvent(JSON.stringify(event));
  expect(read({...base,type:'input.listen',mode:'barge'})).toBeNull();
  expect(read({...base,type:'input.listen',mode:'barge',turnId:base.listenId})).not.toBeNull();
  expect(read({...base,type:'input.listen',mode:'off'})).not.toBeNull();
  for(const remainingMs of [-1,5001,Infinity])expect(read({...base,type:'input.open',remainingMs,timeoutMs:5000,paused:false})).toBeNull();
  expect(read({...base,type:'input.progress',remainingMs:1234,timeoutMs:8000,paused:true})).not.toBeNull();
  expect(read({...base,type:'barge.result',attemptId:base.listenId,accepted:true,reason:'echo'})).toBeNull();
  expect(read({...base,type:'barge.result',attemptId:base.listenId,accepted:false,reason:'echo'})).not.toBeNull();
});

it('accepts configured ordinary listen budgets, rejects absent or invalid countdown budgets',()=>{
  const base={at:1,sessionId:'sess-aaaaaaaa',listenId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
  for(const timeoutMs of [1,2000,5000,8000,60000]){
    expect(parseWireEvent(JSON.stringify({...base,type:'input.listen',mode:'listening',timeoutMs}))).not.toBeNull();
    expect(parseWireEvent(JSON.stringify({...base,type:'input.open',timeoutMs,remainingMs:timeoutMs,paused:false}))).not.toBeNull();
  }
  for(const timeoutMs of [0,-1,60001,Infinity])expect(parseWireEvent(JSON.stringify({...base,type:'input.open',timeoutMs,remainingMs:0,paused:false}))).toBeNull();
});
