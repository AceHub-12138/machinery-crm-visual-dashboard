/** Presentation-only mappings. Questions must stay inside the supported intent set. */
import type { AnswerCardData } from "./session-machine.ts";
import { VOICE_COVERAGE_FALLBACK } from "./card-builders.ts";

/** Visible excerpt only; callers retain the original in title/accessible labels. */
export function cardExcerpt(text: string, maxChars: number): string {
  const chars = Array.from(text);
  return chars.length > maxChars ? chars.slice(0, maxChars - 1).join("") + "…" : text;
}

export const CARD_FOLLOWUPS = {
  "target-progress": ["目标完成率是多少？", "回款情况怎么样？"],
  "completion-ring": ["本月销售情况怎么样？", "回款情况怎么样？"],
  region: ["近期有哪些发货安排？", "本月销售情况怎么样？"],
  "customers-shipments": ["各区域发货分布怎么样？", "今天有多少跟进待办？"],
  "customer-kpi": ["今天有多少跟进待办？", "本月销售情况怎么样？"],
  "followup-buckets": ["本月新增了多少客户？", "近期有哪些发货安排？"],
  "collection-split": ["本月目标完成率是多少？", "本月销售情况怎么样？"],
} as const;

export function cardFollowups(card: AnswerCardData): readonly string[] {
  if (card.kind === "brief") return card.spoken === VOICE_COVERAGE_FALLBACK
    ? ["本月销售情况", "回款情况", "发货安排"] : [];
  return CARD_FOLLOWUPS[card.kind];
}

type ShipmentRow = Extract<AnswerCardData, { kind: "customers-shipments" }>["rows"][number];
export type ShipmentPageRow = ShipmentRow | { otherCount: number };

/** At most three pages, five slots per page, including the overflow summary. */
export function shipmentPages(rows: ShipmentRow[], omittedCount = 0): ShipmentPageRow[][] {
  const excess = Math.max(0, rows.length - 15) + omittedCount;
  const visible: ShipmentPageRow[] = rows.slice(0, excess > 0 ? 14 : 15);
  if (excess > 0) visible.push({ otherCount: rows.length - Math.min(rows.length, 14) + omittedCount });
  if (visible.length === 0) return [[]];
  return Array.from({ length: Math.ceil(visible.length / 5) }, (_, i) => visible.slice(i * 5, i * 5 + 5));
}

/** Prefer a sentence boundary; after the last mapped sentence, use the 4s fallback. */
export function shipmentPageAt(elapsedMs: number, pageCount: number, sentenceIndex: number | null, sentenceCount: number): number {
  if (pageCount <= 1) return 0;
  if (sentenceIndex !== null) {
    const mapped = Math.min(pageCount - 1, sentenceIndex);
    if (pageCount <= sentenceCount || sentenceIndex < sentenceCount - 1) return mapped;
    return Math.min(pageCount - 1, mapped + Math.floor(Math.max(0, elapsedMs) / 4000));
  }
  return Math.floor(Math.max(0, elapsedMs) / 4000) % pageCount;
}

/** Keep numeric grouping commas and UTF-16 sentence offsets unchanged. */
export function displaySpoken(text: string): string {
  return text.replace(/(?<=[\u3400-\u9fff。！？]),|,(?=[\u3400-\u9fff])/gu, "，");
}
/** Builders interpolate the numeric rate directly into spoken text. */
export function displayRate(rate: number): string { return `${rate}%`; }
