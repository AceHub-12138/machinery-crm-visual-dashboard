import { MAP_DEPTH, routeViewport, type RouteEndpoint } from "./screen-map-viewport";

export const MAP_PANEL_CLEARANCE = 24;
export const MAP_HEADING_HEIGHT = 96;

export const SCREEN_LAYOUTS = {
  "led-1792x832": { id: "led-1792x832", width: 1792, height: 832, margin: 28, header: 64, rail: 470, gap: 58, map: 680, feed: 180, rowGap: 16, paddingY: 16, collection: 300, fit: false },
  "16x9": { id: "16x9", width: 1920, height: 1080, margin: 28, header: 64, rail: 470, gap: 58, map: 808, feed: 180, rowGap: 16, paddingY: 16, collection: 441, fit: true },
  "4x3": { id: "4x3", width: 1600, height: 1200, margin: 28, header: 64, rail: 410, gap: 32, map: 660, feed: 180, rowGap: 16, paddingY: 16, collection: 441, fit: true },
} as const;
export type ScreenLayoutId = keyof typeof SCREEN_LAYOUTS;
export type ScreenLayout = (typeof SCREEN_LAYOUTS)[ScreenLayoutId];
export function resolveScreenLayout(url?: string, environment?: string): ScreenLayout {
  const key = url ?? environment;
  return SCREEN_LAYOUTS[key as ScreenLayoutId] ?? SCREEN_LAYOUTS["led-1792x832"];
}
export function layoutGeometry(layout: ScreenLayout, routes: readonly RouteEndpoint[] = []) {
  const contentHeight = layout.height - layout.header - layout.feed - layout.paddingY * 2 - layout.rowGap;
  const mapBottom = contentHeight - MAP_PANEL_CLEARANCE;
  const viewport = routeViewport(routes, layout.map - 2 * MAP_PANEL_CLEARANCE - 2,
    mapBottom - MAP_HEADING_HEIGHT - MAP_DEPTH - 2, MAP_DEPTH);
  const width = viewport.pixelWidth;
  const surfaceHeight = viewport.pixelHeight;
  const height = surfaceHeight + MAP_DEPTH;
  const top = mapBottom - height;
  // Keep the approved bottom glow anchored independently of the larger route viewport.
  const glowBottom = layout.height * .67 - layout.header - layout.paddingY;
  return { contentHeight, ...viewport, mapLeft: (layout.map - width) / 2, mapTop: top,
    mapWidth: width, mapHeight: height, mapSurfaceHeight: surfaceHeight, mapBottom, glowBottom,
    landCenter: top + surfaceHeight / 2 };
}
