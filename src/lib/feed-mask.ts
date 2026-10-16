import type { PublicRouteSample } from "./voice/public-payload";
import { regionZone } from "./region-zone";
export function feedCity(route: PublicRouteSample, routes: readonly PublicRouteSample[]) {
  const region = `${regionZone(route.province)} · ${route.province}`;
  if (route.city === null) return region;
  const count = routes.filter(row => row.province === route.province && row.city === route.city).length;
  return count < 3 ? region : `${region} · ${route.city}`;
}
export function latestRoutes(routes: readonly PublicRouteSample[]) {
  return [...routes].sort((a, b) => b.shipmentDate.localeCompare(a.shipmentDate) || a.key.localeCompare(b.key)).slice(0, 5);
}
