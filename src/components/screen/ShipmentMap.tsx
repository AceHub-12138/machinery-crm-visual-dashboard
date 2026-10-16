"use client";
import { useId, useState } from "react";
import { chinaMap, chinaSilhouette, createScreenArc, projectLonLat } from "@/lib/geo";
import { layoutGeometry, resolveScreenLayout, type ScreenLayout } from "@/lib/screen-layout";
import { placeCityLabels } from "@/lib/screen-map-labels";
import { placeProvinceLabels } from "@/lib/screen-map-provinces";
import { MAP_ENDPOINT_RADIUS, MAP_MASK_SOLID } from "@/lib/screen-map-viewport";
import { groupRoutes, localShipments, localUnitCount } from "@/lib/screen-map-routes";
import { formatCount } from "@/lib/format";
import type { PublicScreenPayload } from "@/lib/public-screen-payload";
import rawBoundary from "@/data/china-raw.json";
import { NexusTitle } from "./NexusPanels";

// Same DataV boundary, including its southern polygons. Inset keeps its full geographic window.
const islandPaths = rawBoundary.features.flatMap(f => f.geometry.coordinates.map(polygon => polygon.map(ring => ring.map((p, i) => `${i ? "L" : "M"}${p[0]},${56 - p[1]}`).join(" ") + " Z").join(" ")));
export function ShipmentMap({ payload, layout = resolveScreenLayout(), activeKey, onSelect }: {
  payload: PublicScreenPayload; layout?: ScreenLayout; activeKey?: string | null; onSelect?: (key: string) => void;
}) {
  const gradientId = useId();
  const [localActive, setLocalActive] = useState<string | null>(null);
  const routes = payload.business?.delivery.routes ?? [];
  const key = activeKey === undefined ? localActive : activeKey;
  const select = onSelect ?? setLocalActive;
  const g = layoutGeometry(layout, routes);
  const groups = groupRoutes(routes);
  const local = localShipments(routes);
  const localUnits = localUnitCount(routes);
  const factory = projectLonLat(chinaMap.factory.lon, chinaMap.factory.lat);
  const toPixel = (x: number, y: number) => ({ x: g.mapLeft + (x - g.viewportX) * g.scale, y: g.mapTop + (y - g.viewportY) * g.scale });
  const origin = toPixel(factory.x, factory.y);
  const candidates = Array.from(new Map(routes.filter(r => r.city !== null && !local.includes(r)).map(r => [r.province + r.city, r])).values()).map(r => {
    const point = projectLonLat(r.centerLng, r.centerLat);
    return { text: r.city!, ...toPixel(point.x, point.y) };
  });
  // Both fixed labels start beyond the maximum 44px breath and the route origin.
  // Reserve them before placing cities/provinces so Tengzhou always has priority.
  const factoryLabel = { x: origin.x + 52, y: origin.y - 16 };
  const factoryBox = { l: factoryLabel.x - 4, r: factoryLabel.x + 4 * 24 + 4, t: factoryLabel.y, b: factoryLabel.y + 32 };
  const localText = `本地 ${localUnits} 台`;
  const localWidth = localText.length * 13;
  const localLabel = localUnits > 0 ? { x: factoryLabel.x, y: factoryLabel.y + 34, box: { l: factoryLabel.x - 4, r: factoryLabel.x + localWidth + 4, t: factoryLabel.y + 33, b: factoryLabel.y + 53 } } : null;
  const reserved = [factoryBox, ...(localLabel ? [localLabel.box] : []), { l: layout.map - 120, r: layout.map, t: g.contentHeight - 126, b: g.contentHeight }];
  const labels = placeCityLabels(candidates, { l: g.mapLeft, r: g.mapLeft + g.mapWidth, t: g.mapTop, b: g.mapBottom }, reserved);
  const provinces = placeProvinceLabels({ l: g.viewportX, r: g.viewportX + g.viewportWidth,
    t: g.viewportY, b: g.viewportY + g.viewportHeight }, toPixel,
    { l: g.mapLeft, r: g.mapLeft + g.mapWidth, t: g.mapTop, b: g.mapBottom }, [...reserved, ...labels.map(label => label.box)]);
  const summary = payload.business?.delivery.summary;
  const unresolved = payload.business?.delivery.unresolvedRegionTotals;
  // One halo per merged destination keeps dense clusters from stacking into a blob.
  const halos = Array.from(new Map(groups.map(r => { const p = projectLonLat(r.centerLng, r.centerLat); return [`${p.x.toFixed(1)},${p.y.toFixed(1)}`, p]; })).values());
  const ids = { surface: gradientId, pool: `${gradientId}-pool`, core: `${gradientId}-core`, ring: `${gradientId}-ring` };
  return <section className="nexus-map">
    <div className="nexus-map-heading"><NexusTitle>业务覆盖</NexusTitle><p>覆盖 <strong>{formatCount(summary?.regionCount ?? 0)}</strong> 个省 <span>｜</span> 本期 <strong>{formatCount(summary?.unitCount ?? 0)}</strong> 台</p></div>
    <div className="nexus-map-reflection" aria-hidden="true" />
    <div className="nexus-map-frame" data-map-frame="true" data-viewport-west={g.west} data-viewport-east={g.east} data-viewport-south={g.south} data-viewport-north={g.north} data-mask="ellipse" data-mask-solid={MAP_MASK_SOLID} data-endpoint-radius={MAP_ENDPOINT_RADIUS}>{[2, 1, 0].map(layer => <svg key={layer} className={`map-svg nexus-map-layer nexus-map-layer-${layer}`} data-map-layer={layer} viewBox={`${g.viewportX} ${g.viewportY} ${g.viewportWidth} ${g.viewportHeight}`} aria-hidden="true" style={{ transform: `translateY(${layer * 9}px)` }}>
      {layer === 0 ? <defs>
        <linearGradient id={ids.surface} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3A4048"/><stop offset="100%" stopColor="#2A2F36"/></linearGradient>
        <radialGradient id={ids.pool} gradientUnits="userSpaceOnUse" cx={factory.x} cy={factory.y} r="460"><stop offset="0%" stopColor="#ee7d2c" stopOpacity=".2"/><stop offset="45%" stopColor="#ee7d2c" stopOpacity=".07"/><stop offset="100%" stopColor="#ee7d2c" stopOpacity="0"/></radialGradient>
        <radialGradient id={ids.core}><stop offset="0%" stopColor="#ffb36b" stopOpacity=".7"/><stop offset="40%" stopColor="#ee7d2c" stopOpacity=".28"/><stop offset="100%" stopColor="#ee7d2c" stopOpacity="0"/></radialGradient>
        <radialGradient id={ids.ring}><stop offset="70%" stopColor="#FFB070" stopOpacity="0"/><stop offset="86%" stopColor="#FFB070" stopOpacity=".18"/><stop offset="93%" stopColor="#FFB070" stopOpacity="1"/><stop offset="100%" stopColor="#EE7D2C" stopOpacity="0"/></radialGradient>
      </defs> : null}
      <g className={layer === 0 ? "nexus-map-surface" : undefined} fill={layer === 0 ? `url(#${ids.surface})` : "#1A1D22"} stroke={layer === 0 ? "#EE7D2C" : "rgba(238,125,44,.35)"} strokeOpacity={layer === 0 ? .18 : 1} strokeWidth={layer === 0 ? 1 : 2.5}>{chinaMap.provinces.map(p => <path key={p.adcode} d={p.d}/>)}</g>
      {layer === 0 ? <path d={chinaSilhouette} fill={`url(#${ids.pool})`} stroke="none"/> : null}
      {layer === 0 ? <path d={chinaSilhouette} fill="none" stroke="#cfe0ee" strokeOpacity=".28" strokeWidth="5"/> : null}
      <path d={chinaSilhouette} fill="none" stroke={layer === 0 ? "#c4d6e4" : "#506072"} strokeWidth="2"/>
      {layer === 0 ? <g className="nexus-pulse-provinces" fill="none" stroke="#EE7D2C" strokeWidth="1">{chinaMap.provinces.filter(p => [370000, 320000, 330000].includes(Number(p.adcode))).map(p => <path key={p.adcode} d={p.d} vectorEffect="non-scaling-stroke"/>)}</g> : null}
      {layer === 0 ? <path className="nexus-pulse-rise" d={`M${factory.x} ${factory.y + 220} Q${factory.x - 70} ${factory.y + 90} ${factory.x} ${factory.y}`} fill="none" stroke="#FFB36B" strokeWidth="2" opacity="0" vectorEffect="non-scaling-stroke"/> : null}
      {layer === 0 ? <path className="nexus-pulse-map" d={chinaSilhouette} fill="#ffffff" stroke="none"/> : null}
      {layer === 0 ? <g fill="#ee7d2c" stroke="none">{halos.map(p => <circle key={`${p.x},${p.y}`} cx={p.x} cy={p.y} r="9" fillOpacity=".14"/>)}</g> : null}
      {layer === 0 ? <g fill="none" stroke="#ee7d2c">{groups.map(r => {
        const end = projectLonLat(r.centerLng, r.centerLat), arc = createScreenArc(factory, end).d;
        return <g key={r.key} data-city-key={r.key} data-route-keys={r.routeKeys.join(" ")} data-route-units={r.units} data-route-width={r.width} data-route-order={r.order} data-pulse-ripple={r.pulseRipple} data-route-bright={false}><path d={arc} data-route-baseline="true" stroke="#EE7D2C" strokeOpacity="0.4" strokeWidth={r.width} vectorEffect="non-scaling-stroke"/><path className="nexus-route-light" d={arc} stroke="#ffb36b" strokeWidth={r.width} vectorEffect="non-scaling-stroke" opacity="0"/><image className="nexus-route-tail" href="/brand/motion/trail.svg" width={60 / g.scale} height={16 / g.scale} opacity="0"/><circle className="nexus-route-glow" cx={factory.x} cy={factory.y} r={8 / g.scale} fill={`url(#${ids.core})`} stroke="none" opacity="0"/><circle className="nexus-route-traveler" cx={factory.x} cy={factory.y} r={3 / g.scale} fill="#FFB070" stroke="none" opacity="0"/><circle className="nexus-city-ripple" cx={end.x} cy={end.y} r={24 / g.scale} fill={`url(#${ids.ring})`} stroke="none" opacity="0"/><circle className="nexus-city-active" cx={end.x} cy={end.y} r={8 / g.scale} fill={`url(#${ids.core})`} stroke="none" opacity="0"/><circle className="nexus-city-dot" cx={end.x} cy={end.y} data-normal-radius={3.6 / g.scale} r={3.6 / g.scale} fill="#ee7d2c" stroke="none"/></g>;
      })}<circle className="nexus-factory-glow" cx={factory.x} cy={factory.y} r="64" fill={`url(#${ids.core})`} stroke="none"/><circle className="nexus-origin-breath" cx={factory.x} cy={factory.y} r={28 / g.scale} fill={`url(#${ids.ring})`} stroke="none" opacity=".35" data-local-route-keys={local.map(r => r.key).join(" ")} data-origin-focus="false"/><circle cx={factory.x} cy={factory.y} r="23" strokeWidth="2"/><circle cx={factory.x} cy={factory.y} r="12" fill="#ee7d2c"/><circle cx={factory.x} cy={factory.y} r="5" fill="#fff3df"/></g> : null}
    </svg>)}</div>
    <div className="nexus-map-labels">{provinces.map(p => <span key={p.adcode} className="nexus-province-label" data-province-code={p.adcode} data-visible-fraction={p.visible} style={{ left: p.x, top: p.y }}>{p.text}</span>)}{labels.map((label, i) => <span key={i} data-map-label={label.text} data-label-side={label.side} className="nexus-city-label" style={{ left: label.x, top: label.y }}>{label.text}</span>)}<strong className="nexus-factory-label" style={{ left: factoryLabel.x, top: factoryLabel.y }}>山东滕州</strong>{localLabel ? <span className="nexus-local-units" data-local-units={localUnits} style={{ left: localLabel.x, top: localLabel.y }}>{localText}</span> : null}</div>
    <div className="nexus-map-hitpoints">{groups.map(r => { const pos = projectLonLat(r.centerLng, r.centerLat); const at = toPixel(pos.x, pos.y); return <button key={r.key} type="button" className="nexus-map-hitpoint" style={{ left: at.x - 13, top: at.y - 13 }} data-city-key={r.key} data-route-keys={r.routeKeys.join(" ")} aria-label={`${r.city ?? r.province} ${formatCount(r.units)} 台`} aria-pressed={key !== null && r.routeKeys.includes(key)} onClick={() => select(r.latestKey)} onFocus={() => select(r.latestKey)}/>; })}</div>
    <aside className="nexus-islands nexus-minimap"><svg viewBox="72 0 65 56" aria-label="全国地图（含台湾及南海诸岛）" className="nexus-islands-svg" fill="#2A2E35" stroke="#adc2d2" strokeWidth=".18">{islandPaths.map((d, i) => <path d={d} key={i} data-national-polygon={i}/>)}<path data-minimap-taiwan="true" d={chinaMap.provinces.find(p => p.short === "台湾")!.d} transform={`translate(${chinaMap.lonLat.lon.min} ${56 - chinaMap.lonLat.lat.max}) scale(${1 / chinaMap.pitch})`}/><rect data-minimap-viewport="true" x={g.west} y={56 - g.north} width={g.east - g.west} height={g.north - g.south} fill="none" stroke="#EE7D2C" strokeWidth=".5"/></svg><p>南海诸岛</p></aside>
    {unresolved && (unresolved.unitCount !== 0 || unresolved.shipmentCount !== 0) ? <p className="nexus-unresolved">地区待确认 {formatCount(unresolved.unitCount)} 台 · {formatCount(unresolved.shipmentCount)} 单</p> : null}
  </section>;
}
