import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import seed from "../../services/voice-orchestrator/fixtures/public-sales-screen.json";
import snapshot from "./fixtures/nexus-sanitized.json";
import { ContractGauge, ShipmentFeed } from "@/components/screen/NexusPanels";
import { ShipmentMap } from "@/components/screen/ShipmentMap";
import { feedCity, latestRoutes } from "./feed-mask";
import { regionZone } from "./region-zone";
import { fromPublicSalesScreenPayload } from "./public-screen-payload";
import { CITY_LABEL_SIZE, boxesOverlap, mapCityName, placeCityLabels } from "./screen-map-labels";
import { projectLonLat } from "./geo";
import { placeProvinceLabels, visibleProvinceFraction } from "./screen-map-provinces";
import { isLocalCity } from "./screen-map-routes";
import { layoutGeometry, resolveScreenLayout } from "./screen-layout";

// The fixture freezes synthetic public snapshot fields used by A5–A7. Seed fills unused
// type-required sections; every contract/target/route field under test is synthetic.
const business = { ...seed, version: 1 as const, generatedAt: snapshot.generatedAt,
  kpis: { ...seed.kpis, ...snapshot.kpis }, collection: snapshot.collection,
  delivery: { ...seed.delivery, routes: snapshot.routes } };
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("NEXUS P2 A: sanitized snapshot visual regressions", () => {
  it("A5: every region includes zone/province, with city only from three orders", () => {
    const routes = snapshot.routes;
    expect(routes).toHaveLength(80);
    const few = routes.find(r => r.city === "盐城市")!;
    const many = routes.find(r => r.city === "南通市")!;
    const noCity = routes.find(r => r.city === null)!;
    expect(feedCity(few, routes)).toBe("华东 · 江苏省");
    expect(feedCity(many, routes)).toBe("华东 · 江苏省 · 南通市");
    expect(feedCity(noCity, routes)).toBe(`${regionZone(noCity.province)} · ${noCity.province}`);
    for (const route of routes) {
      const count = routes.filter(r => r.province === route.province && r.city === route.city).length;
      const parts = feedCity(route, routes).split(" · ");
      expect(parts.slice(0, 2)).toEqual([regionZone(route.province), route.province]);
      expect(parts.slice(2)).toEqual(route.city && count >= 3 ? [route.city] : []);
    }
    const html = renderToStaticMarkup(createElement(ShipmentFeed, { business, activeKey: null, onSelect: () => {} }));
    expect(html).not.toContain("nexus-feed-top");
    for (const route of latestRoutes(routes)) expect(html).toContain(`<span class="nexus-feed-region">${feedCity(route, routes)}</span>`);
  });

  it("A6: unconfigured synthetic target has an empty grey ruler, 未设定 and —", () => {
    expect(snapshot.collection.targetConfigured).toBe(false);
    const html = renderToStaticMarkup(createElement(ContractGauge, { business }));
    expect(html).toContain('class="nexus-ruler nexus-ruler-empty" aria-label="月度目标未设定"></div>');
    expect(html.replace(/<[^>]*>/g, "")).toContain("¥68.4万");
    expect(html).not.toContain("nexus-ruler-fill");
    expect(html).not.toContain('role="meter"');
    expect(html).toContain('<strong class="nexus-unset">未设定</strong>');
    expect(html).toMatch(/class="fit-text nexus-unset"[^>]*>—<\/span>/);
    expect(html).not.toContain("未设目标");
    expect(html).not.toContain("nexus-orange\">—");
    expect(css).toMatch(/\.nexus-unset\s*\{\s*color:\s*#8A93A0;/);
    expect(css).toMatch(/\.nexus-ruler\.nexus-ruler-empty\s*\{[^}]*color:\s*#8A93A0;[^}]*border-color:\s*#8A93A0;/);
  });

  it("A7: real city names drop 市, avoid collisions by switching sides or omitting text, and always keep 山东滕州", () => {
    const layout = resolveScreenLayout(), g = layoutGeometry(layout, snapshot.routes);
    const candidates = [...new Map(snapshot.routes.filter(r => r.city).map(r => [r.province + r.city, r])).values()].map(r => {
      const p = projectLonLat(r.centerLng, r.centerLat);
      return { text: r.city!, x: g.mapLeft + (p.x - g.viewportX) * g.scale,
        y: g.mapTop + (p.y - g.viewportY) * g.scale };
    });
    const normal = placeCityLabels(candidates, { l: 0, r: layout.map, t: 72, b: g.contentHeight - 28 }, []);
    expect(normal.length).toBeGreaterThan(0);
    for (let i = 0; i < normal.length; i++) {
      for (const other of normal.slice(i + 1)) expect(boxesOverlap(normal[i].box, other.box)).toBe(false);
    }
    // Use the real render for normal geometry, plus a dense layout of real names
    // to deterministically exercise the alternate-side and omission rules.
    const dense = candidates.slice(0, 3).map(r => ({ ...r, x: 200, y: 150 }));
    const placed = placeCityLabels(dense, { l: 0, r: 400, t: 0, b: 300 }, []);
    expect(placed.map(r => r.side)).toEqual(["right", "left"]);
    expect(placed.map(r => r.text)).toEqual(dense.slice(0, 2).map(r => mapCityName(r.text)));
    expect(boxesOverlap(placed[0].box, placed[1].box)).toBe(false);
    expect(placeCityLabels(dense, { l: 0, r: 400, t: 0, b: 300 }, [{ l: 0, r: 400, t: 0, b: 300 }])).toEqual([]);
    const html = renderToStaticMarkup(createElement(ShipmentMap, { payload: fromPublicSalesScreenPayload(business) }));
    const labels = [...html.matchAll(/data-map-label="([^"]+)"/g)].map(m => m[1]);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every(name => !name.endsWith("市") && snapshot.routes.some(r => r.city && mapCityName(r.city) === name))).toBe(true);
    expect(html).toContain("山东滕州");
    const cities = new Set(snapshot.routes.filter(r => !isLocalCity(r.city)).map(r => `${r.province}|${r.city ?? ""}`)).size;
    expect(html.match(/data-route-baseline="true"/g)).toHaveLength(cities);
    expect(html.match(/stroke-opacity="0.4"/g)?.length).toBeGreaterThanOrEqual(cities);
    expect(CITY_LABEL_SIZE).toBe(16);
    expect(css).toMatch(/\.nexus-map-labels \.nexus-city-label\s*\{\s*font-size:\s*16px;/);
  });

  it("P2.1: province names need >60% visible area, yield to city labels by omission, and the national minimap keeps Taiwan and the South China Sea islands", () => {
    const layout = resolveScreenLayout(), g = layoutGeometry(layout, snapshot.routes);
    const toPixel = (x: number, y: number) => ({ x: g.mapLeft + (x - g.viewportX) * g.scale, y: g.mapTop + (y - g.viewportY) * g.scale });
    const viewport = { l: g.viewportX, r: g.viewportX + g.viewportWidth, t: g.viewportY, b: g.viewportY + g.viewportHeight };
    const screen = { l: g.mapLeft, r: g.mapLeft + g.mapWidth, t: g.mapTop, b: g.mapBottom };
    const cities = placeCityLabels([...new Map(snapshot.routes.filter(r => r.city).map(r => [r.province + r.city, r])).values()].map(r => {
      const p = projectLonLat(r.centerLng, r.centerLat); return { text: r.city!, ...toPixel(p.x, p.y) };
    }), screen, []);
    const free = placeProvinceLabels(viewport, toPixel, screen, []);
    const placed = placeProvinceLabels(viewport, toPixel, screen, cities.map(c => c.box));
    expect(free.length).toBeGreaterThan(0);
    for (const p of free) expect(visibleProvinceFraction(p.adcode, viewport)).toBeGreaterThan(.6);
    for (const p of placed) {
      expect(cities.some(c => boxesOverlap(c.box, p.box))).toBe(false);
      expect(p.box.r - p.box.l).toBe(p.text.length * 14);
      const same = free.find(q => q.adcode === p.adcode)!;
      expect([p.x, p.y]).toEqual([same.x, same.y]);
    }
    const blocked = free[0];
    expect(placeProvinceLabels(viewport, toPixel, screen, [blocked.box]).some(p => p.adcode === blocked.adcode)).toBe(false);
    const html = renderToStaticMarkup(createElement(ShipmentMap, { payload: fromPublicSalesScreenPayload(business) }));
    expect(html).toContain('data-minimap-taiwan="true"');
    expect(html).toContain('data-minimap-viewport="true"');
    expect(html).toContain("<p>南海诸岛</p>");
    // Minimap y = 56 − latitude; Nansha polygons lie entirely south of 12°N.
    const southern = [...html.matchAll(/<path d="([^"]+)" data-national-polygon/g)].filter(m => [...m[1].matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].every(p => Number(p[2]) > 44));
    expect(southern.length).toBeGreaterThan(0);
    expect(css).toMatch(/\.nexus-islands-svg\s*\{\s*width:\s*110px;/);
  });
});
