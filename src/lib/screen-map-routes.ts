import { chinaMap, projectLonLat } from './geo';
import { latestRoutes } from './feed-mask';
import type { PublicRouteSample } from './voice/public-payload';

/** County-level city → the prefecture it belongs to. Same-city checks go through this table. */
export const COUNTY_TO_PREFECTURE: Readonly<Record<string, string>> = { 滕州: "枣庄" };
const PROVINCE_SHORTS = [...chinaMap.provinces.map(p => p.short)].sort((a, b) => b.length - a.length);

/** Drop 省/市 and a leading province name so 山东滕州 and 枣庄市 share one token. */
export function placeToken(raw: string) {
  let name = raw.replace(/[省市]/g, "");
  const prefix = PROVINCE_SHORTS.find(short => name.startsWith(short) && name.length > short.length);
  if (prefix) name = name.slice(prefix.length);
  return name;
}
/** Prefecture of a place name. A county listed in the table resolves to its prefecture; anything else is already prefecture-level. */
export function prefectureOf(raw: string) {
  const token = placeToken(raw);
  return COUNTY_TO_PREFECTURE[token] ?? token;
}
/** Origin prefecture is whichever table entry appears in the factory name. */
export function originPrefecture(factoryName = chinaMap.factory.name) {
  const county = Object.keys(COUNTY_TO_PREFECTURE).find(name => factoryName.includes(name));
  return county ? COUNTY_TO_PREFECTURE[county] : prefectureOf(factoryName);
}
export function isLocalCity(city: string | null, factoryName = chinaMap.factory.name) {
  return city !== null && prefectureOf(city) === originPrefecture(factoryName);
}

/** Line width by destination unit total: the first tier whose minimum is met wins. */
export const ROUTE_WIDTH_TIERS = [
  { minUnits: 5, width: 2.5 },
  { minUnits: 2, width: 2 },
  { minUnits: 0, width: 1.5 },
] as const;
export const PULSE_RIPPLE_CITIES = 5;

export type RouteGroup = {
  key: string; province: string; city: string | null; centerLng: number; centerLat: number;
  units: number; shipments: number; routeKeys: string[]; width: number;
  /** 0 = nearest to the factory, 1 = farthest. */
  order: number; pulseRipple: boolean; latestKey: string;
};
export const routeGroupKey = (route: Pick<PublicRouteSample, 'province' | 'city'>) => `${route.province}|${route.city ?? ''}`;
export const routeWidth = (units: number) => ROUTE_WIDTH_TIERS.find(t => units >= t.minUnits)!.width;

export function localShipments(routes: readonly PublicRouteSample[]) {
  return routes.filter(route => isLocalCity(route.city));
}
export function localUnitCount(routes: readonly PublicRouteSample[]) {
  return localShipments(routes).reduce((sum, route) => sum + route.unitCount, 0);
}
/** Carousel rows stay per shipment. A local shipment highlights the origin, never a line. */
export function linkTarget(groups: readonly { key: string; routeKeys: readonly string[] }[], localKeys: readonly string[], routeKey: string): "origin" | string | null {
  if (localKeys.includes(routeKey)) return "origin";
  return groupForRoute(groups, routeKey)?.key ?? null;
}
export function groupRoutes(routes: readonly PublicRouteSample[]): RouteGroup[] {
  const groups = new Map<string, PublicRouteSample[]>();
  for (const route of routes) {
    if (isLocalCity(route.city)) continue;
    groups.set(routeGroupKey(route), [...(groups.get(routeGroupKey(route)) ?? []), route]);
  }
  const factory = projectLonLat(chinaMap.factory.lon, chinaMap.factory.lat);
  const merged = [...groups].map(([key, rows]) => {
    const units = rows.reduce((sum, r) => sum + r.unitCount, 0), end = projectLonLat(rows[0].centerLng, rows[0].centerLat);
    return { key, province: rows[0].province, city: rows[0].city, centerLng: rows[0].centerLng, centerLat: rows[0].centerLat,
      units, shipments: rows.length, routeKeys: rows.map(r => r.key), width: routeWidth(units), latestKey: latestRoutes(rows)[0].key,
      distance: Math.hypot(end.x - factory.x, end.y - factory.y) };
  });
  const byDistance = [...merged].sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key)).map(g => g.key);
  const ripple = new Set([...merged].sort((a, b) => b.units - a.units || b.shipments - a.shipments || a.key.localeCompare(b.key)).slice(0, PULSE_RIPPLE_CITIES).map(g => g.key));
  return merged.map(({ distance: _distance, ...g }) => ({ ...g, order: merged.length > 1 ? byDistance.indexOf(g.key) / (merged.length - 1) : 0, pulseRipple: ripple.has(g.key) }));
}
/** Feed rows stay per shipment; each shipment resolves to exactly one merged line. */
export function groupForRoute<T extends { routeKeys: readonly string[] }>(groups: readonly T[], routeKey: string) {
  return groups.find(g => g.routeKeys.includes(routeKey)) ?? null;
}
