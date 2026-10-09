import { describe, expect, it } from "vitest";
import { buildMockScreenPayload } from "./mock";

describe("screen mock contract", () => {
  it("mock 月份、窗口和提醒在北京月初保持一致", () => {
    const p = buildMockScreenPayload(new Date("2026-09-30T18:00:00Z"));
    expect(p.salesTargets.period.label).toBe("2026年10月");
    expect(p.dashboard.range).toMatchObject({ start: "2026-09-30T16:00:00.000Z", end: "2026-10-01T16:00:00.000Z", startDate: "2026-10-01", endDate: "2026-10-01" });
    expect(p.dashboard.shipmentReminders.today[0].estimatedShipmentDate).toContain("2026-10-01");
  });
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
