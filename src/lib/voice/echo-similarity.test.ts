import { expect, it } from "vitest";
import { echoSimilarity } from "./echo-similarity";
const answer = "本月累计销售额一千二百万元，完成年度目标的百分之六十二";
it.each([
  ["目标的百分之六十二", answer, true],
  ["一千二百万元完成年度目标", answer, true],
  ["本月销售额环比呢", "本月销售额环比增长百分之五", false],
  ["今年目标完成多少了", "今年目标完成百分之六十二", false],
  [answer, answer, true],
  ["二百万元完成年度", answer, true],
  ["这台机床怎么操作", answer, false],
  ["本月销售額", "本月销售额为一千万元", true],
  ["本月销售额？", "本月销售额为一千万元", false],
  ["还有什么问题吗", "先生，还有什么问题吗？", true],
] as const)("fragment %s against %s is echo=%s", (text, reference, echo) => {
  expect(echoSimilarity(text, reference) >= .5).toBe(echo);
});
it("normalizes full width and punctuation, but uses the ASR length", () => {
  expect(echoSimilarity("你好，小川！１２", "你好小川12")).toBe(1);
  expect(echoSimilarity("甲乙", "甲乙丙丁")).toBe(1);
  expect(echoSimilarity("甲乙丙丁", "甲乙")).toBe(.5);
  expect(echoSimilarity("", "你好")).toBe(0);
  expect(echoSimilarity("你好", "")).toBe(0);
});
it("question words must exist in the aligned fragment, not somewhere else", () => {
  expect(echoSimilarity("本月销售额多少", "多少客户。本月销售额一千万元")).toBe(0);
});
