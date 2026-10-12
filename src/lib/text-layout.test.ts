import {describe,expect,it} from "vitest";
import {textRuns,PROTECTED_WORDS} from "./text-layout";
import {maskedContractTail,cardContractTail,listingCopy} from "./display-copy";
import {isUnsupportedCard} from "./voice/card-presentation";
import {buildBriefCard,VOICE_COVERAGE_FALLBACK} from "./voice/card-builders";
describe("visual acceptance presentation rules",()=>{
  it("uses the same intact words and numeric units for titles and speech without changing offsets",()=>{
    const text="😀区域交付距离目标还有 ¥9.88亿，本期新合同欠款 30台。";
    const runs=textRuns(text);expect(runs.map(r=>r.text).join("")).toBe(text);
    for(const run of runs)expect(text.slice(run.start,run.end)).toBe(run.text);
    for(const word of PROTECTED_WORDS.filter(word=>text.includes(word)))expect(runs.some(r=>r.atomic && r.text.includes(word))).toBe(true);
    expect(runs.some(r=>r.numeric && r.text==="¥9.88亿")).toBe(true);
  });
  it("extracts a masked tail and keeps leading zeroes",()=>{expect(maskedContractTail("****0123")).toBe("0123");expect(maskedContractTail("****20260123")).toBe("0123");expect(cardContractTail("合同尾号 0123")).toBe("0123");});
  it("empty or unmasked values do not create a contract number",()=>{for(const value of [null,undefined,"","山东","DC-2026-0123"])expect(maskedContractTail(value)).toBeNull();});
  it("changes viewer wording without recalculating either count",()=>{expect(listingCopy(2,3)).toBe("当前列出 2 条，已收录 3 条");expect(listingCopy(2,-3)).toContain("数据待核对");});
  it("coverage fallback is a warning while a greeting remains normal",()=>{expect(isUnsupportedCard(buildBriefCard("小川",[VOICE_COVERAGE_FALLBACK]))).toBe(true);expect(isUnsupportedCard(buildBriefCard("小川",["我在,先生。请讲。"])) ).toBe(false);});
});
