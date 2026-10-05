import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { buildMockScreenPayload } from "./mock";
import { toPublicScreenPayload } from "./public-screen-payload";
import { ScreenStage } from "@/components/screen/ScreenStage";
import { GET } from "@/app/api/screen/crm/route";

describe("大屏公开数据契约", () => {
  it("API 不输出客户名称、跟进正文、业务员资料、备注或精确地址", async () => {
    const response = GET();
    const payload = await response.json();
    const json = JSON.stringify(payload);
    for (const key of ["companyName", "recentFollows", "salesUsers", "content", "note", "receivingAddress", "address"]) {
      expect(json).not.toContain(`\"${key}\"`);
    }
    expect(payload.salesTargets.targets.every((t: { salesUserId: unknown }) => t.salesUserId === null)).toBe(true);
    expect(json).not.toContain("陈浩");
    expect(json).not.toContain("精工传动有限公司");
  });
  it("首屏所需的时间范围、提醒、交付里程碑和公司目标完整保留", () => {
    const source = buildMockScreenPayload(new Date("2026-10-05T12:00:00+08:00"));
    const payload = toPublicScreenPayload(source);
    expect(payload.dashboard.range).toEqual(source.dashboard.range);
    expect(payload.dashboard.shipmentPaths).toHaveLength(source.dashboard.shipmentPaths.length);
    expect(payload.dashboard.stats).toEqual(source.dashboard.stats);
    const html = renderToStaticMarkup(createElement(ScreenStage, { initialPayload: payload, kiosk: false, initialFit: false }));
    expect(html).toContain("交付里程碑");
    expect(html).not.toContain("有限公司");
  });
  it("输入新增未知字段不会被公开出口透传", () => {
    const source = buildMockScreenPayload();
    Object.assign(source.dashboard.stats, { secret: "sensitive" });
    Object.assign(source.map.factory, { secret: "sensitive" });
    Object.assign(source.salesTargets.period, { secret: "sensitive" });
    expect(JSON.stringify(toPublicScreenPayload(source))).not.toContain("secret");
  });
});
