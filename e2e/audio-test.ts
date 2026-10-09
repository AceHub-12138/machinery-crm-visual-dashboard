import { test as base } from "@playwright/test";

/** Optional native silent sink for machines whose physical audio clock stalls.
 * This still renders PCM, analyser and worklet samples; it changes no app code.
 * Keep the default physical output for ordinary browser/hardware runs.
 */
export const test = base.extend<{ silentAudio: void }>({
  silentAudio: [async ({ page }, use) => {
    if (process.env.PLAYWRIGHT_SILENT_AUDIO === "1") {
      await page.addInitScript(() => {
        const NativeAudioContext = window.AudioContext;
        window.AudioContext = class extends NativeAudioContext {
          constructor(options?: AudioContextOptions) {
            super({ ...options, sinkId: { type: "none" } } as AudioContextOptions);
          }
        };
      });
    }
    await use();
  }, { auto: true }],
});

export { expect, type Page } from "@playwright/test";
