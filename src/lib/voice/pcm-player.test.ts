import { afterEach, describe, expect, it, vi } from "vitest";
import { audioBaseUrl, PcmPlayer, type Speech } from "./pcm-player";
import { VoiceMicrophone } from "./microphone";
import { playbackFallbackMs } from "./playback-timing";

const players: PcmPlayer[] = [];
afterEach(async () => { for (const p of players.splice(0)) await p.close(); vi.useRealTimers(); });
const speech: Speech = { turnId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", sentences: [{ index: 0, displayStart: 0, displayEnd: 3 }, { index: 1, displayStart: 3, displayEnd: 6 }] };
const one = { ...speech, sentences: speech.sentences.slice(0, 1) };
const headers = { "content-type": "audio/pcm", "x-sample-rate": "24000", "x-channels": "1", "x-sample-format": "s16le" };
function pcm(samples = 2400, value = 8192) {
  const bytes = new Uint8Array(samples * 2); const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples; i++) view.setInt16(i * 2, value, true);
  return bytes;
}
function response(bytes = pcm()) { return new Response(bytes, { headers }); }
class ClockContext {
  currentTime = 0; state = "running"; destination = {}; fftSize = 512;
  nodes: Array<{ buffer: { duration: number; data: Float32Array } | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; onended: (() => void) | null }> = [];
  resume = vi.fn(async () => {}); close = vi.fn(async () => { this.state = "closed"; });
  createAnalyser = vi.fn(() => ({ fftSize: 512, connect: vi.fn(), disconnect: vi.fn(), getFloatTimeDomainData: (data: Float32Array) => data.fill(0.125) }));
  createBuffer(_channels: number, length: number, rate: number) { const data = new Float32Array(length); return { duration: length / rate, data, getChannelData: () => data }; }
  createBufferSource() {
    const node = { buffer: null as { duration: number; data: Float32Array } | null, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), onended: null as (() => void) | null };
    this.nodes.push(node); return node;
  }
}
function setup(request: typeof fetch, options: { maxBytes?: number; onActive?: () => void; onIdle?: (latency: number) => void } = {}) {
  vi.useFakeTimers(); const ctx = new ClockContext();
  const player = new PcmPlayer({ createContext: () => ctx as unknown as AudioContext, fetch: request, ...options }); players.push(player);
  const started = vi.fn(); const drained = vi.fn(); const error = vi.fn(); const skipped = vi.fn();
  return { ctx, player, started, drained, error, skipped, play: (s = speech, timeout = 5000) => player.play(s, "https://hub.test", "secret", { onSentenceStart: started, onDrained: drained, onError: error, onSentenceSkipped: skipped }, timeout) };
}
async function flush() { for (let i = 0; i < 50; i++) await Promise.resolve(); }

