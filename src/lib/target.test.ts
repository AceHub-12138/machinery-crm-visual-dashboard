import { describe, expect, it } from "vitest";
import { calculateSalesTargetProgress } from "./target";

describe("sales target progress", () => {
  it("matches the CRM visualRate cap used by the live platform", () => {
    const result = calculateSalesTargetProgress(12860000, 15000000);
    expect(result.completionRate).toBe(85.7);
    expect(result.visualRate).toBe(85.7);
    expect(result.exceeded).toBe(false);
    expect(result.remainingAmount).toBe("2140000.00");
  });

  it("caps visualRate at 100 when the target is exceeded", () => {
    const result = calculateSalesTargetProgress(18000000, 15000000);
    expect(result.completionRate).toBe(120);
    expect(result.visualRate).toBe(100);
    expect(result.exceeded).toBe(true);
    expect(result.exceededAmount).toBe("3000000.00");
  });
});
