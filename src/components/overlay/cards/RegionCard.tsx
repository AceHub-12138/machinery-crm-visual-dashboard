"use client";

import type { RefObject } from "react";
import type { AnswerCardData } from "@/lib/voice/session-machine";

/**
 * 区域对比卡(plan §7「区域对比卡」)。
 *
 * 数据红线:rows 由 card-builders.buildRegionCard 从 delivery.routes
 * 按省聚合,组件零计算。两列数值 + 迷你横向条(铜色,按占比宽)。
 */
export function RegionCard({
  card,
  spokenRef,
}: {
  card: AnswerCardData & { kind: "region" };
  spokenRef: RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div className="overlay-card-body">
      <p className="overlay-card-title">{card.title}</p>
      <p className="overlay-card-subtitle">{card.summaryText}</p>

      <div className="overlay-card-rows" role="table" aria-label={card.title}>
        {card.rows.map((row) => (
          <div className="overlay-card-row" role="row" key={row.region}>
            <span className="overlay-card-row-region">{row.region}</span>
            <span className="overlay-card-row-mini" aria-hidden="true">
              <i style={{ width: `${Math.min(100, row.sharePercent)}%` }} />
            </span>
            <span className="overlay-card-row-value">
              <strong>{row.units}</strong> 台 / {row.shipments} 单
              <em className="overlay-card-row-share">{row.sharePercent.toFixed(1)}%</em>
            </span>
          </div>
        ))}
      </div>

      <p className="overlay-card-spoken">
        <span ref={spokenRef} />
      </p>
    </div>
  );
}
