"use client";
import type { AnswerCardData } from "@/lib/voice/session-machine";
import { MetricRing } from "./CardMetrics";
export function CompletionRingCard({card}: {card: Extract<AnswerCardData, {kind: "completion-ring"}>}) {
  if (card.targetAvailable === false || card.targetConfigured === false) return <div className="overlay-ring-block"><p>{card.targetConfigured ? "目标为 0" : "目标未设置"}</p><p>本期合同额 {card.collectedText}</p></div>;
  const exceeded = card.remainingText.startsWith("已超额");
  return <div className="overlay-ring-block"><MetricRing rate={card.ratePercent} label="目标完成率" />
    <div className="overlay-ring-meta">
      {[["已完成", card.collectedText, "▥"], ["月度目标", card.targetText, "◎"], [exceeded ? "已超额" : "距目标还差", card.remainingText.replace(/^已超额\s*/, ""), "▤"]].map(([label, value, icon]) => <div key={label}><i aria-hidden="true">{icon}</i><p><span>{label}</span><strong>{value}</strong></p></div>)}
    </div>
  </div>;
}
