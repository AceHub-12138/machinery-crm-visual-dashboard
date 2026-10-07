import { buildSpokenSentences } from "./spoken-normalize.ts";

/** Upper duration guard shared by browser and hub, independent of typing speed.
 * Matches voice-local's 0.4 s/normalized character + 1.5 s/sentence limit.
 */
export function playbackFallbackMs(display: string): number {
  const sentences = buildSpokenSentences(display);
  const seconds = sentences.reduce((sum, s) => sum + s.spokenText.length * 0.4 + 1.5, 0);
  return Math.ceil(seconds * 2000 + 2000);
}
