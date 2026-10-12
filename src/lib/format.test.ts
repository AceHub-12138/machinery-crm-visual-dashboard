import { describe, expect, it } from "vitest";
import { formatMoney, formatMoneyParts } from "./format";
describe("money display parts", () => {
  it.each([[987654321,"¥9.88亿"],[123456789.5,"¥1.23亿"],[0,"¥0"],[-1234567,"数据待核对"],[9999,"¥9,999"]])("preserves amount %s", (value, expected) => {
    expect(formatMoney(value as number)).toBe(expected);
    const p = formatMoneyParts(value as number);
    expect(p.currency+p.number+p.unit).toBe(expected);
  });
  it("keeps wire precision and marks signed negative values pending", () => {
    expect(formatMoneyParts("¥-1,234.5万")).toEqual({currency:"",number:"数据待核对",unit:""});
    expect(formatMoneyParts("已超额 ¥12.3万")).toEqual({currency:"",number:"已超额 ¥12.3万",unit:""});
  });
});
