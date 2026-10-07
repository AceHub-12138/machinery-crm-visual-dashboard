/** Streaming s16le/24kHz/mono player. No React, DOM or wall-clock playback guesses.
 * Every source shares one AudioContext timeline and one analyser. Downloads are
 * bounded to the current sentence + one prefetched sentence, and 8 MiB per turn.
 */
import type { SkippedPlaybackSentence, VoiceWireEvent } from "./protocol.ts";

export type Speech = NonNullable<Extract<VoiceWireEvent, { type: "answer.delta" }>["speech"]>;
export type PlaybackFailure = "audio_unavailable" | "invalid_audio" | "audio_interrupted" | "autoplay_blocked" | "timeout";
export type PcmEvents = {
  onSentenceStart?: (index: number, contextTime: number) => void;
  onDrained?: () => void;
  onError?: (reason: PlaybackFailure) => void;
  onSentenceSkipped?: (index: number, reason: SkippedPlaybackSentence["reason"]) => void;
};
class PlaybackError extends Error {
  constructor(readonly reason: PlaybackFailure, readonly fatal = false) { super(reason); }
}
export function audioBaseUrl(hubUrl: string): string {
  const url = new URL(hubUrl);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("Invalid hub protocol");
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/"; url.search = ""; url.hash = "";
  return url.origin;
}