describe("PCM streaming timeline", () => {
  it("prebuffers 150ms, joins sources, prefetches next, and uses audio clock for boundaries and drained", async () => {
    const request = vi.fn(async () => response()); const s = setup(request); s.play(); await flush();
    expect(request.mock.calls).toHaveLength(2);
    expect(request.mock.calls[0]).toMatchObject([expect.stringContaining("/0"), { headers: { authorization: "Bearer secret" } }]);
    expect(s.ctx.nodes[0].start).toHaveBeenCalledWith(0.15);
    expect(s.ctx.nodes[1].start).toHaveBeenCalledWith(0.2);
    expect(s.ctx.nodes[2].start).toHaveBeenCalledWith(0.25);
    expect(s.ctx.nodes.every(n => n.connect.mock.calls[0][0] === s.ctx.nodes[0].connect.mock.calls[0][0])).toBe(true);
    expect(s.ctx.nodes[0].buffer!.data[0]).toBe(0.25);
    await vi.advanceTimersByTimeAsync(1000); expect(s.started).not.toHaveBeenCalled(); expect(s.drained).not.toHaveBeenCalled();
    s.ctx.currentTime = 0.15; await vi.advanceTimersByTimeAsync(10); expect(s.started).toHaveBeenLastCalledWith(0, 0.15);
    expect(s.player.getAmplitude()).toBe(0.5);
    s.ctx.currentTime = 0.25; await vi.advanceTimersByTimeAsync(10); expect(s.started).toHaveBeenLastCalledWith(1, 0.25);
    s.ctx.currentTime = 0.349; await vi.advanceTimersByTimeAsync(10); expect(s.drained).not.toHaveBeenCalled();
    s.ctx.currentTime = 0.351; await vi.advanceTimersByTimeAsync(10); expect(s.drained).toHaveBeenCalledOnce(); expect(s.player.getAmplitude()).toBe(0);
    expect(s.error).not.toHaveBeenCalled();
  });
  it("does not drain before stream EOF even if scheduled queue is empty; resumes after underrun", async () => {
    let input!: ReadableStreamDefaultController<Uint8Array>;
    const s = setup(vi.fn(async () => new Response(new ReadableStream({ start(c) { input = c; c.enqueue(pcm()); } }), { headers }))); s.play(one); await flush();
    s.ctx.currentTime = 0.4; await vi.advanceTimersByTimeAsync(10);
    expect(s.drained).not.toHaveBeenCalled(); input.enqueue(pcm()); input.close(); await flush();
    expect(s.ctx.nodes[2].start).toHaveBeenCalledWith(0.55);
    s.ctx.currentTime = 0.66; await vi.advanceTimersByTimeAsync(10);
    expect(s.drained).toHaveBeenCalledOnce(); expect(s.started).toHaveBeenCalledOnce();
  });
  it("carries arbitrary half samples, including signed PCM", async () => {
    const bytes = new Uint8Array([0, 128, 255, 127, 0, 0, 0, 64]);
    const s = setup(vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 1)); c.enqueue(bytes.slice(1, 5)); c.enqueue(bytes.slice(5)); c.close(); } }), { headers }))); s.play(one); await flush();
    expect(Array.from(s.ctx.nodes[0].buffer!.data)).toEqual([-1, 32767 / 32768, 0, 0.5]);
    expect(s.error).not.toHaveBeenCalled();
  });
  it.each([204, 401, 404, 410, 503])("rejects HTTP %s without pretending playback drained", async (status) => {
    const s = setup(vi.fn(async () => new Response(null, { status }))); s.play(one); await flush();
    expect(s.error).toHaveBeenCalledWith("audio_unavailable"); expect(s.drained).not.toHaveBeenCalled(); expect(s.player.getAmplitude()).toBe(0);
  });
  it.each([
    [() => new Response(pcm(), { headers: { ...headers, "x-sample-rate": "16000" } }), "invalid_audio"],
    [() => response(new Uint8Array([1, 2, 3])), "invalid_audio"],
    [() => response(new Uint8Array()), "audio_unavailable"],
  ] as const)("rejects invalid or empty streams", async (make, reason) => {
    const s = setup(vi.fn(async () => make())); s.play(one); await flush(); expect(s.error).toHaveBeenCalledWith(reason); expect(s.drained).not.toHaveBeenCalled();
  });
  it("bounds aggregate downloads but lets scheduled partial audio finish after a read failure", async () => {
    const limited = setup(vi.fn(async () => response()), { maxBytes: 100 }); limited.play(one); await flush(); expect(limited.error).toHaveBeenCalledWith("invalid_audio");
    let input!: ReadableStreamDefaultController<Uint8Array>;
    const s = setup(vi.fn(async () => new Response(new ReadableStream({ start(c) { input = c; c.enqueue(pcm()); } }), { headers }))); s.play(one); await flush();
    input.error(new Error("connection reset")); await flush();
    expect(s.skipped).toHaveBeenCalledWith(0, "audio_interrupted");
    expect(s.error).not.toHaveBeenCalled(); expect(s.ctx.nodes.every(n => n.stop.mock.calls.length === 0)).toBe(true);
    s.ctx.currentTime = 0.251; await vi.advanceTimersByTimeAsync(10);
    expect(s.error).toHaveBeenCalledWith("audio_interrupted"); expect(s.drained).not.toHaveBeenCalled();
  });
  it("a second-sentence 503 preserves the complete first sentence and plays the third before drained", async () => {
    let rejectNext!: (response: Response) => void;
    const second = new Promise<Response>(resolve => { rejectNext = resolve; });
    const request = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/0") ? response(pcm(24000)) : String(url).endsWith("/1") ? second : response());
    const s = setup(request); s.play({ ...speech, sentences: [...speech.sentences, { index: 2, displayStart: 6, displayEnd: 9 }] }); await flush();
    const firstNodes = [...s.ctx.nodes]; expect(firstNodes).toHaveLength(20);
    s.ctx.currentTime = 0.35; rejectNext(new Response(null, { status: 503 })); await flush();
    expect(s.skipped).toHaveBeenCalledExactlyOnceWith(1, "audio_unavailable");
    expect(request).toHaveBeenCalledTimes(3);
    expect(firstNodes.every(n => n.stop.mock.calls.length === 0)).toBe(true);
    expect(s.ctx.nodes[20].start.mock.calls[0][0]).toBeCloseTo(1.15, 5);
    expect(s.drained).not.toHaveBeenCalled(); expect(s.error).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10); expect(s.started).toHaveBeenCalledExactlyOnceWith(0, 0.15);
    s.ctx.currentTime = 1.151; await vi.advanceTimersByTimeAsync(10); expect(s.started.mock.calls.at(-1)![0]).toBe(2);
    expect(s.drained).not.toHaveBeenCalled();
    s.ctx.currentTime = 1.251; await vi.advanceTimersByTimeAsync(10); expect(s.drained).toHaveBeenCalledOnce(); expect(s.error).not.toHaveBeenCalled();
  });
  it("a failed first sentence advances to the next and starts at its actual index", async () => {
    const s = setup(vi.fn(async (url: string | URL | Request) => String(url).endsWith("/0") ? new Response(null, { status: 503 }) : response()));
    s.play(); await flush(); expect(s.skipped).toHaveBeenCalledExactlyOnceWith(0, "audio_unavailable");
    s.ctx.currentTime = 0.15; await vi.advanceTimersByTimeAsync(10); expect(s.started).toHaveBeenCalledExactlyOnceWith(1, 0.15);
    s.ctx.currentTime = 0.251; await vi.advanceTimersByTimeAsync(10); expect(s.drained).toHaveBeenCalledOnce(); expect(s.error).not.toHaveBeenCalled();
  });
  it("all failed sentences report one failure, never drained", async () => {
    const s = setup(vi.fn(async () => new Response(null, { status: 503 }))); s.play(); await flush();
    expect(s.skipped.mock.calls).toEqual([[0, "audio_unavailable"], [1, "audio_unavailable"]]);
    expect(s.error).toHaveBeenCalledExactlyOnceWith("audio_unavailable"); expect(s.drained).not.toHaveBeenCalled();
  });
  it("stop aborts both downloads, scheduled audio and callbacks; newer playback stays independent", async () => {
    const signals: AbortSignal[] = [];
    const request = vi.fn(async (_url, init) => { signals.push(init!.signal as AbortSignal); return new Response(new ReadableStream({ start(c) { c.enqueue(pcm()); } }), { headers }); });
    const s = setup(request as typeof fetch); s.play(); await flush(); expect(signals).toHaveLength(2);
    s.player.stop(); expect(signals.every(v => v.aborted)).toBe(true); expect(s.ctx.nodes.every(n => n.stop.mock.calls.length === 1)).toBe(true);
    s.ctx.currentTime = 5; await vi.advanceTimersByTimeAsync(6000); expect(s.started).not.toHaveBeenCalled(); expect(s.error).not.toHaveBeenCalled(); expect(s.drained).not.toHaveBeenCalled();
    s.play(one); await flush(); expect(signals.at(-1)!.aborted).toBe(false); expect(s.player.getAmplitude()).toBe(0.5);
  });
  it("reports autoplay failure and suspended clock timeout without leaking sources", async () => {
    const s = setup(vi.fn(async () => response())); s.ctx.state = "suspended"; s.play(one); await flush(); expect(s.error).toHaveBeenCalledWith("autoplay_blocked"); expect(s.ctx.nodes).toHaveLength(0);
    s.ctx.state = "running"; s.play(one, 500); await flush(); s.ctx.state = "suspended";
    await vi.advanceTimersByTimeAsync(500); expect(s.error).toHaveBeenLastCalledWith("timeout"); expect(s.ctx.nodes.every(n => n.stop.mock.calls.length === 1)).toBe(true);
  });
  it("times out a hanging resume/download and disposes its context", async () => {
    const s = setup(vi.fn(() => new Promise<Response>(() => {}))); s.ctx.state = "suspended"; s.ctx.resume.mockImplementation(() => new Promise(() => {}));
    s.play(one); await vi.advanceTimersByTimeAsync(1500); expect(s.error).toHaveBeenCalledWith("autoplay_blocked"); await s.player.close(); expect(s.ctx.close).toHaveBeenCalledOnce();
  });
  it("maps hub transport without token/path/query leakage and guards with normalized speech length", () => {
    expect(audioBaseUrl("wss://hub.test:3210/ws?token=ignored#fragment")).toBe("https://hub.test:3210");
    expect(audioBaseUrl("ws://localhost:3210")).toBe("http://localhost:3210");
    expect(() => audioBaseUrl("https://hub.test")).toThrow();
    expect(playbackFallbackMs("2790万元。" )).toBeGreaterThan(playbackFallbackMs("你好。"));
  });
});

it.each(['stop','timeout','drained','error','supersede'])('player lifecycle releases microphone on %s',async reason=>{
 const mic=new VoiceMicrophone({hubUrl:'ws://localhost:3210',token:'test-token',state:()=> 'ambient',notice:()=>{}});mic.setConnected(true);
 const idle=vi.fn((latency:number)=>mic.playbackEnded(latency));
 const s=setup(vi.fn(async()=>reason==='error'?new Response(null,{status:503}):response()),{onActive:()=>mic.playbackStarted(),onIdle:idle});s.play(one,500);await flush();
 if(reason==='timeout')await vi.advanceTimersByTimeAsync(500);
 else if(reason==='drained'){s.ctx.currentTime=.3;await vi.advanceTimersByTimeAsync(10);}
 else if(reason==='supersede'){s.play(one);await flush();expect(idle).toHaveBeenCalledOnce();s.player.stop();}
 else s.player.stop();
 expect(idle).toHaveBeenCalledTimes(reason==='supersede'?2:1);await vi.advanceTimersByTimeAsync(350);mic.setConnected(true);
 expect((mic as unknown as {mode:string}).mode).toBe('kws');await mic.close();
});
