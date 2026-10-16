import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import seed from "../../services/voice-orchestrator/fixtures/public-sales-screen.json";
import snapshot from "./fixtures/nexus-sanitized.json";
import { ShipmentMap } from "@/components/screen/ShipmentMap";
import { fromPublicSalesScreenPayload } from "./public-screen-payload";
import { PULSE_RIPPLE_CITIES, ROUTE_WIDTH_TIERS, groupForRoute, groupRoutes, isLocalCity, linkTarget, localShipments, localUnitCount, routeWidth } from "./screen-map-routes";

const business = { ...seed, version: 1 as const, generatedAt: snapshot.generatedAt, delivery: { ...seed.delivery, routes: snapshot.routes } };

describe("P2.2 routes merged by destination city", () => {
  const groups = groupRoutes(snapshot.routes);
  const local = localShipments(snapshot.routes);
  const remote = snapshot.routes.filter(route => !local.includes(route));
  it("maps every outbound shipment to exactly one merged line and draws no line for a local shipment", () => {
    expect(local.length).toBeGreaterThan(0);
    for (const route of remote) {
      expect(groups.filter(g => g.routeKeys.includes(route.key))).toHaveLength(1);
      const group = groupForRoute(groups, route.key)!;
      expect([group.province, group.city]).toEqual([route.province, route.city]);
    }
    for (const route of local) expect(groups.some(g => g.routeKeys.includes(route.key))).toBe(false);
    expect(groups.reduce((sum, g) => sum + g.routeKeys.length, 0)).toBe(remote.length);
  });
  it("treats 枣庄, 滕州 and 枣庄市 as the origin prefecture", () => {
    expect(isLocalCity("枣庄")).toBe(true);
    expect(isLocalCity("滕州")).toBe(true);
    expect(isLocalCity("枣庄市")).toBe(true);
    expect(isLocalCity("山东滕州")).toBe(true);
    expect(isLocalCity("南通市")).toBe(false);
    expect(isLocalCity(null)).toBe(false);
  });
  it("links a local shipment to the origin glow and an outbound shipment to its one line", () => {
    const localKey = local[0].key;
    expect(linkTarget(groups, local.map(route => route.key), localKey)).toBe("origin");
    const outbound = remote[0];
    expect(linkTarget(groups, local.map(route => route.key), outbound.key)).toBe(groupForRoute(groups, outbound.key)!.key);
    const html = renderToStaticMarkup(createElement(ShipmentMap, { payload: fromPublicSalesScreenPayload(business) }));
    const listed = html.match(/data-local-route-keys="([^"]*)"/)?.[1].split(" ").filter(Boolean) ?? [];
    expect(listed).toEqual(expect.arrayContaining(local.map(route => route.key)));
    expect(html).toContain(`本地 ${localUnitCount(snapshot.routes)} 台`);
    expect(html).toContain('class="nexus-local-units"');
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.nexus-map-labels \.nexus-local-units\s*\{\s*white-space:\s*nowrap;\s*font-size:\s*13px;\s*line-height:\s*18px;\s*color:\s*#EE7D2C;\s*opacity:\s*\.85;/);
    const style = html.match(/nexus-local-units"[^>]*style="([^"]+)"/)?.[1] ?? "";
    const left = Number(style.match(/left:([-\d.]+)px/)?.[1]);
    const top = Number(style.match(/top:([-\d.]+)px/)?.[1]);
    const factory = html.match(/nexus-factory-label"[^>]*style="([^"]+)"/)?.[1] ?? "";
    const factoryLeft = Number(factory.match(/left:([-\d.]+)px/)?.[1]);
    const factoryTop = Number(factory.match(/top:([-\d.]+)px/)?.[1]);
    const originX = factoryLeft - 52, originY = factoryTop + 16;
    expect(left).toBeGreaterThan(originX + 44);
    expect(left).toBe(factoryLeft);
    expect(top - (factoryTop + 32)).toBe(2);
    expect(Math.hypot(left - originX, top - originY)).toBeGreaterThan(44);
  });
  it("draws one line per city even when the city has several shipments", () => {
    const html = renderToStaticMarkup(createElement(ShipmentMap, { payload: fromPublicSalesScreenPayload(business) }));
    const lines = [...html.matchAll(/data-city-key="([^"]+)" data-route-keys="([^"]+)"[^>]*data-route-bright/g)];
    expect(lines).toHaveLength(groups.length);
    expect(new Set(lines.map(m => m[1])).size).toBe(lines.length);
    const nantong = snapshot.routes.filter(r => r.city === "南通市");
    expect(nantong.length).toBeGreaterThan(1);
    expect(lines.filter(m => nantong.some(r => m[2].split(" ").includes(r.key)))).toHaveLength(1);
    expect(html.match(/data-route-baseline="true"/g)).toHaveLength(groups.length);
  });
  it("uses three unit-based widths with the documented thresholds", () => {
    expect(ROUTE_WIDTH_TIERS.map(t => [t.minUnits, t.width])).toEqual([[5, 2.5], [2, 2], [0, 1.5]]);
    expect([1, 2, 4, 5, 9].map(routeWidth)).toEqual([1.5, 2, 2, 2.5, 2.5]);
    for (const g of groups) expect(g.width).toBe(routeWidth(g.units));
  });
  it("ripples at most five top-unit cities during the resonance, none of them the origin city", () => {
    const ripple = groups.filter(g => g.pulseRipple);
    expect(PULSE_RIPPLE_CITIES).toBe(5);
    expect(ripple.length).toBeLessThanOrEqual(5);
    expect(ripple.every(g => !isLocalCity(g.city))).toBe(true);
    const minRipple = Math.min(...ripple.map(g => g.units));
    expect(groups.filter(g => !g.pulseRipple).every(g => g.units <= minRipple)).toBe(true);
    const html = renderToStaticMarkup(createElement(ShipmentMap, { payload: fromPublicSalesScreenPayload(business) }));
    expect(html.match(/data-pulse-ripple="true"/g)!.length).toBeLessThanOrEqual(5);
  });
  it("keeps the top-five ripple selection fixed by units, then shipment count, then city key when input is shuffled", () => {
    // Z/Y win on units even with fewer tickets; D/E win the unit tie on tickets;
    // A wins the remaining equal-unit/equal-ticket slot ahead of B/C.
    const cities = [
      { city: "Z", units: [10] }, { city: "Y", units: [9] },
      { city: "D", units: [3, 3, 2] }, { city: "E", units: [4, 4] },
      { city: "C", units: [8] }, { city: "B", units: [8] }, { city: "A", units: [8] },
    ];
    const routes = cities.flatMap(({ city, units }) => units.map((unitCount, i) => ({
      ...snapshot.routes[0], key: `${city}-${i}`, province: "测试省", city, unitCount,
    })));
    const selected = (input: typeof routes) => groupRoutes(input).filter(g => g.pulseRipple).map(g => g.key).sort();
    const expected = ["测试省|A", "测试省|D", "测试省|E", "测试省|Y", "测试省|Z"];
    expect(selected(routes)).toEqual(expected);
    expect(selected([...routes].reverse())).toEqual(expected);
    // Every cyclic permutation, plus a ticket-interleaved permutation.
    for (let i = 1; i < routes.length; i++) expect(selected([...routes.slice(i), ...routes.slice(0, i)])).toEqual(expected);
    expect(selected([...routes.filter((_, i) => i % 2), ...routes.filter((_, i) => !(i % 2))])).toEqual(expected);
  });
  it("orders lines from nearest to farthest for the sequential lighting", () => {
    const orders = groups.map(g => g.order).sort((a, b) => a - b);
    expect(orders[0]).toBe(0); expect(orders[orders.length - 1]).toBe(1);
    expect(new Set(orders).size).toBe(groups.length);
  });
});
