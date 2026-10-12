"use client";
import type { AnswerCardData } from "@/lib/voice/session-machine";
import { MetricRing } from "./CardMetrics";
export function CompletionRingCard({card}: {card: Extract<AnswerCardData, {kind: "completion-ring"}>}) {
  if (card.targetAvailable === false || card.targetConfigured === false) return <div className="overlay-ring-block"><p>{card.targetConfigured ? "目标为 0" : "目标未设置"}</p><p>本期合同额 {card.collectedText}</p></div>;
  const exceeded = card.remainingText.startsWith("已超额");
  return <div className="overlay-ring-block"><MetricRing rate={card.ratePercent} label="目标完成率" />
    <div className="overlay-ring-meta">
      {[["已完成", card.collectedText, "M5 17V9h3v8 M11 17V5h3v12 M17 17v-6h3v6"], ["月度目标", card.targetText, "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8"], [exceeded ? "已超额" : "距目标还差", card.remainingText.replace(/^已超额\s*/, ""), "M4 5h16v14H4z M8 9h8 M8 13h8"]].map(([label, value, icon]) => <div key={label}><i aria-hidden="true"><svg viewBox="0 0 24 24"><path d={icon} /></svg></i><p><span>{label}</span><strong>{value}</strong></p></div>)}
    </div>
  </div>;
}
