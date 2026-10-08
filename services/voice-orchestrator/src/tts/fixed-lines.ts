import { readFileSync } from "node:fs";
import { normalizeSpokenText } from "../../../../src/lib/voice/spoken-normalize.ts";

const lines = JSON.parse(readFileSync(new URL("../../../../scripts/voice-bakeoff/lines.json", import.meta.url), "utf8")) as Array<{ id: number; text: string }>;
function line(id: number): string {
  const text = lines.find((entry) => entry.id === id)?.text;
  if (!text) throw new Error(`Missing fixed speech line ${id}`);
  return normalizeSpokenText(text);
}
export const FIXED_LINES = {
  wake: line(1), followup: line(5), goodbye: line(6), fallback: line(7), unheard: normalizeSpokenText("抱歉先生,我没有听清。"),
  idle_exit: normalizeSpokenText("有事您再叫我,先生。"),
} as const;
export type FixedLineKey = keyof typeof FIXED_LINES;
