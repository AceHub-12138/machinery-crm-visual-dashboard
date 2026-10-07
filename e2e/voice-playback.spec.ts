import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AudioStore } from "../services/voice-orchestrator/src/tts/audio-store";
import { createAudioHttpHandler } from "../services/voice-orchestrator/src/tts/http-audio";
import { startVoiceHub, type VoiceHubServer } from "../services/voice-orchestrator/src/ws/ws-server";
import { createVoiceOrchestrator } from "../services/voice-orchestrator/src/orchestrator";
import { ScriptedAdapter } from "../services/voice-orchestrator/src/llm/scripted";
import { TraceSink } from "../services/voice-orchestrator/src/trace/metrics";
import { validatePublicPayload } from "../src/lib/voice/public-payload";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(readFileSync(new URL("../services/voice-orchestrator/fixtures/public-sales-screen.json", import.meta.url), "utf8"));
import type { SpeechClient, TtsChunk } from "../services/voice-orchestrator/src/tts/voice-local-client";

// Real hub, Bearer/CORS GETs and Chromium AudioContext. Deterministic test tones
// replace only GPU inference, so stream/player/state integration runs in CI.
const screenToken = "task5-screen-test-token";
const consoleToken = "task5-console-test-token";
let hub: VoiceHubServer; let store: AudioStore; let cacheDir: string;
let orch: ReturnType<typeof createVoiceOrchestrator>;
let normalSeconds = 2; let fail = false; let calls = 0;
const reports: Array<{ type: string; turnId: string; at: number }> = [];
function tone(seconds: number) {
  const pcm = new Uint8Array(Math.round(seconds * 24000) * 2); const view = new DataView(pcm.buffer);
  for (let i = 0; i < pcm.length / 2; i++) view.setInt16(i * 2, Math.round(Math.sin(i * 2 * Math.PI * 220 / 24000) * 7000), true);
  return pcm;
}
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });
test.beforeAll(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "voice-task5-browser-"));
  const client: SpeechClient = {
    health: async () => ({ warm: true, selfCheck: "passed", styles: ["default"], refHash: "a".repeat(64) }),
    asr: async () => ({ text: "test", ms: 0 }),
    tts: async function* (): AsyncIterable<TtsChunk> {
      calls++;
      if (fail) throw new Error("injected audio outage");
      const pcm = tone(calls <= 5 ? 1 : normalSeconds);
      for (let offset = 0; offset < pcm.length; offset += 9600) yield { type: "audio", pcm: pcm.slice(offset, offset + 9600), sampleRate: 24000 };
      yield { type: "done", metrics: { ttsRegenerated: 0, ttsTruncated: 0, ttsFail: 0 } };
    },
  };
  store = new AudioStore({ client, cacheDir, enabled: true }); await store.initialize();
  hub = await startVoiceHub({ host: "127.0.0.1", port: 0,
    onHttpRequest: createAudioHttpHandler({ store, screenToken, consoleToken }),
    onMessage: (conn, raw) => { const ev = JSON.parse(raw); if (ev.type.startsWith("playback.")) reports.push(ev); orch.handleClientMessage(conn, raw); },
  });
  orch = createVoiceOrchestrator({ hub, audio: store, dataSource: { name: "test", fetchPayload: async () => validatePublicPayload(fixture)! },
    llm: new ScriptedAdapter(), mcp: null, trace: new TraceSink(null), hubAuth: { screenToken, consoleToken },
    llmTimeoutMs: 8000, partialPaceMs: 1, partialMaxTotalMs: 1, prefetchTimeoutMs: 5000, questionMinGapMs: 0, questionWindowMs: 60000, questionWindowMax: 100, mcpToolWhitelist: [],
  });
});
test.afterAll(async () => { orch?.forceClose("force"); store?.close(); await hub?.close(); if (cacheDir) await rm(cacheDir, { recursive: true, force: true }); });
test.beforeEach(async () => {
  orch.forceClose("force"); reports.length = 0; fail = false; normalSeconds = 2;
  await expect.poll(() => orch.state.name).toBe("ambient");
});
function ask(text: string) { orch.handleClientMessage({ id: "e2e-console", role: "console", send: () => {}, close: () => {} }, JSON.stringify({ type: "question.submit", at: Date.now(), text })); }
async function open(page: Page) {
  await page.addInitScript(() => {
    const metrics = { scheduled: [] as Array<{ when: number; duration: number; at: number }>, stopped: 0, peak: 0 };
    Object.assign(window, { task5Audio: metrics });
    const originalSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = originalSource.call(this); const originalStart = source.start.bind(source); const originalStop = source.stop.bind(source);
      source.start = (when = 0) => { metrics.scheduled.push({ when, duration: source.buffer!.duration, at: this.currentTime }); originalStart(when); };
      source.stop = (when = 0) => { metrics.stopped++; originalStop(when); }; return source;
    };
    const originalSample = AnalyserNode.prototype.getFloatTimeDomainData;
    AnalyserNode.prototype.getFloatTimeDomainData = function (data) {
      originalSample.call(this, data); let sum = 0; for (const x of data) sum += x * x;
      metrics.peak = Math.max(metrics.peak, Math.sqrt(sum / data.length));
    };
  });
  await page.goto(`/screen/sales?voiceLive=1&lite=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}#hubToken=${screenToken}`);
  await expect.poll(() => hub.counts().screens).toBe(1);
  expect(page.url()).not.toContain(screenToken);
}
async function metrics(page: Page) {
  return page.evaluate(() => (window as unknown as { task5Audio: { scheduled: Array<{ when: number; duration: number; at: number }>; stopped: number; peak: number } }).task5Audio);
}

