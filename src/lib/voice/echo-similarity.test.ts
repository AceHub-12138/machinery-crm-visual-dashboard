import { expect, it } from "vitest";
import { echoSimilarity } from "./echo-similarity";
it("normalizes punctuation and full width, with a symmetric max-length denominator", () => {
  expect(echoSimilarity("你好，小川！１２", "你好小川12")).toBe(1);
  expect(echoSimilarity("甲乙", "甲乙丙丁")).toBe(.5);
  expect(echoSimilarity("甲乙丙丁", "甲乙")).toBe(.5);
  expect(echoSimilarity("多少客户", "本月销售合同金额")).toBeLessThan(.5);
  expect(echoSimilarity("", "你好")).toBe(0);
});
