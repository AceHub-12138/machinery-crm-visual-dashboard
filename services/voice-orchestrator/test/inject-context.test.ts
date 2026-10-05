import { describe, expect, it } from "vitest";
import {
  buildInjectedContext,
  extractNumbers,
  INJECTION_CONSTRAINT,
  sanitizeAnswer,
  verifyAnswerNumbers,
} from "../src/datasource/inject-context.ts";
import fixture from "../fixtures/public-sales-screen.json";
import { validatePublicPayload, type PublicSalesScreenPayload } from "../../../src/lib/voice/public-payload.ts";
import {
  buildTargetProgressCardFromPublic,
  VOICE_COVERAGE_FALLBACK,
} from "../../../src/lib/voice/card-builders.ts";

const payload = validatePublicPayload(fixture) as PublicSalesScreenPayload;

describe("inject-context — 预取注入快照(方案灵魂,B②)", () => {
  it("快照覆盖 kpis/collection/delivery 全口径,金额与卡片同格式", () => {
    const snapshot = buildInjectedContext(payload);
    expect(snapshot).toContain("【经营数据快照】");
    expect(snapshot).toContain("2026年9月");
    expect(snapshot).toContain("客户总数 286 家");
    expect(snapshot).toContain("完成率 85.7%");
    expect(snapshot).toContain("¥1,286.0万"); // 与卡片同源格式化
    expect(snapshot).toContain("¥214.0万");
    expect(snapshot).toContain("累计回款率 57.4%");
    expect(snapshot).toContain("[区域分布]");
    expect(snapshot).toContain("[近期发运]");
    expect(snapshot).toContain("[发运提醒]");
  });

  it("卡片 spoken 中的每个数字都能在快照中找到(构造即护栏)", () => {
    const snapshot = buildInjectedContext(payload);
    const card = buildTargetProgressCardFromPublic(payload.collection, payload.period.label);
    expect(verifyAnswerNumbers(card.spoken, snapshot).ok).toBe(true);
  });
});

describe("inject-context — 防幻觉数字护栏(F 红线)", () => {
  it("快照里没有的数字必须被抓出", () => {
    const snapshot = buildInjectedContext(payload);
    const verdict = verifyAnswerNumbers("先生,华南退货率 3.2%。", snapshot);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations).toContain("3.2");
  });

  it("千分位逗号不敏感(¥1,286.0万 引用合法)", () => {
    const snapshot = buildInjectedContext(payload);
    expect(verifyAnswerNumbers("合同额 ¥1,286.0万。", snapshot).ok).toBe(true);
  });

  it("违规答案整体替换为降级话术,绝不部分保留", () => {
    const snapshot = buildInjectedContext(payload);
    const result = sanitizeAnswer("本月合同额 ¥1,286.0万,利润率 42.5%。", snapshot);
    expect(result.degraded).toBe(true);
    expect(result.text).toBe(VOICE_COVERAGE_FALLBACK);
  });

  it("合法答案原样放行", () => {
    const snapshot = buildInjectedContext(payload);
    const result = sanitizeAnswer("先生,本月合同额 ¥1,286.0万,完成目标的 85.7%。", snapshot);
    expect(result.degraded).toBe(false);
    expect(result.text).toContain("85.7%");
  });

  it("硬约束原文在场(§10.2 口径)", () => {
    expect(INJECTION_CONSTRAINT).toContain("无法调取这项数据");
    expect(INJECTION_CONSTRAINT).toContain("禁止心算");
  });

  it("extractNumbers 边界", () => {
    expect(extractNumbers("第 3 名,共 12 项(85.7%)")).toEqual(["3", "12", "85.7"]);
    expect(extractNumbers("没有数字")).toEqual([]);
  });
});
