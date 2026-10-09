import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
const requireVitest = createRequire(import.meta.resolve("vitest"));
const requireVite = createRequire(requireVitest.resolve("vite"));
const { buildSync } = requireVite("esbuild");

test("24kHz actual PcmPlayer blocks render sample-identically to a whole buffer", async ({ page }) => {
  const bundle = buildSync({ entryPoints: ["src/lib/voice/pcm-player.ts"], bundle: true, write: false, format: "iife", globalName: "VoiceQuality" }).outputFiles[0].text;
  await page.goto("/voice-console");
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const total = 24000, lead = 3600;
    const pcm = new Uint8Array(total * 2), view = new DataView(pcm.buffer);
    const floats = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const value = Math.round(12000 * Math.sin(i * .063) + 2000 * Math.sin(i * .57));
      view.setInt16(i * 2, value, true); floats[i] = value / 32768;
    }
    const offline = new OfflineAudioContext(1, total + lead + 500, 24000);
    let nodes = 0;
    // Offline rendering has no live running clock; retain its native buffers/nodes.
    const adapter = new Proxy(offline, { get(target, key) {
      if (key === "state") return "running";
      if (key === "resume" || key === "close") return async () => {};
      if (key === "createBufferSource") return () => { nodes++; return target.createBufferSource(); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }});
    // Bundled production player, with only context and HTTP transport injected.
    const Player = (window as unknown as { VoiceQuality: { PcmPlayer: new (options: unknown) => { play: (...args: unknown[]) => void; close: () => Promise<void> } } }).VoiceQuality.PcmPlayer;
    const player = new Player({ createContext: () => adapter, fetch: async () => new Response(pcm, { headers: { "content-type": "audio/pcm", "x-sample-rate": "24000", "x-channels": "1", "x-sample-format": "s16le" } }) });
    player.play({ turnId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", sentences: [{index:0,displayStart:0,displayEnd:1}] }, "http://localhost", null, {}, 5000);
    for (let attempt = 0; nodes < 20 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    const actual = (await offline.startRendering()).getChannelData(0);
    const full = new OfflineAudioContext(1, actual.length, 24000);
    const buffer = full.createBuffer(1, total, 24000); buffer.getChannelData(0).set(floats);
    const source = full.createBufferSource(); source.buffer = buffer; source.connect(full.destination); source.start(.15);
    const expected = (await full.startRendering()).getChannelData(0);
    let mismatches = 0, maxError = 0;
    for (let i = 0; i < expected.length; i++) { if (actual[i] !== expected[i]) mismatches++; maxError = Math.max(maxError, Math.abs(actual[i] - expected[i])); }
    await player.close();
    return { nodes, sampleRate: offline.sampleRate, mismatches, maxError };
  });
  expect(result).toEqual({nodes:20,sampleRate:24000,mismatches:0,maxError:0});
});
