"use client";

import type { RefObject } from "react";
import type { AnswerCardData } from "@/lib/voice/session-machine";

/**
 * 客户/发货卡(plan §7「客户/发货卡」,ReminderRail / DeliveryMilestones 数据面)。
 *
 * 数据红线:rows/summaryText 由 card-builders.buildCustomersShipmentsCard
 * 从 delivery.milestones + reminders 构造,组件零计算。
 * 迷你紧凑列表:设备型号 + 合同号 + 状态徽标 + 日期。
 */
export function CustomersShipmentsCard({
  card,
  spokenRef,
}: {
  card: AnswerCardData & { kind: "customers-shipments" };
  spokenRef: RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div className="overlay-card-body">
      <p className="overlay-card-title">{card.title}</p>
      <p className="overlay-card-subtitle">{card.summaryText}</p>

      <div className="overlay-card-rows" role="table" aria-label={card.title}>
        {card.rows.map((row, index) => (
          <div className="overlay-card-row" role="row" key={`${row.equipmentText}-${index}`}>
            <span className="overlay-card-row-main">
              <strong>{row.equipmentText}</strong>
              <small>{row.detailText}</small>
            </span>
            <span className="overlay-card-row-tail">
              <i className="overlay-card-chip">{row.statusText}</i>
              <em>{row.dateLabel}</em>
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
