#!/usr/bin/env node
/** Task 5 real-model browser verification. Runs isolated loopback hub/Next
 * processes; never reconfigures deployed services. No model IDs/tokens in output.
 * VOICE_LOCAL_URL may point at a separately started temporary voice-local.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { AudioStore } from "../services/voice-orchestrator/src/tts/audio-store.ts";
import { VoiceLocalClient } from "../services/voice-orchestrator/src/tts/voice-local-client.ts";
import { createAudioHttpHandler } from "../services/voice-orchestrator/src/tts/http-audio.ts";
import { startVoiceHub } from "../services/voice-orchestrator/src/ws/ws-server.ts";
import { createVoiceOrchestrator } from "../services/voice-orchestrator/src/orchestrator.ts";
import { loadConfig, loadEnvFileExplicit } from "../services/voice-orchestrator/src/config.ts";
import { createDataSource } from "../services/voice-orchestrator/src/datasource/index.ts";
import { OpenAiCompatibleAdapter } from "../services/voice-orchestrator/src/llm/zhipu.ts";
import { TraceSink } from "../services/voice-orchestrator/src/trace/metrics.ts";
import { buildIntentAnswer } from "../src/lib/voice/intent-answers.ts";
import { DEMO_QUESTIONS } from "../src/lib/voice/demo-questions.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
loadEnvFileExplicit(join(root, "services/voice-orchestrator"));
const cfg = loadConfig();
assert(cfg.llmApiKey && cfg.llmModel, "Real local LLM configuration is required");
const output = process.argv[2] ?? "docs/voice-8c-task5-browser-calibration.json";
const screenToken = randomBytes(24).toString("hex"), consoleToken = randomBytes(24).toString("hex");
const records = [], reports = [], answers = [], classifications = [];
const cacheDir = await mkdtemp(join(tmpdir(), "voice-task5-real-"));
const delay = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 90000) {
  const deadline = Date.now() + ms;
  while (!fn()) { assert(Date.now() < deadline, "Verification timeout"); await delay(20); }
}
class CollectTrace extends TraceSink {
  async append(record) { records.push(structuredClone(record)); }
}
let browser, hub, orch, store, next;
try {
  store = new AudioStore({ client: new VoiceLocalClient(cfg.voiceLocalUrl), cacheDir, style: cfg.ttsStyle, enabled: true });
  await store.initialize(); assert(store.ready, "voice-local/cache not ready");
  const adapter = new OpenAiCompatibleAdapter({ baseUrl: cfg.llmBaseUrl, apiKey: cfg.llmApiKey, model: cfg.llmModel, reasoningEffort: cfg.llmReasoningEffort });
  const llm = { name: adapter.name, stream: adapter.stream.bind(adapter), classify: async (text, signal) => { const intent = await adapter.classify(text, signal); classifications.push(intent); return intent; } };
  hub = await startVoiceHub({ host: "127.0.0.1", port: 0,
    onHttpRequest: createAudioHttpHandler({ store, screenToken, consoleToken }),
    onMessage: (conn, raw) => { const event = JSON.parse(raw); if (event.type.startsWith("playback.")) reports.push(event); orch.handleClientMessage(conn, raw); },
  });
  const broadcast = hub.broadcast.bind(hub);
  hub.broadcast = (event, filter) => { if (event.type === "answer.delta" && event.full) answers.push(event); broadcast(event, filter); };
  orch = createVoiceOrchestrator({ hub, audio: store, dataSource: createDataSource({ mode: "fixture", fixturePath: cfg.fixturePath, baseUrl: "", publicId: "" }), llm,
    mcp: null, trace: new CollectTrace(null), hubAuth: { consoleToken, screenToken }, llmTimeoutMs: 8000,
    partialPaceMs: 1, partialMaxTotalMs: 1, prefetchTimeoutMs: 5000, questionMinGapMs: 0, questionWindowMs: 60000, questionWindowMax: 100, mcpToolWhitelist: [],
  });
  next = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "18815"], { cwd: root, stdio: "ignore" });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) { try { ready = (await fetch("http://127.0.0.1:18815/screen/sales")).ok; } catch {} if (!ready) await delay(100); }
  assert(ready, "Next server not ready");
  browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const m = { sources: [], peak: 0, context: null };
    window.task5Audio = m;
    const originalSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      m.context = this;
      const source = originalSource.call(this), start = source.start.bind(source);
      source.start = (when = 0) => { m.sources.push({ when, duration: source.buffer.duration, at: this.currentTime }); start(when); };
      return source;
    };
    const originalSample = AnalyserNode.prototype.getFloatTimeDomainData;
    AnalyserNode.prototype.getFloatTimeDomainData = function (data) {
      originalSample.call(this, data); let sum = 0; for (const x of data) sum += x*x;
      m.peak = Math.max(m.peak, Math.sqrt(sum/data.length));
    };
  });
  await page.goto(`http://127.0.0.1:18815/screen/sales?voiceLive=1&lite=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}#hubToken=${screenToken}`);
  await waitFor(() => hub.counts().screens === 1, 5000);
  assert(!page.url().includes(screenToken));
  const payload = await createDataSource({ mode: "fixture", fixturePath: cfg.fixturePath, baseUrl: "", publicId: "" }).fetchPayload();
  const rounds = [];
  const intents = ["sales_progress","target_rate","region_shipments","upcoming_shipments","new_customers","followup_todo","collection","unanswerable"];
  const questions = [...DEMO_QUESTIONS.map((q,i) => ({text:q.question,intent:intents[i]})), {text:"谢谢，没有了",intent:"chitchat_or_end"}];
  for (const q of questions) {
    const index = records.length;
    await page.evaluate(() => { window.task5Audio.sources = []; window.task5Audio.peak = 0; });
    orch.handleClientMessage({ id: "verification-console", role: "console", send() {}, close() {} }, JSON.stringify({type:"question.submit",at:Date.now(),text:q.text}));
    await waitFor(() => records.length > index);
    const answer = answers.at(-1), record = records.at(-1), id = answer.speech.turnId;
    const metrics = await page.evaluate(() => ({ sources: window.task5Audio.sources, peak: window.task5Audio.peak, currentTime: window.task5Audio.context.currentTime }));
    const expected = q.intent;
    assert.equal(classifications.at(-1), expected);
    assert.deepEqual(answer.card, buildIntentAnswer(expected, payload).card);
    assert.equal(record.playbackOutcome, "drained");
    assert(reports.some(r => r.type === "playback.started" && r.turnId === id));
    assert(!reports.some(r => r.type === "playback.failed" && r.turnId === id));
    const last = metrics.sources.at(-1);
    assert(metrics.currentTime >= last.when + last.duration);
    assert(metrics.peak > 0.001);
    const gap = Math.max(0, ...metrics.sources.slice(1).map((s,i) => s.when - (metrics.sources[i].when + metrics.sources[i].duration)));
    rounds.push({ question: q.text, intent: expected, card: answer.card.kind, sentences: answer.speech.sentences.length,
      pcmSeconds: metrics.sources.reduce((sum,s) => sum+s.duration,0), maxScheduleGapMs: gap*1000, analyserPeakRms: metrics.peak,
      classifyMs: record.classifyMs, ttsFirstByteMs: record.ttsFirstByteMs ?? null, playbackStartMs: record.playbackStartMs,
      playbackOutcome: record.playbackOutcome, ttsRegenerated: record.ttsRegenerated, ttsTruncated: record.ttsTruncated, ttsFail: record.ttsFail,
      fixed: answer.speech.fixed ?? null, displayMatched: true, streamsAndQueueDrained: true,
    });
    console.log(`verified ${rounds.length}/${questions.length}: ${expected}, PCM ${rounds.at(-1).pcmSeconds.toFixed(2)}s, ${record.playbackOutcome}`);
    if (orch.state.name !== "closing") orch.forceClose("force");
    await waitFor(() => orch.state.name === "ambient", 5000);
    await page.locator(".overlay-root").waitFor({ state: "detached", timeout: 5000 });
  }
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(output, JSON.stringify({ generatedAt: new Date().toISOString(), scope: "real local classifier + real TTS + Chromium Web Audio + hub playback reports; typed input and public fixture; no microphone or physical speaker listening", playbackMetric: "question arrival to hub receipt of browser first-sample report, includes feedback transit", rounds }, null, 2)+"\n");
  console.log(`saved ${output}`);
} finally {
  orch?.forceClose("force"); store?.close(); await browser?.close(); await hub?.close();
  if (next) { next.kill("SIGTERM"); await new Promise(resolve => { if (next.exitCode !== null) resolve(); else next.once("exit", resolve); }); }
  await rm(cacheDir, { recursive: true, force: true });
}
