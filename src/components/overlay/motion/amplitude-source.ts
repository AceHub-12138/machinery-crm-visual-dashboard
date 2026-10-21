import type { VoiceStateName } from "@/lib/voice/session-machine";
/** Listening input and audible output never share an analyser. Fixed prompts are output too. */
export function amplitudeSource(state: VoiceStateName, bargePaused: boolean, fixedPrompt: boolean): "input" | "output" {
  return bargePaused || (!fixedPrompt && (state === "listening" || state === "followup")) ? "input" : "output";
}
