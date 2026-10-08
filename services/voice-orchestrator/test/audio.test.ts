import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VoiceLocalClient, type SpeechClient, type TtsChunk } from "../src/tts/voice-local-client.ts";
import { AudioStore } from "../src/tts/audio-store.ts";
import { createAudioHttpHandler } from "../src/tts/http-audio.ts";
import { startVoiceHub, type VoiceHubServer } from "../src/ws/ws-server.ts";
import { buildSpokenSentences } from "../../../src/lib/voice/spoken-normalize.ts";
import { playbackFallbackMs } from "../../../src/lib/voice/playback-timing.ts";
import { createVoiceOrchestrator, parseConsoleEvent } from "../src/orchestrator.ts";
import { ScriptedAdapter } from "../src/llm/scripted.ts";
import { TraceSink } from "../src/trace/metrics.ts";
import fixture from "../fixtures/public-sales-screen.json";
import { validatePublicPayload } from "../../../src/lib/voice/public-payload.ts";
import type { Intent } from "../../../src/lib/voice/intents.ts";
import type { VoiceWireEvent } from "../../../src/lib/voice/protocol.ts";
import { LAUNCH } from "../../../src/lib/voice/params.ts";
import { DEMO_TIMING } from "../../../src/lib/voice/demo-script.ts";

const pcm = new Uint8Array(24000); for (let i=0;i<pcm.length;i+=2) { pcm[i]=208;pcm[i+1]=7; }
const zero = { ttsRegenerated: 0, ttsTruncated: 0, ttsFail: 0 };
const directories: string[]=[]; const stores: AudioStore[]=[]; const hubs: VoiceHubServer[]=[];
afterEach(async()=>{vi.useRealTimers();for(const store of stores.splice(0))store.close();for(const hub of hubs.splice(0))await hub.close();for(const dir of directories.splice(0))await rm(dir,{recursive:true,force:true});});
async function setup(client: SpeechClient, extra: Partial<ConstructorParameters<typeof AudioStore>[0]>={}) {
  const cacheDir=await mkdtemp(join(tmpdir(),'voice-cache-'));directories.push(cacheDir);
  const store=new AudioStore({client,cacheDir,enabled:true,...extra});stores.push(store);await store.initialize();return {store,cacheDir};
}
class FakeClient implements SpeechClient {
  calls=0; hash='a'.repeat(64); passed=true;
  health=async()=>({warm:true,selfCheck:this.passed?'passed' as const:'failed' as const,refHash:this.hash,styles:['default']});
  asr=async()=>({text:'本月销售情况',ms:1});
  async *tts(_text:string,_style:string,signal?:AbortSignal):AsyncIterable<TtsChunk> {
    signal?.throwIfAborted();this.calls++;yield {type:'audio',pcm,sampleRate:24000};yield {type:'done',metrics:zero};
  }
}
async function http(store: AudioStore) {
  const hub=await startVoiceHub({host:'127.0.0.1',port:0,onMessage:()=>{},onHttpRequest:createAudioHttpHandler({store,consoleToken:'console',screenToken:'screen'})});hubs.push(hub);
  const url=`http://127.0.0.1:${hub.port}`;
  return (path:string,init:RequestInit={})=>fetch(url+path,{...init,headers:{authorization:'Bearer screen',...init.headers}});
}

function orchestrator(store: AudioStore, intent: Intent, screens = 1, trace = new TraceSink(null)) {
  const events: VoiceWireEvent[] = [];
  const llm = new ScriptedAdapter();
  vi.spyOn(llm, 'classify').mockResolvedValue(intent);
  const orch = createVoiceOrchestrator({
    hub: { broadcast: (e: VoiceWireEvent) => events.push(e), counts: () => ({ screens, consoles: 1 }) } as unknown as VoiceHubServer,
    audio: store, dataSource: { name: 'test', fetchPayload: async () => validatePublicPayload(fixture)! }, llm,
    mcp: null, trace, llmTimeoutMs: 8000, partialPaceMs: 1, partialMaxTotalMs: 1,
    prefetchTimeoutMs: 5000, questionMinGapMs: 0, questionWindowMs: 60000, questionWindowMax: 100, mcpToolWhitelist: [],
  });
  orch.handleClientMessage({ id: 'test', role: 'console', send: () => {}, close: () => {} }, JSON.stringify({ type: 'question.submit', at: Date.now(), text: '谢谢，没有了' }));
  return { orch, events, setScreens: (value: number) => { screens = value; }, full: () => events.find(e => e.type === 'answer.delta' && e.full) as Extract<VoiceWireEvent, { type: 'answer.delta' }> };
}

