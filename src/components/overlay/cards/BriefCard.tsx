"use client";

import type { RefObject } from "react";
import type { AnswerCardData } from "@/lib/voice/session-machine";

/**
 * 结论卡(tool.invoke 无数据模板时的兜底承载,8b)。
 *
 * 只呈现编排侧给出的播报要点(数字均来自注入口径),自身不承载任何
 * 独立的数据口径——覆盖缺口降级话术也由它展示。
 */
export function BriefCard({
  card,
  spokenRef,
}: {
  card: AnswerCardData & { kind: "brief" };
  spokenRef: RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div className="overlay-card-body">
      <p className="overlay-card-title">{card.title}</p>

      <div className="overlay-card-brief-lines">
        {card.lines.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </div>

      <p className="overlay-card-spoken">
        <span ref={spokenRef} />
      </p>
    </div>
  );
}
