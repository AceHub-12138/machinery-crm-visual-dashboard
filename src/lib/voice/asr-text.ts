/** Only strip a leading assistant address; preserve business text such as 大川机床. */
export function stripWakePrefix(text: string): string {
  return text.trim().replace(/^(?:你\s*好[\s，,。.!！、]*小\s*川|小\s*川)[\s，,。.!！、:：?？]*/, "").trim();
}
export function isUnheard(text: string): boolean { return [...text.replace(/[^\p{L}\p{N}]/gu, "")].length < 2; }