test("real PCM drives analyser and sentence highlight; followup waits for EOF and final sample", async ({ page }, info) => {
  await open(page); normalSeconds = 4; ask("本期新增客户有多少家");
  await expect(page.getByText("播报中", { exact: true })).toBeVisible();
  await expect.poll(() => reports.some(r => r.type === "playback.started")).toBe(true);
  const first = page.locator(".overlay-sentence-active");
  await expect(first).toContainText("本期新增客户");
  await expect.poll(async () => (await metrics(page)).peak).toBeGreaterThan(0.05);
  await page.screenshot({ path: info.outputPath("voice-pcm-first-sentence.png") });
  // Old text speed would finish before eight seconds of PCM. Both mirrors
  // remain answering after the second sentence starts at ~4.15s.
  await expect(first).toContainText("客户总数", { timeout: 6000 });
  expect(orch.state.name).toBe("answering"); expect(reports.some(r => r.type === "playback.drained")).toBe(false);
  await page.screenshot({ path: info.outputPath("voice-pcm-second-sentence.png") });
  await expect(page.getByText("等待追问", { exact: true })).toBeVisible({ timeout: 6000 });
  expect(orch.state.name).toBe("followup"); expect(reports.filter(r => r.type === "playback.started")).toHaveLength(1);
  expect(reports.filter(r => r.type === "playback.drained")).toHaveLength(1);
  const m = await metrics(page); expect(m.scheduled[0].when - m.scheduled[0].at).toBeCloseTo(0.15, 2);
  for (let i = 1; i < m.scheduled.length; i++) expect(m.scheduled[i].when).toBeCloseTo(m.scheduled[i - 1].when + m.scheduled[i - 1].duration, 5);
  await expect(page.locator(".overlay-root")).toHaveCount(0, { timeout: 6000 });
  expect(await page.locator("#screen-stage").boundingBox()).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
});

test("cached goodbye plays before closing and starts no new GPU request", async ({ page }) => {
  await open(page); const before = calls; ask("谢谢，没有了");
  await expect(page.getByText("播报中", { exact: true })).toBeVisible();
  await expect.poll(() => reports.some(r => r.type === "playback.started")).toBe(true);
  expect(orch.state.name).toBe("answering");
  await expect.poll(() => reports.some(r => r.type === "playback.drained")).toBe(true);
  expect(orch.state.name).toBe("closing"); expect(calls).toBe(before);
  await expect(page.locator(".overlay-root")).toHaveCount(0);
});

