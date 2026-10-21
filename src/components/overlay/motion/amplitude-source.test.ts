import { expect, it } from "vitest";
import { amplitudeSource } from "./amplitude-source";
it("routes mic listening separately from TTS output and fixed prompts", () => {
  expect(amplitudeSource("listening", false, false)).toBe("input");
  expect(amplitudeSource("followup", false, false)).toBe("input");
  expect(amplitudeSource("answering", false, false)).toBe("output");
  expect(amplitudeSource("followup", false, true)).toBe("output");
  expect(amplitudeSource("answering", true, false)).toBe("input");
  expect(amplitudeSource("followup", true, true)).toBe("input");
});
