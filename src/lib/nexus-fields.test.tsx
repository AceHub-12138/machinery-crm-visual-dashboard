import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import fixture from "../../services/voice-orchestrator/fixtures/public-sales-screen.json";
import { fromPublicSalesScreenPayload } from "./public-screen-payload";
import { validatePublicPayload } from "./voice/public-payload";
import { buildIntentAnswer } from "./voice/intent-answers";
import { OperationMetrics, DeliveryAlerts } from "@/components/screen/NexusPanels";
import { ScreenStage } from "@/components/screen/ScreenStage";
import { SCREEN_LAYOUTS } from "./screen-layout";
import { formatMoney } from "./format";
import { HeaderBar } from "@/components/screen/HeaderBar";
const at = Date.parse(fixture.generatedAt);
const data = () => validatePublicPayload(structuredClone(fixture));
const html = (p = data(), now = at) => renderToStaticMarkup(createElement(ScreenStage, { initialPayload: fromPublicSalesScreenPayload(p), kiosk: false, initialFit: false, now }));
describe("NEXUS strict business fields", () => {
  it("uses platform values for amounts, rates, targets, counts, due buckets and regions", () => {
    const p = data();
    p.kpis.periodShipments = 888; p.collection.actualAmount = "111";
    p.collection.targetRate = 1234.5; p.collection.collectionRate = 61.2; p.collection.targetVisualRate = 79;
    const out = html(p);
    expect(out.replace(/<[^>]*>/g, "")).toContain(formatMoney(Number(p.kpis.periodContractAmount))); expect(out.replace(/<[^>]*>/g, "")).toContain(formatMoney(Number(p.kpis.periodPaidAmount)));
    expect(out.replace(/<[^>]*>/g, "")).toContain(formatMoney(Number(p.collection.totalPaidAmount))); expect(out.replace(/<[^>]*>/g, "")).toContain(formatMoney(Number(p.collection.totalUnpaidAmount)));
    expect(out).toContain("1234.5%"); expect(out).toContain("61.2%"); expect(out).toContain('width:79%');
    expect(out.replace(/<[^>]*>/g, "")).not.toContain("888"); expect(out).toContain('aria-label="交付里程碑"');
    expect(out).toContain(`本期 <strong>${p.delivery.summary.unitCount}</strong> 台`);
    expect(out.match(/人民币口径/g)).toHaveLength(2);
  });
  it("uses the same sevenDayDue value for the operation row and alert card", () => {
    const p = data(); p.delivery.summary.sevenDayDue = 99;
    const metrics = renderToStaticMarkup(createElement(OperationMetrics, { business: p }));
    const alerts = renderToStaticMarkup(createElement(DeliveryAlerts, { business: p }));
    expect(metrics).toContain("7 日内待发 99 单");
    expect(alerts).toContain("<p>7 日内待发</p><strong>99<small> 单</small></strong>");
    expect(metrics).not.toContain(`待发 ${p.delivery.summary.shipmentCount} 单`);
  });
  it("only labels real shipment cities; initial route highlights belong to the director", () => {
    const p = data(); const out = html(p);
    const labels = [...out.matchAll(/data-map-label="([^"]+)"/g)].map(m => m[1]);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every(label => p.delivery.routes.some(r => r.city?.replace(/市$/, "") === label))).toBe(true);
    expect(out).toContain("山东滕州"); expect(out).toContain("nexus-province-label");
    const bright = [...out.matchAll(/data-city-key="([^"]+)"[^>]*data-route-bright="true"/g)].map(m => m[1]);
    expect(bright).toEqual([]);
    expect(out).toContain('aria-label="合同目标刻度"'); expect(out).toContain("nexus-dial-scale");
    expect(out).toContain("统计周期：2026 年 9 月");
  });
  it("covers negative amounts, null city, unconfigured target, stale/unavailable and notice fixtures", () => {
    const p = data(); p.displayNotice = true; p.kpis.periodContractAmount = "-98765"; p.collection.targetConfigured = false;
    p.delivery.routes[0].city = null;
    expect(html(p)).toContain("数据待核对"); expect(html(p)).not.toContain("-98765");
    expect(html(p)).toContain("未设定"); expect(html(p)).not.toContain("展厅演示数据");
    expect(html(p, at + 11 * 60_000)).toContain("数据更新于");
    const unavailable = html(p, at + 25 * 60 * 60_000);
    expect(unavailable).toContain("数据暂不可用"); expect(unavailable).not.toContain("最新发货动态");
  });
  it("only renders a demo badge in explicit demo mode, independently of the payload notice", () => {
    for (const demoMode of [false, true]) for (const displayNotice of [false, true]) {
      const out = renderToStaticMarkup(createElement(HeaderBar, { periodLabel: "2026年9月", demoMode, displayNotice }));
      expect(out.includes('nexus-notice')).toBe(demoMode);
      if (demoMode) expect(out).toContain(displayNotice ? "展厅演示数据" : "演示数据");
    }
  });
  it("caps gauge geometry only, shows exceeded amount, and retains unknown region totals", () => {
    const p = data(); p.collection.targetRate = 120; p.collection.targetVisualRate = 120; p.collection.exceeded = true; p.collection.exceededAmount = "123456";
    p.delivery.unresolvedRegionTotals = { unitCount: 1, shipmentCount: 1 };
    p.delivery.summary.unitCount++; p.delivery.summary.shipmentCount++;
    const out = html(p);
    expect(out).toContain("120.0%"); expect(out).toContain('width:100%'); expect(out).toContain("nexus-overrun-triangle"); expect(out).toContain("超额 ¥12.35 万");
    expect(out).toContain("地区待确认");
  });
  it("keeps map, islands and five linkage keys in every profile; no text in SVG backgrounds", () => {
    for (const layout of Object.values(SCREEN_LAYOUTS)) {
      const p = data(); const out = renderToStaticMarkup(createElement(ScreenStage, { initialPayload: fromPublicSalesScreenPayload(p), layout, kiosk: false, initialFit: false, now: at }));
      expect(out.match(/data-map-layer=/g)).toHaveLength(3); expect(out).toContain('aria-label="全国地图（含台湾及南海诸岛）"'); expect(out).not.toContain("数据来源"); expect(out).not.toContain("审图号"); expect(out).not.toContain("待架构师提供");
      expect(out).not.toContain("<text"); expect(out.match(/data-route-bright="true"/g)?.length ?? 0).toBeLessThanOrEqual(2);
      expect(out.match(/class="nexus-feed-item"/g)).toHaveLength(5);
    }
  });
  it("matches the existing XiaoChuan formatter and spoken amounts for two screen numbers", () => {
    const p = data(), answer = buildIntentAnswer("sales_progress", p), out = html(p);
    for (const value of [p.kpis.periodContractAmount, p.kpis.periodPaidAmount]) {
      const amount = formatMoney(Number(value)); expect(out.replace(/<[^>]*>/g, "")).toContain(amount); expect(answer.spoken).toContain(amount);
    }
  });
  it("reads only whitelist fields and never renders unknown data", () => {
    const p = data();
    Object.assign(p.kpis, { secretCustomer: "SECRET_CUSTOMER" });
    Object.assign(p.delivery.routes[0], { address: "SECRET_ADDRESS" });
    const screen = fromPublicSalesScreenPayload(p);
    const allowed = screen.business!;
    const reads: string[] = [];
    function observe(value: unknown, prefix = ""): unknown {
      if (!value || typeof value !== "object") return value;
      return new Proxy(value, { get(target, key, receiver) {
        const child = Reflect.get(target, key, receiver);
        if (typeof key === "string" && typeof child !== "function" && !(Array.isArray(target) && key === "length")) {
          const field = `${prefix}${Array.isArray(target) && /^\d+$/.test(key) ? "[]" : key}`;
          if (child === null || typeof child !== "object") reads.push(field);
          return observe(child, field + ".");
        }
        return child;
      } });
    }
    const observed = { ...screen, business: observe(allowed) as typeof allowed };
    const out = renderToStaticMarkup(createElement(ScreenStage, { initialPayload: observed, kiosk: false, initialFit: false, now: at }));
    const whitelist = new Set<string>();
    function collect(value: unknown, prefix = "") {
      if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
        const field = `${prefix}${Array.isArray(value) ? "[]" : key}`;
        if (child === null || typeof child !== "object") whitelist.add(field); else collect(child, field + ".");
      }
    }
    collect(allowed);
    expect(reads.length).toBeGreaterThan(50);
    expect([...new Set(reads)].filter(field => !whitelist.has(field))).toEqual([]);
    expect(reads).not.toContain("kpis.secretCustomer"); expect(out).not.toContain("SECRET_");
    expect(JSON.stringify(screen)).not.toContain("SECRET_");
  });
});
