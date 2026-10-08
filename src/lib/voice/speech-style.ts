import type { Intent } from "./intents.ts";
import type { PublicSalesScreenPayload } from "./public-payload.ts";
export const SPEECH_STYLES = ["default", "cheerful", "apologetic", "warm", "serious", "serious_long", "advise"] as const;
export type SpeechStyle = typeof SPEECH_STYLES[number];
export const FIXED_STYLES = { wake: "cheerful", followup: "warm", goodbye: "warm", fallback: "apologetic", unheard: "apologetic", idle_exit: "warm" } as const;
export function speechStyleFor(intent: Intent, payload: PublicSalesScreenPayload, overrides: Partial<Record<Intent, string>> = {}): string {
  if (Object.hasOwn(overrides, intent)) return overrides[intent]!;
  if (intent === "greeting") return "cheerful";
  if (intent === "unanswerable") return "apologetic";
  if (intent === "chitchat_or_end") return "warm";
  if (intent === "followup_todo" && payload.kpis.overdueFollowUp > 0) return "serious";
  if (["sales_progress", "target_rate", "collection"].includes(intent) && payload.collection.exceeded) return "cheerful";
  return "default";
}
