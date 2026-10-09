"use client";
import { displayRate } from "@/lib/voice/card-presentation";
import type { RefObject } from "react";
import type { AnswerCardData } from "@/lib/voice/session-machine";

export function splitAmount(text: string): { currency: string; number: string; unit: string } {
  const match = /^(¥)?\s*([\d,.]+)\s*(万|亿)?$/u.exec(text.trim());
  if (!match) return { currency: "", number: text, unit: "" };
  return { currency: match[1] ?? "", number: match[2], unit: match[3] ?? "" };
}
export function ProgressCard({card, barFillRef}: {card: Extract<AnswerCardData, {kind: "target-progress"}>; barFillRef: RefObject<HTMLSpanElement | null>}) {
  const configured = card.targetConfigured ?? Number(card.targetText.replace(/[^0-9.]/g, "")) > 0;
  const available = card.targetAvailable ?? configured;
  const amount = splitAmount(card.actualText);
  const exceeded = card.remainingText.startsWith("已超额");
  return <div className="overlay-progress-block">
    <div className="overlay-card-amount">
      <p className="overlay-card-amount-main"><span className="overlay-card-amount-currency">{amount.currency}</span><span className="overlay-card-amount-number">{amount.number}</span><span className="overlay-card-amount-unit">{amount.unit}</span></p>
      {available ? <p className="overlay-card-rate">完成率<strong>{displayRate(card.completionRate)}</strong></p> : <p className="overlay-card-rate">{configured ? "目标为 0" : "目标未设置"}</p>}
    </div>
    {available ? <><div className="overlay-card-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, card.completionRate))}><span className="overlay-card-bar-fill" ref={barFillRef} /></div>
    <div className="overlay-progress-meta"><p>月度目标 <em>{card.targetText}</em></p><p>{exceeded ? "已超额" : "距目标还差"} <em>{card.remainingText.replace(/^已超额\s*/, "")}</em></p></div></> : null}
    {card.paidText ? <div className="overlay-progress-meta"><p>本期实际回款 <em>{card.paidText}</em></p><p>本期新合同欠款 <em>{card.newContractUnpaidText}</em></p></div> : null}
  </div>;
}
