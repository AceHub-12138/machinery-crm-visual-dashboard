/** Loopback-only client. PCM reads may split a sample at any HTTP boundary. */
export type TtsMetrics = {
  style?: string;
  styleFallback?: string;
  ttsFirstByteMs?: number;
  voiceLocalFirstByteMs?: number;
  ttsRegenerated: number;
  ttsTruncated: number;
  ttsFail: number;
};
export type VoiceLocalHealth = { warm: boolean; selfCheck: "pending" | "passed" | "failed"; refHash: string; styles: string[]; styleHashes?: Record<string, string>; failedStyles?: string[] };
export type TtsChunk = { type: "audio"; pcm: Uint8Array; sampleRate: 24000 } | { type: "done"; metrics: TtsMetrics };
export type AsrResult = { text: string; ms: number; asrQueueMs?: number; interleavedTts?: boolean };
export interface SpeechClient {
  health(signal?: AbortSignal): Promise<VoiceLocalHealth>;
  asr(pcm: Uint8Array, signal?: AbortSignal): Promise<AsrResult>;
  tts(text: string, style: string, signal?: AbortSignal): AsyncIterable<TtsChunk>;
}

export class VoiceLocalClient implements SpeechClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
      throw new Error("VOICE_LOCAL_URL must be an HTTP loopback address");
    }
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#fetch = fetchImpl;
  }
  private signal(external: AbortSignal | undefined, ms: number): AbortSignal {
    const timeout = AbortSignal.timeout(ms);
    return external ? AbortSignal.any([external, timeout]) : timeout;
  }
  async health(signal?: AbortSignal): Promise<VoiceLocalHealth> {
    const response = await this.#fetch(`${this.#baseUrl}/health`, { signal: this.signal(signal, 5000), redirect: "error" });
    if (!response.ok) throw new Error(`voice-local health HTTP ${response.status}`);
    const value = await response.json() as VoiceLocalHealth;
    if (typeof value?.warm !== "boolean" || !["pending", "passed", "failed"].includes(value.selfCheck) ||
        !/^[a-f0-9]{64}$/.test(value.refHash) || !Array.isArray(value.styles) || !value.styles.every((style) => typeof style === "string")) {
      throw new Error("Invalid voice-local health");
    }
    return value;
  }
  async asr(pcm: Uint8Array, signal?: AbortSignal): Promise<AsrResult> {
    if (!pcm.byteLength || pcm.byteLength % 2 || pcm.byteLength > 480000) throw new Error("ASR requires aligned PCM up to 15 seconds");
    const response = await this.#fetch(`${this.#baseUrl}/asr`, {
      method: "POST", headers: { "content-type": "audio/pcm" }, body: Buffer.from(pcm),
      signal: this.signal(signal, 15000), redirect: "error",
    });
    if (!response.ok) throw new Error(`ASR HTTP ${response.status}`);
    const value = await response.json() as AsrResult;
    if (typeof value?.text !== "string" || !Number.isFinite(value.ms) || value.ms < 0 || (value.asrQueueMs !== undefined && (!Number.isFinite(value.asrQueueMs) || value.asrQueueMs < 0)) || (value.interleavedTts !== undefined && typeof value.interleavedTts !== "boolean")) throw new Error("Invalid ASR response");
    return value;
  }
  async *tts(text: string, style: string, signal?: AbortSignal): AsyncIterable<TtsChunk> {
    const requestSignal = this.signal(signal, 90000);
    const started = performance.now();
    const response = await this.#fetch(`${this.#baseUrl}/tts`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, style }),
      signal: requestSignal, redirect: "error",
    });
    if (!response.ok || !response.body) throw new Error(`TTS HTTP ${response.status}`);
    const job = response.headers.get("x-voice-job-id");
    if (response.headers.get("content-type")?.split(";")[0] !== "audio/pcm" || response.headers.get("x-sample-rate") !== "24000" ||
        response.headers.get("x-channels") !== "1" || response.headers.get("x-sample-format") !== "s16le" || !job || !/^[a-f0-9]{32}$/.test(job)) {
      await response.body.cancel();
      throw new Error("Invalid PCM response format");
    }
    const reader = response.body.getReader();
    let tail: number | null = null;
    let total = 0;
    let firstByte: number | undefined;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        requestSignal.throwIfAborted();
        let bytes = part.value;
        if (tail !== null) {
          const joined = new Uint8Array(bytes.length + 1);
          joined[0] = tail;
          joined.set(bytes, 1);
          bytes = joined;
          tail = null;
        }
        if (bytes.length % 2) { tail = bytes[bytes.length - 1]; bytes = bytes.subarray(0, bytes.length - 1); }
        total += bytes.length;
        if (total > 8 * 1024 * 1024) throw new Error("TTS response exceeds audio limit");
        if (bytes.length) {
          firstByte ??= performance.now() - started;
          yield { type: "audio", pcm: bytes, sampleRate: 24000 };
        }
      }
      if (tail !== null || !total) throw new Error("Incomplete PCM response");
      requestSignal.throwIfAborted();
      const statsResponse = await this.#fetch(`${this.#baseUrl}/jobs/${job}`, { signal: this.signal(signal, 2000), redirect: "error" });
      if (!statsResponse.ok) throw new Error("TTS metrics unavailable");
      const stats = await statsResponse.json() as TtsMetrics;
      if (![stats.ttsRegenerated, stats.ttsTruncated, stats.ttsFail].every((v) => Number.isInteger(v) && v >= 0 && v <= 1)) throw new Error("Invalid TTS metrics");
      yield { type: "done", metrics: { ttsFirstByteMs: firstByte, ...(Number.isFinite(stats.ttsFirstByteMs) ? { voiceLocalFirstByteMs: stats.ttsFirstByteMs } : {}), ttsRegenerated: stats.ttsRegenerated, ttsTruncated: stats.ttsTruncated, ttsFail: stats.ttsFail } };
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