test("superseding a live answer stops its sources and downloads; only the new turn drains", async ({ page }) => {
  await open(page); normalSeconds = 4; ask("本期新增客户有多少家");
  await expect.poll(() => reports.some(r => r.type === "playback.started")).toBe(true);
  const old = reports.find(r => r.type === "playback.started")!.turnId;
  const oldSources = (await metrics(page)).scheduled.length; expect(oldSources).toBeGreaterThan(0);
  normalSeconds = 1; ask("谢谢，没有了");
  await expect.poll(async () => (await metrics(page)).stopped).toBeGreaterThan(0);
  expect(store.lookup(old)?.cancelled).toBe(true);
  await expect.poll(() => reports.some(r => r.type === "playback.drained")).toBe(true);
  expect(reports.filter(r => r.type === "playback.drained").every(r => r.turnId !== old)).toBe(true);
});

test("audio failure leaves the card readable and does not report successful playback", async ({ page }) => {
  await open(page); fail = true; ask("本期新增客户有多少家");
  await expect(page.getByText("语音播报中断，请查看卡片。", { exact: true })).toBeVisible();
  await expect(page.locator(".overlay-card")).toBeVisible(); expect(orch.state.name).toBe("followup");
  expect(reports.some(r => r.type === "playback.failed")).toBe(true); expect(reports.some(r => r.type === "playback.drained")).toBe(false);
  await expect(page.locator(".overlay-root")).toHaveCount(0, { timeout: 6000 });
});

test("Escape and hub disconnect stop audio immediately and restore the baseline", async ({ page }) => {
  await open(page); normalSeconds = 4; ask("本期新增客户有多少家");
  await expect.poll(() => reports.some(r => r.type === "playback.started")).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await metrics(page)).stopped).toBeGreaterThan(0);
  await expect(page.locator(".overlay-root")).toHaveCount(0);
  expect(await page.locator("#screen-stage").boundingBox()).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  orch.forceClose("force"); await expect.poll(() => orch.state.name).toBe("ambient");
  reports.length = 0; ask("本期新增客户有多少家"); await expect.poll(() => reports.some(r => r.type === "playback.started")).toBe(true);
  const before = (await metrics(page)).stopped; for (const conn of hub.connections) if (conn.role === "screen") conn.close(1011);
  await expect.poll(async () => (await metrics(page)).stopped).toBeGreaterThan(before);
  await expect(page.locator(".overlay-root")).toHaveCount(0);
  await expect.poll(() => hub.counts().screens).toBe(1);
});

test("a suspended context reports failure and a pointer gesture enables the next answer", async ({ page }) => {
  // CDP instrumentation marks user activation in this runner, so force a
  // suspended real AudioContext until a pointer gesture. Audio buffers,
  // scheduling, analyser and post-gesture resume remain the native APIs.
  await page.addInitScript(() => {
    let allowed = false;
    window.addEventListener("pointerdown", () => { allowed = true; }, { capture: true });
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) { super(options); void super.suspend(); }
      resume(): Promise<void> {
        if (allowed) return super.resume();
        return new Promise(resolve => window.addEventListener("pointerdown", () => { void super.resume().then(resolve); }, { once: true }));
      }
    };
  });
  await open(page); ask("本期新增客户有多少家");
  await expect.poll(() => reports.some(r => r.type === "playback.failed")).toBe(true);
  expect(reports.some(r => r.type === "playback.started")).toBe(false);
  await expect(page.getByText("请点击屏幕启用声音；本次回答请查看卡片。", { exact: true })).toBeVisible();
  await page.mouse.click(40, 40);
  orch.forceClose("force"); await expect.poll(() => orch.state.name).toBe("ambient");
  await expect(page.locator(".overlay-root")).toHaveCount(0);
  reports.length = 0; ask("谢谢，没有了");
  await expect.poll(() => reports.some(r => r.type === "playback.started")).toBe(true);
  await expect.poll(() => reports.some(r => r.type === "playback.drained")).toBe(true);
  expect(reports.some(r => r.type === "playback.failed")).toBe(false);
});
