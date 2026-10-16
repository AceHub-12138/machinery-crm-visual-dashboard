import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAP_HEADING_HEIGHT, MAP_PANEL_CLEARANCE, SCREEN_LAYOUTS, layoutGeometry, resolveScreenLayout } from "./screen-layout";
import { chinaMap, projectLonLat } from "./geo";
import snapshot from "./fixtures/nexus-sanitized.json";
import { MAP_ENDPOINT_RADIUS, ellipseRadius, routeBounds, routeViewport } from "./screen-map-viewport";

const source = readFileSync(path.resolve(import.meta.dirname, "../components/screen/ScreenStage.tsx"), "utf8");
const css = readFileSync(path.resolve(import.meta.dirname, "../app/globals.css"), "utf8");
// All nine original geometry checks remain; budgets now come from each profile.
describe.each(Object.values(SCREEN_LAYOUTS))("screen grid geometry: $id", layout => {
  const g = layoutGeometry(layout, snapshot.routes);
  it("has one flexible track per axis", () => {
    expect(css).toContain("grid-template-rows: minmax(0,1fr) var(--feed-height)");
    // Horizontal remainder is resolved once in config, avoiding runtime drift.
    expect(layout.map).toBe(layout.width - 2 * layout.margin - 2 * layout.rail - 2 * layout.gap);
    expect(g.contentHeight).toBeGreaterThan(0);
  });
  it("fills the stage exactly — no horizontal or vertical overflow", () => {
    expect(2 * layout.margin + 2 * layout.rail + 2 * layout.gap + layout.map).toBe(layout.width);
    expect(layout.header + 2 * layout.paddingY + g.contentHeight + layout.rowGap + layout.feed).toBe(layout.height);
    expect(css).toContain("grid-template-columns: var(--rail-width) var(--map-width) var(--rail-width)");
  });
  it("gives the map column enough width that China renders large", () => {
    const viewportScreenW = g.viewportWidth * g.scale;
    expect(viewportScreenW).toBeGreaterThan(390);
    expect(g.longitude).toBeGreaterThanOrEqual(18);
    expect(g.latitude).toBeGreaterThanOrEqual(14);
    expect(g.contentHeight).toBe(layout.height - layout.header - layout.paddingY * 2 - layout.rowGap - layout.feed);
  });
  it("centers the route viewport at the largest endpoint-safe scale and preserves the glow anchor", () => {
    expect(g.mapWidth / g.mapSurfaceHeight).toBeCloseTo(g.viewportWidth / g.viewportHeight, 8);
    expect(g.mapLeft).toBeCloseTo((layout.map - g.mapWidth) / 2, 8);
    const bounds = routeBounds(snapshot.routes), center = projectLonLat(bounds.centerLng, bounds.centerLat);
    const routeCentre = g.mapTop + (center.y - g.viewportY) * g.scale;
    expect(Math.abs(routeCentre - g.landCenter)).toBeLessThanOrEqual(2);
    expect(g.viewportX + g.viewportWidth / 2).toBeCloseTo(center.x, 8);
    expect(layout.header + layout.paddingY + g.glowBottom).toBeCloseTo(layout.height * .67, 8);
    const viewport = routeViewport(snapshot.routes, layout.map - 2 * MAP_PANEL_CLEARANCE - 2, g.mapBottom - MAP_HEADING_HEIGHT - 18 - 2);
    expect(g.viewportWidth * g.scale).toBeCloseTo(viewport.viewportWidth * viewport.scale, 8);
    expect(g.mapLeft).toBeGreaterThanOrEqual(24);
    expect(g.mapLeft + g.mapWidth).toBeLessThanOrEqual(layout.map - 24);
    expect(g.mapTop).toBeGreaterThanOrEqual(MAP_HEADING_HEIGHT);
    expect(g.mapTop + g.mapHeight).toBeLessThanOrEqual(g.contentHeight - 24);
    // The map fills the available column width; every endpoint sits inside the 0.68 mask ellipse.
    expect(g.mapWidth).toBe(layout.map - 2 * MAP_PANEL_CLEARANCE - 2);
    expect(MAP_ENDPOINT_RADIUS).toBe(.68);
    for (const r of [...snapshot.routes, { centerLng: chinaMap.factory.lon, centerLat: chinaMap.factory.lat }]) {
      const p = projectLonLat(r.centerLng, r.centerLat);
      const x = (p.x - g.viewportX) * g.scale, y = (p.y - g.viewportY) * g.scale;
      expect(ellipseRadius(x, y, g.mapWidth, g.mapHeight)).toBeLessThanOrEqual(.68);
    }
    const block = css.match(/\.map-svg\s*\{([^}]*)\}/)?.[1] ?? "";
    for (const variable of ["--map-left", "--map-top", "--map-svg-width", "--map-svg-height"]) expect(block).toContain(`var(${variable})`);
  });
  it("keeps the complete map frame 24px from panels and clear of every heading", () => {
    const x = layout.margin + layout.rail + layout.gap;
    const y = layout.header + layout.paddingY;
    const frame = { l: x + g.mapLeft, r: x + g.mapLeft + g.mapWidth, t: y + g.mapTop, b: y + g.mapTop + g.mapHeight };
    const blocks = [
      { l: layout.margin, r: layout.margin + layout.rail, t: y, b: y + g.contentHeight },
      { l: x + layout.map + layout.gap, r: layout.width - layout.margin, t: y, b: y + g.contentHeight },
      { l: layout.margin, r: layout.width - layout.margin, t: 0, b: layout.header },
      { l: layout.margin, r: layout.width - layout.margin, t: y + g.contentHeight + layout.rowGap, b: layout.height - layout.paddingY },
    ];
    for (const box of blocks) {
      const horizontalGap = Math.max(box.l - frame.r, frame.l - box.r);
      const verticalGap = Math.max(box.t - frame.b, frame.t - box.b);
      expect(Math.max(horizontalGap, verticalGap)).toBeGreaterThanOrEqual(24);
    }
    expect(frame.l).toBeGreaterThanOrEqual(x + 24);
    expect(frame.r).toBeLessThanOrEqual(x + layout.map - 24);
    expect(frame.t).toBeGreaterThanOrEqual(y + MAP_HEADING_HEIGHT);
    expect(css).toMatch(/\.nexus-map-frame\s*\{[^}]*overflow:\s*hidden;/);
  });
  it("assigns every panel an explicit cell so auto-placement cannot push one off-stage", () => {
    expect(source.match(/col-start-\d row-start-\d/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).not.toMatch(/className="row-span-\d[^"]*"/);
    expect(css).toContain("grid-column: 1 / 4; grid-row: 2");
  });
  it("stacks the collection ring and the reminder rail in the same column", () => {
    expect(source).toContain("<CollectionDial"); expect(source).toContain("<DeliveryAlerts");
    expect(css).toContain("grid-template-rows: var(--collection-height) minmax(0,1fr)");
    expect(layout.collection).toBeGreaterThanOrEqual(300);
    expect(g.contentHeight - layout.collection - layout.rowGap).toBeGreaterThanOrEqual(224);
    expect(layout.collection + layout.rowGap + (g.contentHeight - layout.collection - layout.rowGap)).toBe(g.contentHeight);
  });
  it("keeps the milestone strip tall enough for its content", () => {
    expect(layout.feed).toBe(180);
    expect(layout.feed).toBeGreaterThanOrEqual(42 + 17 + 116);
  });
  it("has no third grid row left over from the old layout", () => {
    const rows = css.match(/\.nexus-grid\s*\{([^}]*)\}/)?.[1].match(/grid-template-rows:([^;]*)/)?.[1].trim();
    expect(rows).toBe("minmax(0,1fr) var(--feed-height)");
  });
  it("uses the profile at every stage geometry boundary", () => {
    expect(source).not.toMatch(/1920|1080/);
    expect(css.match(/\.screen-stage\s*\{([^}]*)\}/)?.[1]).toContain("width: var(--stage-width)");
    expect(css.match(/\.screen-frame\s*\{([^}]*)\}/)?.[1]).toContain("height: var(--stage-height)");
    expect(resolveScreenLayout(layout.id)).toBe(layout);
  });
});
it("defaults to native LED pixels and resolves URL before environment", () => {
  expect(resolveScreenLayout().id).toBe("led-1792x832");
  expect(resolveScreenLayout().fit).toBe(false);
  expect(resolveScreenLayout("4x3", "16x9").id).toBe("4x3");
  expect(resolveScreenLayout(undefined, "16x9").id).toBe("16x9");
});

