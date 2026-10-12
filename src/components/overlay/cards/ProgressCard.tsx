"use client";
import { FitText } from "@/components/screen/FitText";
import { formatMoneyParts } from "@/lib/format";
import { displayRate } from "@/lib/voice/card-presentation";
import type { RefObject } from "react";
import type { AnswerCardData } from "@/lib/voice/session-machine";

export function splitAmount(text: string): { currency: string; number: string; unit: string } {
  return formatMoneyParts(text);
}
export function ProgressCard({card, barFillRef}: {card: Extract<AnswerCardData, {kind: "target-progress"}>; barFillRef: RefObject<HTMLSpanElement | null>}) {
  const amount = splitAmount(card.actualText);
  const exceeded = card.remainingText.startsWith("已超额");
  return <div className="overlay-progress-block">
    <div className="overlay-card-amount">
      <p className="overlay-card-amount-main num-unit"><FitText text={card.actualText} min={40} max="var(--ov-fs-amount)"><span className="overlay-card-amount-currency">{amount.currency}</span><span className="overlay-card-amount-number">{amount.number}</span><span className="overlay-card-amount-unit">{amount.unit}</span></FitText></p>
      <p className="overlay-card-rate">完成率<strong>{displayRate(card.completionRate)}</strong></p>
    </div>
    <div className="overlay-card-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, card.completionRate))}><span className="overlay-card-bar-fill" ref={barFillRef} /></div>
    <div className="overlay-progress-meta"><p>月度目标 <em className="num-unit">{card.targetText}</em></p><p>{exceeded ? "已超额" : "距目标还差"} <em className="num-unit">{card.remainingText.replace(/^已超额\s*/, "")}</em></p></div>
  </div>;
}
