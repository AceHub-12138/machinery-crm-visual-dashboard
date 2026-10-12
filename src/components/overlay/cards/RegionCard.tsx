"use client";
import {ReadableSvgNote} from "../ReadableSvgNote";
import { ClipText } from "@/components/screen/ClipText";
import type { AnswerCardData } from "@/lib/voice/session-machine";
import { chinaMap, provinceShortName, createScreenArc, mapBBox, projectLonLat } from "@/lib/geo";
import { cardExcerpt } from "@/lib/voice/card-presentation";
/** Same map and projection as ShipmentMap; no separate map dependency. */
export function RegionCard({card}: {card: Extract<AnswerCardData, {kind: "region"}>}) {
  const points = card.mapPoints?.map(p => ({...projectLonLat(p.lng, p.lat), region: p.region})) ?? [];
  const viewBox = `${mapBBox.minX - 20} ${mapBBox.minY - 20} ${mapBBox.width + 40} ${mapBBox.height + 40}`;
  return <div className="overlay-region-block">
    <div className="overlay-region-ranking" role="table" aria-label="区域发运排行">
      <div className="overlay-region-head"><span>排名 / 省份</span><span>发运量 · 占比</span></div>
      {card.rows.slice(0, 5).map((row, i) => <div className="overlay-region-row" role="row" key={row.region}>
        <i className="overlay-rank">{i + 1}</i><span className="overlay-region-name" title={row.region}><ClipText full={row.region}>{cardExcerpt(provinceShortName(row.region), 6)}</ClipText></span>
        <span className="overlay-card-row-mini" aria-hidden="true"><i style={{width: `${(card.rows[0]?.units ? Math.min(100, row.units / card.rows[0].units * 100) : 0)}%`}} /></span>
        <span className="overlay-region-value"><strong>{row.units}</strong> 台 / {row.shipments} 单</span><em>{row.sharePercent.toFixed(1)}%</em>
      </div>)}
      <p className="overlay-region-other">
        {card.other && card.other.regions > 0 ? `其他 ${card.other.regions} 省 · ${card.other.units} 台` : ""}
        {card.unresolved && card.unresolved.shipments > 0 ? `　地区待确认 · ${card.unresolved.units} 台 / ${card.unresolved.shipments} 单` : ""}
      </p>
      {card.rows.length === 0 ? <p className="overlay-empty">暂无发运记录</p> : null}
    </div>
    <svg className="overlay-region-map" viewBox={viewBox} role="img" aria-label={`发运地图，共 ${points.length} 个落点`}>
      <ReadableSvgNote>仅标注部分地点</ReadableSvgNote>
      {chinaMap.provinces.map(p => <path key={p.adcode} d={p.d} className="overlay-map-province" />)}
      {points.map((point, i) => <g key={`${point.region}-${i}`}><path d={createScreenArc(chinaMap.factory, point).d} className="overlay-map-route" /><circle cx={point.x} cy={point.y} r="8" className="overlay-map-point"><title>{point.region}</title></circle></g>)}
      <circle cx={chinaMap.factory.x} cy={chinaMap.factory.y} r="12" className="overlay-map-factory"><title>工厂</title></circle>
    </svg>
  </div>;
}
