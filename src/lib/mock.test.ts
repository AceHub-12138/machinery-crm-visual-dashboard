import { describe, expect, it } from "vitest";
import { buildMockScreenPayload } from "./mock";

describe("screen mock contract", () => {
  it("exposes the CRM dashboard and sales-target fields the live platform already has", () => {
    const payload = buildMockScreenPayload(new Date("2026-09-15T10:00:00+08:00"));
    expect(payload.source).toBe("mock");
    expect(payload.dashboard.stats.periodContractAmount).toBe(12860000);
    expect(payload.dashboard.shipmentReminders.overdue).toHaveLength(3);
    expect(payload.salesTargets.period.type).toBe("MONTH");
    expect(payload.salesTargets.targets[0].salesUserId).toBeNull();
    expect(payload.map.factory.name).toContain("滕州");
    expect(payload.map.routes[0].origin.lng).toBeCloseTo(117.17, 1);
    expect(payload.map.routes.some((route) => route.city === "上海")).toBe(true);
  });
});