describe('voice-local HTTP client',()=>{
  it('carries odd byte splits and reports real first bytes',async()=>{
    const mock=vi.fn(async(url: string|URL|Request)=>String(url).includes('/jobs/')?Response.json(zero):new Response(new ReadableStream({start(c){for(const bytes of [[1],[2,3],[4,5,6]])c.enqueue(new Uint8Array(bytes));c.close();}}),{headers:{'content-type':'audio/pcm','x-sample-rate':'24000','x-channels':'1','x-sample-format':'s16le','x-voice-job-id':'a'.repeat(32)}}));
    const client=new VoiceLocalClient('http://127.0.0.1:8810',mock as typeof fetch);
    const chunks=[];for await(const chunk of client.tts('测试','default'))chunks.push(chunk);
    expect(Buffer.concat(chunks.filter(c=>c.type==='audio').map(c=>c.pcm))).toEqual(Buffer.from([1,2,3,4,5,6]));
    expect(chunks.at(-1)).toMatchObject({type:'done',metrics:zero});
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it('rejects a dangling half sample and cancels the reader',async()=>{
    const mock=vi.fn(async()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'audio/pcm','x-sample-rate':'24000','x-channels':'1','x-sample-format':'s16le','x-voice-job-id':'a'.repeat(32)}}));
    const client=new VoiceLocalClient('http://localhost:8810',mock as typeof fetch);
    await expect((async()=>{for await(const chunk of client.tts('测试','default'))void chunk;})()).rejects.toThrow('Incomplete PCM');
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('keeps queue time separate from ASR execution and rejects invalid timing',async()=>{
    const client=new VoiceLocalClient('http://127.0.0.1',async()=>Response.json({text:'问题',ms:200,asrQueueMs:15,interleavedTts:true}));
    expect(await client.asr(new Uint8Array(3200))).toMatchObject({ms:200,asrQueueMs:15,interleavedTts:true});
    for(const fields of [{asrQueueMs:-1},{interleavedTts:'yes'}]){
      const invalid=new VoiceLocalClient('http://127.0.0.1',async()=>Response.json({text:'问题',ms:200,...fields}));
      await expect(invalid.asr(new Uint8Array(3200))).rejects.toThrow('Invalid ASR');
    }
  });
  it('rejects remote endpoints, unaligned/oversized ASR, and invalid health',async()=>{
    expect(()=>new VoiceLocalClient('https://example.com')).toThrow('loopback');
    const client=new VoiceLocalClient('http://127.0.0.1',async()=>Response.json({warm:true}) as Response);
    await expect(client.asr(new Uint8Array(3))).rejects.toThrow('aligned');
    await expect(client.asr(new Uint8Array(480002))).rejects.toThrow('aligned');
    await expect(client.health()).rejects.toThrow('Invalid');
  });
});

describe('audio cache, stream, cancellation and lifecycle',()=>{
  it('no-screen answers use text pacing and keep synthesis and cached audio alive', async () => {
    const { store } = await setup(new FakeClient()); vi.useFakeTimers();
    const { orch, full } = orchestrator(store, 'sales_progress', 0); await vi.advanceTimersByTimeAsync(1100);
    const card = full(); const id = card.speech!.turnId;
    const textMs = LAUNCH.unfoldStartMs + LAUNCH.unfoldMs + card.card!.spoken.length / LAUNCH.typeCps * 1000 + DEMO_TIMING.answerHoldMs;
    expect(textMs).toBeLessThan(playbackFallbackMs(card.card!.spoken));
    await vi.advanceTimersByTimeAsync(Math.ceil(textMs - (Date.now() - card.at)) + 8000);
    expect(orch.state.name).toBe('followup'); expect(store.lookup(id)?.cancelled).toBe(false);
    expect(store.lookup(id)?.sentences.every(s => s.state === 'done')).toBe(true); orch.forceClose('force');
  });
  it('the last screen disconnect drains the wait without cancelling ongoing synthesis', async () => {
    const client = new FakeClient(); const { store } = await setup(client);
    let release!: () => void; const gate = new Promise<void>(r => release = r);
    client.tts = async function* (_text, _style, signal) { yield { type: 'audio', pcm, sampleRate: 24000 }; await gate; signal?.throwIfAborted(); yield { type: 'done', metrics: zero }; };
    const trace = new TraceSink(null); const append = vi.spyOn(trace, 'append'); vi.useFakeTimers();
    const { orch, full, setScreens } = orchestrator(store, 'sales_progress', 2, trace); await vi.advanceTimersByTimeAsync(1100);
    const id = full().speech!.turnId;
    const screen = { id: 'screen', role: 'screen' as const, send: () => {}, close: () => {} };
    setScreens(1); orch.detach(screen); expect(orch.state.name).toBe('answering');
    setScreens(0); orch.detach({ ...screen, role: 'console' }); expect(orch.state.name).toBe('answering');
    orch.detach(screen); expect(orch.state.name).toBe('followup'); expect(store.lookup(id)?.controller.signal.aborted).toBe(false);
    expect(append).not.toHaveBeenCalled(); orch.detach(screen);
    release(); await store.lookup(id)!.completed;
    expect(append).toHaveBeenCalledOnce(); expect(append.mock.calls[0][0].playbackOutcome).toBe('drained');
    await vi.advanceTimersByTimeAsync(8000 + 4999); expect(orch.state.name).toBe('followup');
    await vi.advanceTimersByTimeAsync(1); expect(orch.state.name).toBe('closing'); expect(store.lookup(id)?.cancelled).toBe(false); orch.forceClose('force');
  });
  it.each(['answering', 'followup'])('current screen dismissal closes %s and rejects other roles and stale turns', async (phase) => {
    const { store } = await setup(new FakeClient()); const trace = new TraceSink(null); const append = vi.spyOn(trace, 'append'); vi.useFakeTimers();
    const { orch, full, events } = orchestrator(store, 'sales_progress', 1, trace); await vi.advanceTimersByTimeAsync(1100);
    const id = full().speech!.turnId;
    const send = (reason: string, role = 'screen', turnId = id) => orch.handleClientMessage({ id: 'report', role: role as 'screen' | 'console' | 'unknown', send: () => {}, close: () => {} }, JSON.stringify({ type: 'playback.failed', at: Date.now(), turnId, reason }));
    if (phase === 'followup') { orch.handleClientMessage({ id: 'screen', role: 'screen', send: () => {}, close: () => {} }, JSON.stringify({ type: 'playback.drained', at: Date.now(), turnId: id })); await vi.advanceTimersByTimeAsync(8000); }
    send('dismissed', 'console'); send('dismissed', 'unknown'); send('dismissed', 'screen', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    expect(orch.state.name).toBe(phase);
    send('dismissed'); expect(orch.state.name).toBe('closing'); expect(store.lookup(id)?.cancelled).toBe(true);
    expect(append).toHaveBeenCalledOnce(); expect(append.mock.calls[0][0].playbackOutcome).toBe(phase === 'answering' ? 'cancelled' : 'drained');
    send('dismissed'); expect(events.filter(e => e.type === 'session.end' && e.reason === 'force')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000); expect(orch.state.name).toBe('ambient');
  });
  it('skipped sentence reports are bounded, current-screen-only, deduplicated and persisted with drained once', async () => {
    const { store } = await setup(new FakeClient()); const trace = new TraceSink(null); const append = vi.spyOn(trace, 'append'); vi.useFakeTimers();
    const { orch, full, events } = orchestrator(store, 'sales_progress', 1, trace); await vi.advanceTimersByTimeAsync(1100);
    const id = full().speech!.turnId;
    const report = (sentenceIndex: number, role = 'screen', turnId = id) => orch.handleClientMessage({ id: 'report', role: role as 'screen' | 'console', send: () => {}, close: () => {} }, JSON.stringify({ type: 'playback.skipped', at: Date.now(), turnId, sentenceIndex, reason: 'audio_unavailable' }));
    report(0, 'console'); report(0, 'screen', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'); report(full().speech!.sentences.length);
    expect(events.some(e => e.type === 'trace.turn' && e.trace.playbackSkipped)).toBe(false);
    report(0); report(0);
    orch.handleClientMessage({ id: 'screen', role: 'screen', send: () => {}, close: () => {} }, JSON.stringify({ type: 'playback.drained', at: Date.now(), turnId: id }));
    report(1); expect(append).toHaveBeenCalledOnce(); expect(append.mock.calls[0][0]).toMatchObject({ playbackOutcome: 'drained', playbackSkipped: [{ sentenceIndex: 0, reason: 'audio_unavailable' }] });
    orch.forceClose('force');
  });
  it('goodbye is cached, fetchable after decline, and waits for the current screen playback', async () => {
    const client = new FakeClient(); const { store } = await setup(client); const get = await http(store);
    vi.useFakeTimers(); const { orch, events, full } = orchestrator(store, 'chitchat_or_end');
    await vi.advanceTimersByTimeAsync(1100);
    const speech = full().speech!;
    expect(speech.fixed).toBe('goodbye'); expect(client.calls).toBe(6); expect(orch.state.name).toBe('answering');
    const report = (role: 'screen' | 'console' | 'unknown', turnId = speech.turnId) => orch.handleClientMessage({ id: 'report', role, send: () => {}, close: () => {} }, JSON.stringify({ type: 'playback.drained', at: Date.now(), turnId }));
    report('unknown'); report('console'); report('screen', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(orch.state.name).toBe('answering');
    report('screen'); expect(orch.state.name).toBe('closing');
    expect(events.filter(e => e.type === 'session.end' && e.reason === 'decline')).toHaveLength(1);
    expect(store.lookup(speech.turnId)?.cancelled).toBe(false);
    await vi.advanceTimersByTimeAsync(10000); expect(orch.state.name).toBe('ambient');
    vi.useRealTimers();
    const response = await get(`/voice/audio/${speech.turnId}/0`);
    expect(response.status).toBe(200); expect(new Uint8Array(await response.arrayBuffer())).toEqual(pcm);
    orch.forceClose('force'); expect((await get(`/voice/audio/${speech.turnId}/0`)).status).toBe(410);
  });
  it('goodbye timeout holds the card then closes with error and cancelling and stale playback cannot close a newer turn', async () => {
    const { store } = await setup(new FakeClient()); vi.useFakeTimers();
    const { orch, events, full } = orchestrator(store, 'chitchat_or_end'); await vi.advanceTimersByTimeAsync(1100);
    const oldId = full().speech!.turnId;
    orch.handleClientMessage({ id: 'test', role: 'console', send: () => {}, close: () => {} }, JSON.stringify({ type: 'question.submit', at: Date.now(), text: '谢谢' }));
    await vi.advanceTimersByTimeAsync(150);
    orch.handleClientMessage({ id: 'screen', role: 'screen', send: () => {}, close: () => {} }, JSON.stringify({ type: 'playback.drained', at: Date.now(), turnId: oldId }));
    expect(orch.state.name).toBe('answering'); expect(store.lookup(oldId)?.cancelled).toBe(true);
    const latest = events.filter(e => e.type === 'answer.delta' && e.full).at(-1) as Extract<VoiceWireEvent, { type: 'answer.delta' }>;
    await vi.advanceTimersByTimeAsync(4000); expect(orch.state.name).toBe('answering');
    await vi.advanceTimersByTimeAsync(9000); expect(orch.state.name).toBe('ambient');
    expect(events.some(e => e.type === 'session.end' && e.reason === 'error')).toBe(true);
    expect(store.lookup(latest.speech!.turnId)?.cancelled).toBe(true);
    orch.forceClose('force');
  });
  it('followup timeout preserves answer audio until force-close, supersession or TTL', async () => {
    const { store } = await setup(new FakeClient()); vi.useFakeTimers();
    const { orch, events, full } = orchestrator(store, 'sales_progress'); await vi.advanceTimersByTimeAsync(3000);
    const id = full().speech!.turnId;
    orch.handleClientMessage({ id: 'screen', role: 'screen', send: () => {}, close: () => {} }, JSON.stringify({ type: 'playback.drained', at: Date.now(), turnId: id }));
    await vi.advanceTimersByTimeAsync(30000);
    expect(events.some(e => e.type === 'session.end' && e.reason === 'followup_timeout')).toBe(true);
    expect(store.lookup(id)?.cancelled).toBe(false); expect(store.lookup(id)?.sentences[0].bytes).toBeGreaterThan(0);
    orch.forceClose('force'); expect(store.lookup(id)?.cancelled).toBe(true);
  });
  it('ordinary answer stays answering past typing completion and accepts only current screen playback reports', async () => {
    const { store } = await setup(new FakeClient()); vi.useFakeTimers();
    const { orch, events, full } = orchestrator(store, 'sales_progress'); await vi.advanceTimersByTimeAsync(12000);
    const id = full().speech!.turnId; expect(orch.state.name).toBe('answering');
    const report = (type: string, role: 'screen' | 'console' | 'unknown' = 'screen', turnId = id) => orch.handleClientMessage({ id: 'screen', role, send: () => {}, close: () => {} }, JSON.stringify({ type, at: Date.now(), turnId }));
    report('playback.started', 'console'); report('playback.drained', 'unknown'); report('playback.drained', 'screen', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    expect(orch.state.name).toBe('answering');
    report('playback.started'); const first = events.filter(e => e.type === 'trace.turn').at(-1) as Extract<VoiceWireEvent, { type: 'trace.turn' }>;
    expect(first.trace.playbackStartMs).toBeGreaterThan(0);
    const count = events.filter(e => e.type === 'trace.turn').length; report('playback.started'); expect(events.filter(e => e.type === 'trace.turn')).toHaveLength(count);
    report('playback.drained'); expect(orch.state.name).toBe('followup'); report('playback.drained');
    await vi.advanceTimersByTimeAsync(8000 + 4999); expect(orch.state.name).toBe('followup');
    await vi.advanceTimersByTimeAsync(1); expect(orch.state.name).toBe('closing'); expect(store.lookup(id)?.cancelled).toBe(false);
    orch.forceClose('force');
  });
  it('supersession rejects stale started/drained/failed events and a missing ack hits the audio guard', async () => {
    const { store } = await setup(new FakeClient()); vi.useFakeTimers();
    const { orch, events, full } = orchestrator(store, 'sales_progress'); await vi.advanceTimersByTimeAsync(1100);
    const old = full().speech!.turnId;
    orch.handleClientMessage({ id:'console', role:'console', send:()=>{}, close:()=>{} }, JSON.stringify({type:'question.submit',at:Date.now(),text:'本月销售情况'}));
    await vi.advanceTimersByTimeAsync(200);
    const latest = events.filter(e => e.type === 'answer.delta' && e.full).at(-1) as Extract<VoiceWireEvent,{type:'answer.delta'}>;
    for (const type of ['playback.started','playback.drained','playback.failed','playback.skipped']) orch.handleClientMessage({id:'screen',role:'screen',send:()=>{},close:()=>{}},JSON.stringify({type,at:Date.now(),turnId:old,reason:'audio_interrupted',sentenceIndex:0}));
    orch.handleClientMessage({id:'screen',role:'screen',send:()=>{},close:()=>{}},JSON.stringify({type:'playback.failed',at:Date.now(),turnId:old,reason:'dismissed'}));
    expect(orch.state.name).toBe('answering'); expect(store.lookup(old)?.cancelled).toBe(true);
    await vi.advanceTimersByTimeAsync(playbackFallbackMs(latest.card!.spoken)); expect(orch.state.name).toBe('answering');
    expect(store.lookup(latest.speech!.turnId)?.cancelled).toBe(true);
    expect((events.filter(e => e.type==='trace.turn').at(-1) as Extract<VoiceWireEvent,{type:'trace.turn'}>).trace.playbackOutcome).toBe('timeout');
    orch.forceClose('force');
  });
  it('fails closed for malformed playback reports', () => {
    for (const report of [{type:'playback.failed',reason:'made_up'}, {type:'playback.started',at:Infinity}, {type:'playback.drained',turnId:'bad'}, ...[-1, 100, 0.5].map(sentenceIndex => ({type:'playback.skipped',sentenceIndex,reason:'audio_unavailable'})), {type:'playback.skipped',sentenceIndex:0,reason:'dismissed'}]) {
      expect(parseConsoleEvent(JSON.stringify({at:1,turnId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',...report}))).toBeNull();
    }
  });
  it('a failure after HTTP headers resets the body instead of returning a successful partial sentence', async () => {
    const client = new FakeClient(); const { store } = await setup(client); const get = await http(store);
    let release!: () => void; const gate = new Promise<void>(r => release = r);
    client.tts = async function* () { yield {type:'audio',pcm,sampleRate:24000}; await gate; yield {type:'done',metrics:{...zero,ttsTruncated:1}}; };
    const turn = store.start(buildSpokenSentences('回答。'))!;
    const res = await get(`/voice/audio/${turn.id}/0`); const reader = res.body!.getReader(); expect((await reader.read()).value!.length).toBe(pcm.length);
    release(); await turn.completed; await expect(reader.read()).rejects.toThrow(); expect(turn.sentences[0].state).toBe('failed');
  });
  it('polling recovers late startup and outages, and refreshes changed references once', async () => {
    vi.useFakeTimers(); const client = new FakeClient(); client.passed = false;
    const health = vi.spyOn(client, 'health'); const { store } = await setup(client, { healthIntervalMs: 100 });
    client.passed = true; await vi.advanceTimersByTimeAsync(100); await store.initialize();
    expect(store.ready).toBe(true); expect(client.calls).toBe(6);
    await vi.advanceTimersByTimeAsync(100); await store.initialize(); expect(client.calls).toBe(6);
    const old = store.startFixed('goodbye', buildSpokenSentences('为您服务是我的荣幸,先生。'))!; await old.completed;
    client.hash = 'b'.repeat(64); await vi.advanceTimersByTimeAsync(100); await Promise.all([store.initialize(), store.initialize()]);
    expect(client.calls).toBe(12); expect(old.cancelled).toBe(true);
    client.passed = false; await vi.advanceTimersByTimeAsync(100); await store.initialize(); expect(store.ready).toBe(false); expect(store.fixed('goodbye')).toBeNull();
    client.passed = true; await vi.advanceTimersByTimeAsync(100); await store.initialize(); expect(store.ready).toBe(true); expect(client.calls).toBe(12);
    store.close(); const count = health.mock.calls.length; await vi.advanceTimersByTimeAsync(500); await store.initialize(); expect(health).toHaveBeenCalledTimes(count);
  });
  it('coalesces health checks and cannot become ready after close during initialization', async () => {
    const client = new FakeClient(); let resolve!: (value: Awaited<ReturnType<FakeClient['health']>>) => void;
    const health = vi.spyOn(client, 'health').mockImplementation(() => new Promise(r => { resolve = r; }));
    const dir = await mkdtemp(join(tmpdir(), 'voice-cache-')); directories.push(dir);
    const store = new AudioStore({ client, cacheDir: dir, enabled: true }); stores.push(store);
    const first = store.initialize(); const second = store.initialize(); expect(health).toHaveBeenCalledOnce();
    store.close(); resolve({ warm: true, selfCheck: 'passed', refHash: client.hash, styles: ['default'] }); await Promise.all([first, second]);
    expect(store.ready).toBe(false); expect(store.status.reason).toBe('closed'); expect(client.calls).toBe(0);
  });
  it('fixed lines use disk cache; reference change invalidates all six',async()=>{
    const client=new FakeClient();const {store,cacheDir}=await setup(client);expect(client.calls).toBe(6);
    const get=await http(store);expect((await get('/voice/audio/fixed/wake')).status).toBe(200);expect(client.calls).toBe(6);
    const second=new AudioStore({client,cacheDir,enabled:true});stores.push(second);await second.initialize();expect(client.calls).toBe(6);
    client.hash='b'.repeat(64);const third=new AudioStore({client,cacheDir,enabled:true});stores.push(third);await third.initialize();expect(client.calls).toBe(12);
  });
  it('requires bearer and shared Origin policy on all voice routes',async()=>{
    const {store}=await setup(new FakeClient());const get=await http(store);
    expect((await get('/voice/health',{headers:{authorization:''}})).status).toBe(401);
    expect((await get('/voice/health',{headers:{origin:'https://evil.test'}})).status).toBe(403);
    expect((await get('/voice/health',{headers:{origin:'http://localhost:3015',authorization:'Bearer console'}})).status).toBe(200);
    expect((await get('/voice/health',{method:'POST'})).status).toBe(405);
    const preflight=await get('/voice/audio/fixed/wake',{method:'OPTIONS',headers:{authorization:'',origin:'http://localhost:3015','access-control-request-method':'GET','access-control-request-headers':'authorization'}});
    expect(preflight.status).toBe(204);expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:3015');
    expect((await get('/voice/audio/fixed/wake',{headers:{authorization:'',origin:'http://localhost:3015'}})).status).toBe(401);
    expect((await get('/voice/audio/fixed/wake',{method:'OPTIONS',headers:{authorization:'',origin:'https://evil.test','access-control-request-method':'GET'}})).status).toBe(403);
  });
  it('streams buffered PCM, cancels superseded turns, and returns 410',async()=>{
    const {store}=await setup(new FakeClient());const get=await http(store);
    const old=store.start(buildSpokenSentences('第一句。'))!;await old.completed;
    expect(new Uint8Array(await (await get(`/voice/audio/${old.id}/0`)).arrayBuffer())).toEqual(pcm);
    const latest=store.start(buildSpokenSentences('第二句。'))!;
    expect(old.controller.signal.aborted).toBe(true);
    expect((await get(`/voice/audio/${old.id}/0`)).status).toBe(410);
    store.cancel(latest.id);expect((await get(`/voice/audio/${latest.id}/0`)).status).toBe(410);
  });
  it('serves buffered then live data and terminates an already open stream on cancel',async()=>{
    const client=new FakeClient();const {store}=await setup(client);const get=await http(store);
    let release!:()=>void;const gate=new Promise<void>(r=>release=r);
    client.tts=async function*(_text,_style,signal){yield {type:'audio',pcm,sampleRate:24000};await Promise.race([gate,new Promise<void>(r=>signal?.addEventListener('abort',()=>r(),{once:true}))]);signal?.throwIfAborted();yield {type:'audio',pcm,sampleRate:24000};yield {type:'done',metrics:zero};};
    const turn=store.start(buildSpokenSentences('测试。'))!;
    const response=await get(`/voice/audio/${turn.id}/0`);const reader=response.body!.getReader();expect((await reader.read()).value!.length).toBe(pcm.length);
    store.cancel(turn.id);await expect(reader.read()).rejects.toThrow();release();await turn.completed;
    expect((await get(`/voice/audio/${turn.id}/0`)).status).toBe(410);
  });
  it('continues after failed and truncated sentences, with aggregate traces',async()=>{
    const client=new FakeClient();const {store}=await setup(client);let sentence=0;
    client.tts=async function*(){sentence++;if(sentence===1)throw Error('injected');yield {type:'audio',pcm,sampleRate:24000};yield {type:'done',metrics:{...zero,ttsRegenerated:sentence===2?1:0,ttsTruncated:sentence===2?1:0}};};
    const turn=store.start(buildSpokenSentences('第一句。第二句。第三句。'))!;await turn.completed;
    expect(turn.sentences.map(s=>s.state)).toEqual(['failed','failed','done']);expect(turn.metrics).toMatchObject({ttsRegenerated:1,ttsTruncated:1,ttsFail:1});
    const get=await http(store);expect((await get(`/voice/audio/${turn.id}/0`)).status).toBe(503);expect((await get(`/voice/audio/${turn.id}/1`)).status).toBe(503);
  });
  it('mutes failed startup and performs no health request when disabled',async()=>{
    const client=new FakeClient();client.passed=false;const warn=vi.fn();const {store}=await setup(client,{warn});expect(store.ready).toBe(false);expect(warn).toHaveBeenCalledOnce();expect(store.start(buildSpokenSentences('卡片正常。'))).toBeNull();
    const health=vi.spyOn(client,'health');await setup(client,{enabled:false});expect(health).not.toHaveBeenCalled();
  });
  it('expires turns and bounds retained PCM',async()=>{
    const {store}=await setup(new FakeClient(),{maxTurnBytes:100,ttlMs:50});const turn=store.start(buildSpokenSentences('测试。'))!;await turn.completed;
    expect(turn.sentences[0].chunks).toHaveLength(0);expect(turn.metrics.ttsFail).toBe(1);
    await new Promise(r=>setTimeout(r,60));expect(store.lookup(turn.id)).toBeNull();expect(turn.controller.signal.aborted).toBe(true);
  });
  it('audio faults leave the card readable without a followup on browser failure; trace includes outcome once',async()=>{
    const client=new FakeClient();const {store}=await setup(client);let n=0;
    client.tts=async function*(){n++;if(n===1)throw Error('silent');yield {type:'audio',pcm,sampleRate:24000};yield {type:'done',metrics:{...zero,ttsRegenerated:1,ttsTruncated:1}};};
    vi.useFakeTimers();const events:unknown[]=[];const sink=new TraceSink(null);const append=vi.spyOn(sink,'append');
    const orch=createVoiceOrchestrator({hub:{broadcast:(e:unknown)=>events.push(structuredClone(e)),counts:()=>({screens:1,consoles:1})} as unknown as VoiceHubServer,audio:store,dataSource:{name:'test',fetchPayload:async()=>validatePublicPayload(fixture)!},llm:new ScriptedAdapter(),mcp:null,trace:sink,llmTimeoutMs:8000,partialPaceMs:1,partialMaxTotalMs:1,prefetchTimeoutMs:5000,questionMinGapMs:0,questionWindowMs:60000,questionWindowMax:100,mcpToolWhitelist:[]});
    orch.handleClientMessage({id:'test',role:'console',send:()=>{},close:()=>{}},JSON.stringify({type:'question.submit',at:Date.now(),text:'本月销售情况怎么样'}));
    await vi.advanceTimersByTimeAsync(3000);expect(orch.state.name).toBe('answering');
    const full=events.find(e=>(e as {type:string;full:boolean}).type==='answer.delta'&&(e as {full:boolean}).full) as {speech:{turnId:string}};expect(full.speech.turnId).toBeTruthy();
    expect(append).not.toHaveBeenCalled();
    orch.handleClientMessage({id:'screen',role:'screen',send:()=>{},close:()=>{}},JSON.stringify({type:'playback.failed',at:Date.now(),turnId:full.speech.turnId,reason:'audio_unavailable'}));
    expect(append).toHaveBeenCalledOnce();expect(append.mock.calls[0][0]).toMatchObject({ttsFail:1,playbackOutcome:'failed'});
    expect(orch.state.name).toBe('answering');
    expect(append.mock.calls[0][0].playbackFailureReason).toBe('audio_unavailable');
    await vi.advanceTimersByTimeAsync(8000);expect(orch.state.name).toBe('closing');
    expect(events.some(e => (e as VoiceWireEvent).type === 'state.change' && (e as Extract<VoiceWireEvent,{type:'state.change'}>).to === 'followup')).toBe(false);
    orch.forceClose('force');expect(store.lookup(full.speech.turnId)?.cancelled).toBe(true);
  });
});

it('emotion caches invalidate only the changed reference and absent styles fall back to default',async()=>{
  const hashes:Record<string,string>={default:'a'.repeat(64),cheerful:'b'.repeat(64),warm:'c'.repeat(64),apologetic:'d'.repeat(64)};
  const calls:string[]=[];
  const client:SpeechClient={health:async()=>({warm:true,selfCheck:'passed',styles:Object.keys(hashes),refHash:hashes.default,styleHashes:{...hashes}}),asr:async()=>({text:'',ms:0}),tts:async function*(_text,style){calls.push(style);yield {type:'audio',pcm,sampleRate:24000};yield {type:'done',metrics:zero};}};
  const {store}=await setup(client);
  expect(calls).toEqual(['cheerful','warm','warm','apologetic','apologetic','warm']);
  hashes.apologetic='e'.repeat(64);await store.initialize();
  expect(calls.slice(6)).toEqual(['apologetic','apologetic']);
  const turn=store.start(buildSpokenSentences('先生,本月销售情况正常。'),undefined,'serious_long')!;
  await turn.completed;expect(turn.descriptor.style).toBe('default');expect(calls.at(-1)).toBe('default');
});
it('runtime style failure falls back for the whole turn only before any audible byte',async()=>{
  const calls:string[]=[];
  const client:SpeechClient={health:async()=>({warm:true,selfCheck:'passed',styles:['default','serious_long'],refHash:'a'.repeat(64)}),asr:async()=>({text:'',ms:0}),tts:async function*(_text,style){calls.push(style);if(style==='serious_long')throw new Error('silent reference');yield {type:'audio',pcm,sampleRate:24000};yield {type:'done',metrics:zero};}};
  const {store}=await setup(client);calls.length=0;
  const turn=store.start(buildSpokenSentences('先生,有待办。请及时跟进。'),undefined,'serious_long')!;
  await turn.completed;expect(calls).toEqual(['serious_long','default','default']);expect(turn.descriptor.style).toBe('default');expect(turn.metrics.styleFallback).toBe('serious_long');expect(turn.sentences.every(s=>s.state==='done')).toBe(true);
});
it('a failed emotional fixed line uses a separate default cache without muting healthy speech',async()=>{
  const calls:string[]=[];const warn=vi.fn();
  const client:SpeechClient={health:async()=>({warm:true,selfCheck:'passed',styles:['default','warm'],refHash:'a'.repeat(64),styleHashes:{default:'a'.repeat(64),warm:'b'.repeat(64)}}),asr:async()=>({text:'',ms:0}),tts:async function*(_text,style){calls.push(style);if(style==='warm')throw new Error('short emotional speech failed');yield {type:'audio',pcm,sampleRate:24000};yield {type:'done',metrics:zero};}};
  const {store}=await setup(client,{warn});expect(store.ready).toBe(true);
  const goodbye=store.startFixed('goodbye',buildSpokenSentences('先生,再见。'))!;
  expect(goodbye.descriptor.style).toBe('default');expect(store.fixedStyle('followup')).toBe('default');expect(warn).toHaveBeenCalledTimes(3);
  const count=calls.length;await store.initialize();expect(calls).toHaveLength(count);
});
