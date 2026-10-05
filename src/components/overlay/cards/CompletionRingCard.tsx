"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { LAUNCH } from "@/lib/voice/params";
import type { AnswerCardData } from "@/lib/voice/session-machine";

/**
 * 完成率环卡(plan §7「完成率环卡」,TargetRing 语义 → overlay 铜色)。
 *
 * 数据红线:ratePercent/remainingText 等全部来自注入 payload 的构造器
 * (card-builders.buildCompletionRingCard),组件零计算。
 * 环填充沿用进度条的编排节奏:展开完成(typeStart)时把目标
 * stroke-dashoffset 写入,CSS transition 负责补间。
 */

const RING_RADIUS = 64;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function CompletionRingCard({
  card,
  spokenRef,
}: {
  card: AnswerCardData & { kind: "completion-ring" };
  /** 打字机正文(span.textContent 由编排层逐帧写) */
  spokenRef: RefObject<HTMLSpanElement | null>;
}) {
  const fillRef = useRef<SVGCircleElement | null>(null);
  const rate = Math.min(100, Math.max(0, card.ratePercent));

  /* 展开完成时写入目标偏移,与 AnswerCard 的进度条同拍 */
  useEffect(() => {
    const fill = fillRef.current;
    if (!fill) return;
    const typeStartMs = LAUNCH.unfoldStartMs + LAUNCH.unfoldMs;
    const timer = window.setTimeout(() => {
      fill.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - rate / 100));
    }, typeStartMs);
    return () => window.clearTimeout(timer);
  }, [rate]);

  return (
    <div className="overlay-card-body">
      <p className="overlay-card-title">{card.title}</p>

      <div className="overlay-ring-block">
        <div className="overlay-ring-wrap">
          <svg className="overlay-ring" viewBox="0 0 160 160" role="img" aria-label={`目标完成率 ${rate}%`}>
            <circle className="overlay-ring-track" cx="80" cy="80" r={RING_RADIUS} />
            <circle
              className="overlay-ring-fill"
              cx="80"
              cy="80"
              r={RING_RADIUS}
              ref={fillRef}
              style={{ strokeDasharray: RING_CIRCUMFERENCE, strokeDashoffset: RING_CIRCUMFERENCE }}
              transform="rotate(-90 80 80)"
            />
          </svg>
          <p className="overlay-ring-value">
            <strong>{card.ratePercent.toFixed(1)}%</strong>
          </p>
        </div>

        <div className="overlay-ring-meta">
          <p>
            已完成 <em>{card.collectedText}</em>
          </p>
          <p>
            目标 <em>{card.targetText}</em>
          </p>
          <p>
            距目标还差 <em>{card.remainingText}</em>
          </p>
        </div>
      </div>

      <p className="overlay-card-spoken">
        <span ref={spokenRef} />
      </p>
    </div>
  );
}
