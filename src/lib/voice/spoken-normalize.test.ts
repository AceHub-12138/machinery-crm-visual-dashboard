import { describe, expect, it } from "vitest";
import { buildSpokenSentences, normalizeSpokenText } from "./spoken-normalize";

describe("显示文本转中文读法", () => {
  it.each([
    ["¥1,286.0万", "一千二百八十六万元"],
    ["1.24亿元", "一点二四亿元"],
    ["¥1.24亿", "一点二四亿元"],
    ["110.2%", "百分之一百一十点二"],
    ["386台 / 12项", "三百八十六台/十二项"],
    ["2026-10-06", "二零二六年十月六日"],
    ["2026年9月", "二零二六年九月"],
    ["09-28", "九月二十八日"],
    ["-3.5%", "负百分之三点五"],
    ["¥-2,716.0万", "负二千七百一十六万元"],
    ["¥999", "九百九十九元"],
    ["¥1,000.00元", "一千元"],
    ["¥0.0万", "零万元"],
    ["1,234,567台", "一百二十三万四千五百六十七台"],
    ["10、11、20、101、1001、10001、100000001", "十、十一、二十、一百零一、一千零一、一万零一、一亿零一"],
    ["第3名,共12项", "第三名,共十二项"],
    ["0.05%", "百分之零点零五"],
    ["先生,请讲。", "先生,请讲。"],
  ])("%s → %s", (display, expected) => expect(normalizeSpokenText(display)).toBe(expected));

  it("偏移指向显示原文，不被金额小数和汉字读法长度影响", () => {
    const display = "先生,合同额 ¥1,286.0万。完成率85.7%！还需继续跟进?";
    const sentences = buildSpokenSentences(display);
    expect(sentences).toHaveLength(3);
    expect(sentences.map((s) => s.text).join("")).toBe(display);
    expect(sentences[0].spokenText).toBe("先生,合同额一千二百八十六万元。");
    sentences.forEach((sentence, i) => {
      expect(sentence.index).toBe(i);
      expect(display.slice(sentence.displayStart, sentence.displayEnd)).toBe(sentence.text);
      expect(sentence.spokenText).not.toMatch(/[\d¥%]/);
    });
  });
  it("无末尾句号仍保留最后一句，空字符串不产生音频句", () => {
    expect(buildSpokenSentences("你好。还有12项").map((s) => s.text)).toEqual(["你好。", "还有12项"]);
    expect(buildSpokenSentences(" ")).toEqual([]);
  });
});