it("expands automatically for a fabricated Xinjiang endpoint, retaining 12 percent margins and every endpoint inside the 0.68 mask ellipse", () => {
  const routes = [...snapshot.routes, { centerLng: 87.62, centerLat: 43.82 }]; // invented test-only coordinate
  const bounds = routeBounds(routes);
  for (const layout of Object.values(SCREEN_LAYOUTS)) {
    const original = layoutGeometry(layout, snapshot.routes), g = layoutGeometry(layout, routes);
    expect(g.west).toBeLessThan(original.west);
    expect(g.west).toBeLessThanOrEqual(bounds.west - (bounds.east - bounds.west) * .12);
    expect(g.east).toBeGreaterThanOrEqual(bounds.east + (bounds.east - bounds.west) * .12);
    expect(g.south).toBeLessThanOrEqual(bounds.south - (bounds.north - bounds.south) * .12);
    expect(g.north).toBeGreaterThanOrEqual(bounds.north + (bounds.north - bounds.south) * .12);
    for (const r of routes) {
      const p = projectLonLat(r.centerLng, r.centerLat), x = (p.x - g.viewportX) * g.scale, y = (p.y - g.viewportY) * g.scale;
      expect(ellipseRadius(x, y, g.mapWidth, g.mapHeight)).toBeLessThanOrEqual(.68);
    }
  }
});
