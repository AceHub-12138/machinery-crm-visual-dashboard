import { describe, expect, it } from "vitest";
import { classifyScriptedQuestion, parseIntent, VOICE_INTENTS } from "./intents";
import { INTENT_CASES } from "./intent-cases";

describe("意图覆盖与严格解析", () => {
  it.each(VOICE_INTENTS)("合法枚举 %s", (intent) => {
    expect(parseIntent(JSON.stringify({ intent }))).toBe(intent);
  });
  it.each(["bad", "null", '[]', '"sales_progress"', '{}', '{"intent":"inventory_overview"}',
    '{"intent":"sales_progress","spoken":"总数3138"}', '{"intent":3}', '{"intent":"constructor"}'])(
    "无效结果 fail-closed：%s", (content) => expect(parseIntent(content)).toBe("unanswerable"),
  );
  it.each(INTENT_CASES)("脚本分类 $question → $expected", ({ question, expected }) => {
    expect(classifyScriptedQuestion(question)).toBe(expected);
  });
  it.each(["销售利润是多少", "广东发货多少", "上个月销售多少", "浙江回款率多少", "2025年销售情况", "销售成本多少"])(
    "不支持的指标或筛选不偷换成总览：%s", (question) => expect(classifyScriptedQuestion(question)).toBe("unanswerable"),
  );
  it("完成率优先于销售关键词", () => {
    expect(classifyScriptedQuestion("销售目标完成率是多少")).toBe("target_rate");
  });
});
