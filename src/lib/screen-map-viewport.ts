import { chinaMap, projectLonLat } from './geo';
export const MAP_ROUTE_MARGIN = .12;
export const MAP_MIN_LONGITUDE = 18;
export const MAP_MIN_LATITUDE = 14;
export const MAP_DEPTH = 18;
/** Elliptical mask: fully opaque to this normalized radius, then a smooth fade to 0 at 1.0. */
export const MAP_MASK_SOLID = .72;
/** Every route endpoint stays inside this normalized radius of the mask ellipse. */
export const MAP_ENDPOINT_RADIUS = .68;
export type RouteEndpoint = { centerLng: number; centerLat: number };
/** Every route starts at the factory. Bounds use endpoints only, never a fixed region. */
export function routeBounds(routes: readonly RouteEndpoint[]) {
  const points = [{ centerLng: chinaMap.factory.lon, centerLat: chinaMap.factory.lat }, ...routes];
  const west = Math.min(...points.map(p => p.centerLng)), east = Math.max(...points.map(p => p.centerLng));
  const south = Math.min(...points.map(p => p.centerLat)), north = Math.max(...points.map(p => p.centerLat));
  const longitude = Math.max(MAP_MIN_LONGITUDE, (east - west) * (1 + 2 * MAP_ROUTE_MARGIN));
  const latitude = Math.max(MAP_MIN_LATITUDE, (north - south) * (1 + 2 * MAP_ROUTE_MARGIN));
  return { west, east, south, north, longitude, latitude, centerLng: (west + east) / 2, centerLat: (south + north) / 2 };
}
/** Normalized radius of a frame-local point; the ellipse radii are half the frame width and height. */
export const ellipseRadius = (x: number, y: number, width: number, height: number) =>
  Math.hypot((x - width / 2) / (width / 2), (y - height / 2) / (height / 2));
/** The map fills the available width; the scale is the largest one that keeps every endpoint
 * within MAP_ENDPOINT_RADIUS of the mask ellipse (frame = surface + extrusion depth). */
export function routeViewport(routes: readonly RouteEndpoint[], availableWidth: number, availableHeight: number, depth = MAP_DEPTH) {
  const bounds = routeBounds(routes), pitch = chinaMap.pitch;
  const pixelWidth = Math.floor(availableWidth), pixelHeight = Math.floor(availableHeight);
  const center = projectLonLat(bounds.centerLng, bounds.centerLat);
  const offsets = [{ centerLng: chinaMap.factory.lon, centerLat: chinaMap.factory.lat }, ...routes].map(r => {
    const p = projectLonLat(r.centerLng, r.centerLat); return { dx: p.x - center.x, dy: p.y - center.y };
  });
  // A tiny reserve absorbs floating-point residue when the geometry is recomputed elsewhere.
  const fits = (s: number) => offsets.every(p => ellipseRadius(pixelWidth / 2 + p.dx * s, pixelHeight / 2 + p.dy * s, pixelWidth, pixelHeight + depth) <= MAP_ENDPOINT_RADIUS - 1e-6);
  let scale = Math.min(pixelWidth / (bounds.longitude * pitch), pixelHeight / (bounds.latitude * pitch));
  if (!fits(scale)) {
    let lo = 0, hi = scale;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    scale = lo;
  }
  const viewportWidth = pixelWidth / scale, viewportHeight = pixelHeight / scale;
  const longitude = viewportWidth / pitch, latitude = viewportHeight / pitch;
  return { scale, pixelWidth, pixelHeight, viewportX: center.x - viewportWidth / 2, viewportY: center.y - viewportHeight / 2,
    viewportWidth, viewportHeight, longitude, latitude,
    west: bounds.centerLng - longitude / 2, east: bounds.centerLng + longitude / 2,
    south: bounds.centerLat - latitude / 2, north: bounds.centerLat + latitude / 2 };
}
