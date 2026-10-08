import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AudioStore } from "../services/voice-orchestrator/src/tts/audio-store";
import { createAudioHttpHandler } from "../services/voice-orchestrator/src/tts/http-audio";
import { startVoiceHub, type VoiceHubServer } from "../services/voice-orchestrator/src/ws/ws-server";
import { createVoiceOrchestrator } from "../services/voice-orchestrator/src/orchestrator";
import { ScriptedAdapter } from "../services/voice-orchestrator/src/llm/scripted";
import { TraceSink, type TurnTraceRecord } from "../services/voice-orchestrator/src/trace/metrics";
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
let normalSeconds = 2; let fail = false; let calls = 0; let failAtCall = 0; let slowDownloads = false;
const reports: Array<{ type: string; turnId: string; at: number; reason?: string; sentenceIndex?: number }> = [];
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
    tts: async function* (_text, _style, signal): AsyncIterable<TtsChunk> {
      calls++;
      if (fail || calls === failAtCall) throw new Error("injected audio outage");
      const pcm = tone(calls <= 5 ? 1 : normalSeconds);
      const slow = slowDownloads;
      for (let offset = 0; offset < pcm.length; offset += 9600) {
        if (slow) await new Promise(resolve => setTimeout(resolve, 100));
        signal?.throwIfAborted();
        yield { type: "audio", pcm: pcm.slice(offset, offset + 9600), sampleRate: 24000 };
      }
      yield { type: "done", metrics: { ttsRegenerated: 0, ttsTruncated: 0, ttsFail: 0 } };
    },
  };
  store = new AudioStore({ client, cacheDir, enabled: true }); await store.initialize();
  hub = await startVoiceHub({ host: "127.0.0.1", port: 0,
    onHttpRequest: createAudioHttpHandler({ store, screenToken, consoleToken }),
    onMessage: (conn, raw) => { const ev = JSON.parse(raw); if (ev.type.startsWith("playback.") || ev.type === "session.dismiss") reports.push(ev); orch.handleClientMessage(conn, raw); },
    onClose: (conn) => orch?.detach(conn),
  });
  orch = createVoiceOrchestrator({ hub, audio: store, dataSource: { name: "test", fetchPayload: async () => validatePublicPayload(fixture)! },
    llm: new ScriptedAdapter(), mcp: null, trace: new TraceSink(join(cacheDir, "trace.jsonl")), hubAuth: { screenToken, consoleToken },
    llmTimeoutMs: 8000, partialPaceMs: 1, partialMaxTotalMs: 1, prefetchTimeoutMs: 5000, questionMinGapMs: 0, questionWindowMs: 60000, questionWindowMax: 100, mcpToolWhitelist: [],
  });
});
test.afterAll(async () => { orch?.forceClose("force"); store?.close(); await hub?.close(); if (cacheDir) await rm(cacheDir, { recursive: true, force: true }); });
test.beforeEach(async () => {
  orch.forceClose("force"); reports.length = 0; fail = false; normalSeconds = 2; failAtCall = 0; slowDownloads = false;
  await expect.poll(() => orch.state.name).toBe("ambient");
});
function ask(text: string) { orch.handleClientMessage({ id: "e2e-console", role: "console", send: () => {}, close: () => {} }, JSON.stringify({ type: "question.submit", at: Date.now(), text })); }
async function open(page: Page) {
  await page.addInitScript(() => {
    const metrics = { scheduled: [] as Array<{ when: number; duration: number; at: number }>, downloads: [] as Array<{ turnId: string; aborted: boolean; completed: boolean }>, stopped: 0, peak: 0 };
    Object.assign(window, { task5Audio: metrics });
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String(input); const turnId = /\/voice\/audio\/([^/]+)\//.exec(url)?.[1];
      if (!turnId) return originalFetch(input, init);
      const download = { turnId, aborted: false, completed: false }; metrics.downloads.push(download);
      init?.signal?.addEventListener("abort", () => { download.aborted = true; }, { once: true });
      const response = await originalFetch(input, init);
      if (!response.body) return response;
      const reader = response.body.getReader();
      return new Response(new ReadableStream({
        async pull(controller) {
          try {
            const part = await reader.read();
            if (part.done) { download.completed = true; controller.close(); } else controller.enqueue(part.value);
          } catch (error) { controller.error(error); }
        },
        cancel: () => reader.cancel(),
      }), { status: response.status, headers: response.headers });
    };
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
  await expect.poll(() => hub.counts().screens).toBeGreaterThanOrEqual(1);
  expect(page.url()).not.toContain(screenToken);
}
async function metrics(page: Page) {
  return page.evaluate(() => (window as unknown as { task5Audio: { scheduled: Array<{ when: number; duration: number; at: number }>; downloads: Array<{ turnId: string; aborted: boolean; completed: boolean }>; stopped: number; peak: number } }).task5Audio);
}
async function traces(sessionId: string): Promise<TurnTraceRecord[]> {
  const raw = await readFile(join(cacheDir, "trace.jsonl"), "utf8").catch(() => "");
  return raw.split("\n").filter(Boolean).map(line => JSON.parse(line) as TurnTraceRecord).filter(record => record.sessionId === sessionId);
}

test("real PCM drives analyser and sentence highlight; followup waits for EOF and final sample", async ({ page }, info) => {
  await open(page); normalSeconds = 4; ask("本期新增客户有多少家");
  await expect(page.getByText("播报中", { exact: true })).toBeVisible();
  await expect.poll(() => reports.some(r => r.type === "playback.started")).toBe(true);
  const first = page.locator(".overlay-sentence-active");
  await expect(first).toContainText("本期新增客户");
  await expect.poll(async () => (await metrics(page)).peak).toBeGreaterThan(0.05);
  await page.screenshot({ path: info.outputPath("voice-pcm-first-sentence.png") });
  // Check beyond the old 4.85s typing deadline, before the eight seconds drain.
  await expect(first).toContainText("客户总数", { timeout: 6000 });
  expect(orch.state.name).toBe("answering"); expect(reports.some(r => r.type === "playback.drained")).toBe(false);
  await page.screenshot({ path: info.outputPath("voice-pcm-second-sentence.png") });
  const firstAudioAt = reports.find(r => r.type === "playback.started")!.at;
  await expect.poll(() => Date.now() - firstAudioAt, { timeout: 4000 }).toBeGreaterThanOrEqual(6500);
  expect(orch.state.name).toBe("answering"); expect(reports.some(r => r.type === "playback.drained")).toBe(false);
  await expect(page.getByText("等待追问", { exact: true })).toBeVisible({ timeout: 15000 });
  expect(orch.state.name).toBe("followup"); expect(reports.filter(r => r.type === "playback.started")).toHaveLength(1);
  expect(reports.filter(r => r.type === "playback.drained")).toHaveLength(1);
  const m = await metrics(page); expect(m.scheduled[0].when - m.scheduled[0].at).toBeCloseTo(0.15, 2);
  for (let i = 1; i < m.scheduled.length; i++) expect(m.scheduled[i].when).toBeCloseTo(m.scheduled[i - 1].when + m.scheduled[i - 1].duration, 5);
  await expect(page.locator(".overlay-root")).toHaveCount(0, { timeout: 16000 });
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
  await open(page); normalSeconds = 4; slowDownloads = true; ask("本期新增客户有多少家");
  await expect.poll(() => reports.some(r => r.type === "playback.started")).toBe(true);
  const old = reports.find(r => r.type === "playback.started")!.turnId;
  const oldSources = (await metrics(page)).scheduled.length; expect(oldSources).toBeGreaterThan(0);
  expect((await metrics(page)).downloads.some(d => d.turnId === old && !d.completed)).toBe(true);
  normalSeconds = 1; ask("谢谢，没有了");
  await expect.poll(async () => (await metrics(page)).stopped).toBeGreaterThan(0);
  await expect.poll(async () => (await metrics(page)).downloads.filter(d => d.turnId === old).every(d => d.aborted)).toBe(true);
  expect(store.lookup(old)?.cancelled).toBe(true);
  await expect.poll(() => reports.some(r => r.type === "playback.drained")).toBe(true);
  expect(reports.filter(r => r.type === "playback.drained").every(r => r.turnId !== old)).toBe(true);
});

test("audio failure leaves the card readable and does not report successful playback", async ({ page }) => {
  await open(page); fail = true; ask("本期新增客户有多少家");
  await expect(page.getByText("语音播报中断，请查看卡片。", { exact: true })).toBeVisible();
  await expect(page.locator(".overlay-card")).toBeVisible(); expect(orch.state.name).toBe("answering");
  expect(reports.some(r => r.type === "playback.failed")).toBe(true); expect(reports.some(r => r.type === "playback.drained")).toBe(false);
  await expect(page.locator(".overlay-root")).toHaveCount(0, { timeout: 12000 });
  expect(reports.some(r => r.type === "playback.drained")).toBe(false);
});

test("Escape and hub disconnect stop audio immediately and restore the baseline", async ({ page }) => {
  await open(page); normalSeconds = 4; ask("本期新增客户有多少家");
  await expect.poll(() => reports.some(r => r.type === "playback.started")).toBe(true);
  await page.keyboard.press("Escape");
  const dismissedSession = orch.sessionId;
  await expect.poll(() => orch.state.name).toBe("ambient");
  expect(reports.some(r => r.type === "session.dismiss")).toBe(true);
  await expect.poll(async () => (await traces(dismissedSession)).map(r => r.playbackOutcome)).toEqual(["cancelled"]);
  await expect.poll(async () => (await metrics(page)).stopped).toBeGreaterThan(0);
  await expect(page.locator(".overlay-root")).toHaveCount(0);
  expect(await page.locator("#screen-stage").boundingBox()).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  reports.length = 0; ask("本期新增客户有多少家"); await expect.poll(() => reports.some(r => r.type === "playback.started")).toBe(true);
  const before = (await metrics(page)).stopped; for (const conn of hub.connections) if (conn.role === "screen") conn.close(1011);
  await expect.poll(() => orch.state.name).toBe("ambient");
  await expect.poll(async () => (await metrics(page)).stopped).toBeGreaterThan(before);
  await expect(page.locator(".overlay-root")).toHaveCount(0);
  await expect.poll(() => hub.counts().screens).toBeGreaterThanOrEqual(1);
});

test("Escape during followup closes the hub and a fresh question wakes the screen", async ({ page }) => {
  await open(page); normalSeconds = 0.5; ask("本期新增客户有多少家");
  await expect(page.getByText("等待追问", { exact: true })).toBeVisible({timeout:12000});
  const dismissedSession = orch.sessionId;
  await page.keyboard.press("Escape");
  await expect.poll(() => orch.state.name).toBe("ambient");
  await expect(page.locator(".overlay-root")).toHaveCount(0);
  expect(reports.filter(r => r.type === "session.dismiss")).toHaveLength(1);
  await expect.poll(async () => (await traces(dismissedSession)).map(r => r.playbackOutcome)).toEqual(["drained"]);
  reports.length = 0; ask("谢谢，没有了");
  await expect.poll(() => reports.some(r => r.type === "playback.started")).toBe(true);
  await expect.poll(() => reports.some(r => r.type === "playback.drained")).toBe(true);
});

test("one failed sentence preserves earlier audio and records skipped sentences with drained", async ({ page }) => {
  await open(page); normalSeconds = 2; failAtCall = calls + 2; ask("本期新增客户有多少家");
  await expect.poll(() => reports.some(r => r.type === "playback.skipped" && r.sentenceIndex === 1)).toBe(true);
  await expect.poll(() => reports.some(r => r.type === "playback.started")).toBe(true);
  const id = reports.find(r => r.type === "playback.started")!.turnId;
  const sessionId = orch.sessionId;
  expect(orch.state.name).toBe("answering"); expect((await metrics(page)).stopped).toBe(0);
  expect(reports.some(r => r.type === "playback.failed")).toBe(false);
  await expect(page.getByText("部分语音播报中断，请查看卡片。", { exact: true })).toBeVisible();
  await expect.poll(() => reports.some(r => r.type === "playback.drained")).toBe(true);
  expect(orch.state.name).toBe("followup");
  await expect.poll(async () => (await traces(sessionId)).map(r => ({ outcome: r.playbackOutcome, skipped: r.playbackSkipped }))).toEqual([{ outcome: "drained", skipped: [{ sentenceIndex: 1, reason: "audio_unavailable" }] }]);
  const total = (await metrics(page)).scheduled.reduce((sum, source) => sum + source.duration, 0);
  expect(total).toBeCloseTo((store.lookup(id)!.sentences.length - 1) * normalSeconds, 5);
});

test("a skipped first sentence still reports the actual first sound exactly once", async ({ page }) => {
  await open(page); normalSeconds = 2; failAtCall = calls + 1; ask("本期新增客户有多少家");
  await expect.poll(() => reports.some(r => r.type === "playback.started")).toBe(true);
  expect(reports.filter(r => r.type === "playback.skipped").map(r => r.sentenceIndex)).toEqual([0]);
  await expect(page.locator(".overlay-sentence-active")).toContainText("客户总数");
  await expect.poll(() => reports.some(r => r.type === "playback.drained")).toBe(true);
  expect(reports.filter(r => r.type === "playback.started")).toHaveLength(1);
  expect(reports.some(r => r.type === "playback.failed")).toBe(false);
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
  await expect(page.getByText("请点击屏幕启用声音；本次回答请查看卡片，随后重新唤醒。", { exact: true })).toBeVisible();
  await page.mouse.click(40, 40);
  orch.forceClose("force"); await expect.poll(() => orch.state.name).toBe("ambient");
  await expect(page.locator(".overlay-root")).toHaveCount(0);
  reports.length = 0; ask("谢谢，没有了");
  await expect.poll(() => reports.some(r => r.type === "playback.started")).toBe(true);
  await expect.poll(() => reports.some(r => r.type === "playback.drained")).toBe(true);
  expect(reports.some(r => r.type === "playback.failed")).toBe(false);
});