export class PcmPlayer {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;
  private controller: AbortController | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private boundaries: Array<{ index: number; time: number }> = [];
  private events: PcmEvents = {};
  private tail = 0;
  private streamsEnded = false;
  private completionError: PlaybackFailure | null = null;
  private receivedBytes = 0;
  private active = false;
  private first = true;
  constructor(private readonly options: {
    createContext?: () => AudioContext;
    fetch?: typeof fetch;
    prebufferMs?: number;
    maxBytes?: number;
  } = {}) {}

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = (this.options.createContext ?? (() => new AudioContext()))();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(this.context.destination);
      this.samples = new Float32Array(this.analyser.fftSize);
    }
    return this.context;
  }
  /** Called at wake or a real keyboard/pointer gesture, before speech arrives. */
  async resume(): Promise<void> { await this.ensureContext().resume(); }

  get outputLatencyMs(): number { return Math.max(0, (this.context?.outputLatency ?? 0) * 1000); }
  async suspend(): Promise<void> { if (!this.active) await this.context?.suspend(); }

  play(speech: Speech, baseUrl: string, token: string | null, events: PcmEvents, timeoutMs: number): void {
    this.stop();
    const controller = new AbortController();
    this.controller = controller;
    this.events = events; this.active = true; this.first = true;
    this.receivedBytes = 0; this.tail = 0; this.streamsEnded = false;
    this.completionError = null;
    const deadline = setTimeout(() => this.fail("timeout", controller), timeoutMs);
    const resumeDeadline = setTimeout(() => {
      if (this.context?.state !== "running") this.fail("autoplay_blocked", controller);
    }, 1500);
    controller.signal.addEventListener("abort", () => { clearTimeout(deadline); clearTimeout(resumeDeadline); }, { once: true });
    void this.run(speech, baseUrl, token, controller).catch((err: unknown) => {
      if (!controller.signal.aborted) this.fail(err instanceof PlaybackError ? err.reason : "audio_interrupted", controller);
    });
  }

  private async run(speech: Speech, baseUrl: string, token: string | null, controller: AbortController): Promise<void> {
    const ctx = this.ensureContext();
    await ctx.resume();
    controller.signal.throwIfAborted();
    if (ctx.state !== "running") throw new PlaybackError("autoplay_blocked");
    if (!speech.sentences.length) throw new PlaybackError("invalid_audio");
    const request = this.options.fetch ?? fetch;
    const headers: HeadersInit = token ? { authorization: `Bearer ${token}` } : {};
    const download = (index: number) => this.download(`${baseUrl}/voice/audio/${speech.turnId}/${index}`, headers, controller, request);
    let current = download(0);
    let completedSentences = 0;
    let lastError: PlaybackFailure = "audio_unavailable";
    this.timer = setInterval(() => this.tick(controller), 10);
    for (let i = 0; i < speech.sentences.length; i++) {
      let next: ReturnType<PcmPlayer["download"]> | null = null;
      let started = false;
      try {
        for await (const bytes of current.chunks()) {
          controller.signal.throwIfAborted();
          if (!started) {
            // Start downloading the next sentence while this sentence plays.
            if (i + 1 < speech.sentences.length) next = download(i + 1);
            started = true;
          }
          this.schedule(bytes, i, ctx);
        }
        if (!started) throw new PlaybackError("audio_unavailable");
        completedSentences++;
      } catch (err) {
        controller.signal.throwIfAborted();
        if (err instanceof PlaybackError && err.fatal) throw err;
        const reason = err instanceof PlaybackError ? err.reason : "audio_interrupted";
        if (reason === "autoplay_blocked" || reason === "timeout") throw err;
        lastError = reason;
        this.events.onSentenceSkipped?.(i, reason);
      }
      controller.signal.throwIfAborted();
      // A failed/empty sentence may never have started its prefetch.
      if (!next && i + 1 < speech.sentences.length) next = download(i + 1);
      if (next) current = next;
    }
    // Preserve already scheduled samples even when every sentence was partial.
    // With no complete sentence the turn is failed, never a false success.
    this.completionError = completedSentences === 0 ? lastError : null;
    this.streamsEnded = true;
    this.tick(controller);
  }

  private download(url: string, headers: HeadersInit, controller: AbortController, request: typeof fetch) {
    const queue: Uint8Array[] = [];
    let done = false; let error: unknown; let wake: (() => void) | null = null;
    const notify = () => { wake?.(); wake = null; };
    controller.signal.addEventListener("abort", notify, { once: true });
    void (async () => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let carry: number | null = null;
      let pending = new Uint8Array(0);
      try {
        const res = await request(url, { headers, signal: controller.signal, cache: "no-store" });
        if (res.status !== 200 || !res.body) throw new PlaybackError("audio_unavailable");
        if (res.headers.get("content-type")?.split(";")[0] !== "audio/pcm" || res.headers.get("x-sample-rate") !== "24000" || res.headers.get("x-channels") !== "1" || res.headers.get("x-sample-format") !== "s16le") throw new PlaybackError("invalid_audio");
        reader = res.body.getReader();
        for (;;) {
          const part = await reader.read();
          controller.signal.throwIfAborted();
          if (part.done) break;
          this.receivedBytes += part.value.length;
          if (this.receivedBytes > (this.options.maxBytes ?? 8 * 1024 * 1024)) throw new PlaybackError("invalid_audio", true);
          const joined: Uint8Array<ArrayBuffer> = new Uint8Array(pending.length + part.value.length + (carry === null ? 0 : 1));
          joined.set(pending);
          if (carry !== null) joined[pending.length] = carry;
          joined.set(part.value, pending.length + (carry === null ? 0 : 1));
          const even = joined.length - joined.length % 2;
          carry = joined.length % 2 ? joined[even] : null;
          // 50 ms blocks: avoid a node per tiny network fragment. Large chunks
          // are split so stop() can release scheduled sources promptly.
          let offset = 0;
          for (; offset + 2400 <= even; offset += 2400) queue.push(joined.slice(offset, offset + 2400));
          pending = joined.slice(offset, even);
          notify();
        }
        if (carry !== null) throw new PlaybackError("invalid_audio");
        if (pending.length) queue.push(pending);
      } catch (err) { error = err; }
      finally {
        await reader?.cancel().catch(() => {});
        reader?.releaseLock(); done = true;
        controller.signal.removeEventListener("abort", notify); notify();
      }
    })();
    return { chunks: async function* () {
      for (;;) {
        controller.signal.throwIfAborted();
        if (error instanceof PlaybackError && error.fatal) throw error;
        if (queue.length) { yield queue.shift()!; continue; }
        if (error) throw error;
        if (done) return;
        await new Promise<void>(resolve => { wake = resolve; });
      }
    } };
  }

  private schedule(bytes: Uint8Array, index: number, ctx: AudioContext): void {
    const buffer = ctx.createBuffer(1, bytes.length / 2, 24000);
    const floats = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    for (let i = 0; i < floats.length; i++) floats[i] = view.getInt16(i * 2, true) / 32768;
    const source = ctx.createBufferSource();
    source.buffer = buffer; source.connect(this.analyser!);
    const when = this.first
      ? ctx.currentTime + (this.options.prebufferMs ?? 150) / 1000
      : this.tail >= ctx.currentTime ? this.tail : ctx.currentTime + (this.options.prebufferMs ?? 150) / 1000;
    // tick consumes boundaries while later chunks can still arrive.
    if (this.lastScheduledIndex !== index) this.boundaries.push({ index, time: when });
    this.lastScheduledIndex = index; this.first = false;
    this.tail = when + buffer.duration;
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); source.buffer = null; };
    source.start(when);
  }
  private lastScheduledIndex = -1;
  private tick(controller: AbortController): void {
    if (!this.active || controller !== this.controller || controller.signal.aborted || this.context?.state !== "running") return;
    const now = this.context.currentTime;
    while (this.boundaries[0] && now >= this.boundaries[0].time) {
      const b = this.boundaries.shift()!;
      this.events.onSentenceStart?.(b.index, b.time);
    }
    if (this.streamsEnded && now >= this.tail) {
      if (this.completionError) { this.fail(this.completionError, controller); return; }
      const drained = this.events.onDrained;
      this.stop(); drained?.();
    }
  }
  private fail(reason: PlaybackFailure, controller: AbortController): void {
    if (controller !== this.controller || controller.signal.aborted) return;
    const onError = this.events.onError;
    this.stop(); onError?.(reason);
  }
  getAmplitude(): number {
    if (!this.active || this.context?.state !== "running" || !this.analyser || !this.samples) return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0; for (const sample of this.samples) sum += sample * sample;
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 4);
  }
  stop(): void {
    this.active = false; this.controller?.abort(); this.controller = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null; this.boundaries = []; this.lastScheduledIndex = -1;
    for (const source of this.sources) { source.onended = null; try { source.stop(); } catch { /* already ended */ } source.disconnect(); source.buffer = null; }
    this.sources.clear(); this.events = {};
  }
  async close(): Promise<void> {
    this.stop(); this.analyser?.disconnect();
    await this.context?.close(); this.context = null; this.analyser = null; this.samples = null;
  }
}
