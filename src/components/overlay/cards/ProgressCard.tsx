"use client";

import type { RefObject } from "react";
import type { AnswerCardData } from "@/lib/voice/session-machine";

/**
 * 目标进度卡(plan §7 模板库首个精做)。
 *
 * 数据红线:字段一律是工具返回口径的格式化字符串(8a 由 target.ts 推导,
 * 8b 起 MCP 同源),组件不做任何再计算。大额黑体数字 + 2D 铜色进度条 +
 * 距目标差额;宽度/进度目标值由 AnswerCard 编排层经 ref 写入。
 */

/** 拆 formatMoney 产物(如 "¥1,286.0万")为 货币符/数字/单位 三段。 */
export function splitAmount(text: string): { currency: string; number: string; unit: string } {
  const match = /^(¥)?\s*([\d,.]+)\s*(万|亿)?$/u.exec(text.trim());
  if (!match) return { currency: "", number: text, unit: "" };
  return { currency: match[1] ?? "", number: match[2], unit: match[3] ?? "" };
}

export function ProgressCard({
  card,
  spokenRef,
  barFillRef,
}: {
  card: AnswerCardData & { kind: "target-progress" };
  /** 打字机正文(span.textContent 由编排层逐帧写) */
  spokenRef: RefObject<HTMLSpanElement | null>;
  /** 进度条填充(目标宽度由编排层在展开完成时写入一次) */
  barFillRef: RefObject<HTMLSpanElement | null>;
}) {
  const amount = splitAmount(card.actualText);
  const rate = Math.min(100, Math.max(0, card.completionRate));

  return (
    <div className="overlay-card-body">
      <p className="overlay-card-title">{card.title}</p>

      <div className="overlay-card-amount">
        <p className="overlay-card-amount-main">
          <span className="overlay-card-amount-currency">{amount.currency}</span>
          <span className="overlay-card-amount-number">{amount.number}</span>
          <span className="overlay-card-amount-unit">{amount.unit}</span>
        </p>
        <p className="overlay-card-rate">
          完成率
          <strong>{card.completionRate.toFixed(1)}%</strong>
        </p>
      </div>

      <div
        className="overlay-card-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rate}
      >
        <span className="overlay-card-bar-fill" ref={barFillRef} />
      </div>

      <p className="overlay-card-meta">
        <span>
          月度目标 <em>{card.targetText}</em>
        </span>
        <span>
          距目标还差 <em>{card.remainingText}</em>
        </span>
      </p>

      <p className="overlay-card-spoken">
        <span ref={spokenRef} />
      </p>
    </div>
  );
}
