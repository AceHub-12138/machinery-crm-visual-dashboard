import { test, expect, type Page } from "./audio-test";
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
const stateChanges:Array<{type:string;to:string;at:number}>=[];
const reports: Array<{ type: string; turnId: string; at: number; reason?: string; sentenceIndex?: number }> = [];
function tone(seconds: number) {
  const pcm = new Uint8Array(Math.round(seconds * 24000) * 2); const view = new DataView(pcm.buffer);
  for (let i = 0; i < pcm.length / 2; i++) view.setInt16(i * 2, Math.round(Math.sin(i * 2 * Math.PI * 220 / 24000) * 7000), true);
  return pcm;
}
test.use({ launchOptions: { args: ["--autoplay-policy=user-gesture-required"] } });
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
  const broadcast=hub.broadcast.bind(hub);hub.broadcast=(event,filter)=>{if((event as {type:string}).type==='state.change')stateChanges.push(event as {type:string;to:string;at:number});broadcast(event,filter);};
  orch = createVoiceOrchestrator({ hub, audio: store, dataSource: { name: "test", fetchPayload: async () => validatePublicPayload(fixture)! },
    llm: new ScriptedAdapter(), mcp: null, trace: new TraceSink(join(cacheDir, "trace.jsonl")), hubAuth: { screenToken, consoleToken },
    llmTimeoutMs: 8000, partialPaceMs: 1, partialMaxTotalMs: 1, prefetchTimeoutMs: 5000, questionMinGapMs: 0, questionWindowMs: 60000, questionWindowMax: 100, mcpToolWhitelist: [],
  });
});
test.afterAll(async () => { orch?.forceClose("force"); store?.close(); await hub?.close(); if (cacheDir) await rm(cacheDir, { recursive: true, force: true }); });
test.beforeEach(async () => {
  orch.forceClose("force"); reports.length = 0; stateChanges.length=0; fail = false; normalSeconds = 2; failAtCall = 0; slowDownloads = false;
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
  const screenCountBefore = hub.counts().screens;
  await page.goto(`/screen/sales?voiceLive=1&lite=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}#hubToken=${screenToken}`);
  await expect.poll(() => hub.counts().screens).toBeGreaterThan(screenCountBefore);
  expect(page.url()).not.toContain(screenToken);
}
async function metrics(page: Page) {
  return page.evaluate(() => (window as unknown as { task5Audio: { scheduled: Array<{ when: number; duration: number; at: number }>; downloads: Array<{ turnId: string; aborted: boolean; completed: boolean }>; stopped: number; peak: number } }).task5Audio);
}
async function traces(sessionId: string): Promise<TurnTraceRecord[]> {
  const raw = await readFile(join(cacheDir, "trace.jsonl"), "utf8").catch(() => "");
  return raw.split("\n").filter(Boolean).map(line => JSON.parse(line) as TurnTraceRecord).filter(record => record.sessionId === sessionId);
}

  test('only the owner plays; a second screen failure cannot cut off audio; followup begins at actual drain',async({page,context})=>{
    test.setTimeout(40000);await open(page);await page.mouse.click(40,40);
    const passive=await context.newPage();
    await passive.addInitScript(()=>{
      const Original=WebSocket;
      window.WebSocket=class extends Original{
        constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);Object.assign(window,{diagnosticSocket:this});}
      };
    });
    try{
      await open(passive);await expect.poll(()=>hub.counts().screens).toBe(2);
      normalSeconds=2;ask('本期新增客户有多少家');
      await expect.poll(()=>reports.some(r=>r.type==='playback.started')).toBe(true);
      const id=reports.find(r=>r.type==='playback.started')!.turnId;
      await passive.evaluate(turnId=>{
        const socket=(window as unknown as {diagnosticSocket:WebSocket}).diagnosticSocket;
        socket.send(JSON.stringify({type:'playback.failed',at:Date.now(),turnId,reason:'autoplay_blocked'}));
        socket.send(JSON.stringify({type:'playback.drained',at:Date.now(),turnId}));
      },id);
      await page.waitForTimeout(250);
      expect(orch.state.name).toBe('answering');expect(store.lookup(id)?.cancelled).toBe(false);
      expect((await metrics(passive)).scheduled).toHaveLength(0);
      const sessionId=orch.sessionId;
      await expect.poll(async()=>(await traces(sessionId)).some(r=>r.playbackOutcome==='drained'),{timeout:10000}).toBe(true);
      const trace=(await traces(sessionId))[0];const drainedAt=Date.parse(trace.ts)+trace.playbackEndMs!;expect(orch.state.name).toBe('followup');
      await page.waitForTimeout(500);expect(orch.state.name).toBe('followup');
      await expect(page.getByText('等待追问',{exact:true})).toBeVisible({timeout:4000});
      expect(stateChanges.find(e=>e.to==='followup')!.at-drainedAt).toBeLessThan(100);
      expect((await traces(sessionId))[0]).toMatchObject({playbackOutcome:'drained',playbackScreenCount:2});
      expect((await metrics(passive)).scheduled).toHaveLength(0);
    }finally{await passive.close();}
  });
  test('a suspended real AudioContext keeps the answer without followup; a click enables the next turn',async({page})=>{
    test.setTimeout(30000);
    // CDP operations may activate a page even with the normal browser policy.
    // Hold the native context suspended until a real pointer event instead.
    await page.addInitScript(()=>{
      let allowed=false;window.addEventListener('pointerdown',()=>{allowed=true;},{capture:true});
      const Original=AudioContext;window.AudioContext=class extends Original{
        constructor(options?:AudioContextOptions){super(options);void super.suspend();}
        resume():Promise<void>{return allowed?super.resume():new Promise(resolve=>window.addEventListener('pointerdown',()=>{void super.resume().then(resolve);},{once:true}));}
      };
    });
    await open(page);ask('本期新增客户有多少家');
    await expect.poll(()=>reports.some(r=>r.type==='playback.failed'&&r.reason==='autoplay_blocked')).toBe(true);
    expect(orch.state.name).toBe('answering');
    await expect(page.locator('.overlay-card')).toBeVisible();
    await expect(page.getByText('请点击屏幕启用声音；本次回答请查看卡片，随后重新唤醒。',{exact:true})).toBeVisible();
    await expect(page.getByText('等待追问',{exact:true})).toHaveCount(0);
    await expect.poll(()=>orch.state.name,{timeout:12000}).toBe('ambient');
    await page.mouse.click(40,40);reports.length=0;ask('谢谢，没有了');
    await expect.poll(()=>reports.some(r=>r.type==='playback.started')).toBe(true);
    await expect.poll(()=>reports.some(r=>r.type==='playback.drained')).toBe(true);
    expect(reports.some(r=>r.type==='playback.failed')).toBe(false);
  });
