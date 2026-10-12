import { describe, expect, it } from "vitest";
import { cardExcerpt } from "./card-presentation";
import { provinceShortName } from "../geo";
describe("long display labels",()=>{
  it("removes longest legal company suffix and keeps both ends",()=>{
    const original="新疆维吾尔自治区乌鲁木齐经济技术开发区重型精密数控机床装备制造股份有限公司";
    expect(cardExcerpt(original,20)).toBe("新疆维吾尔自…制造");
    expect(original.endsWith("股份有限公司")).toBe(true);
  });
  it("keeps a short company readable without an unnecessary ellipsis",()=>{
    expect(cardExcerpt("滕州大川机床有限公司",20)).toBe("滕州大川机床");
  });
  it("never cuts a supplementary Unicode character in half",()=>{
    expect(cardExcerpt("😀😀😀😀😀😀😀😀",6)).toBe("😀😀😀…😀😀");
  });
  it("shortens autonomous region labels and preserves unknown regions",()=>{
    expect(["内蒙古自治区","广西壮族自治区","新疆维吾尔自治区","未识别区域"].map(provinceShortName)).toEqual(["内蒙古","广西","新疆","未识别区域"]);
  });
});
