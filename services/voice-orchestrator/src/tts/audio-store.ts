/** Turn buffers are independent of browsers. Disconnecting a GET does not cancel synthesis;
 * supersession/close explicitly cancel the whole turn. Bounded retention prevents leaks.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SpokenSentence } from "../../../../src/lib/voice/spoken-normalize.ts";
import { FIXED_LINES, type FixedLineKey } from "./fixed-lines.ts";
import type { SpeechClient, TtsMetrics } from "./voice-local-client.ts";

export type SpeechDescriptor = { turnId: string; sentences: Array<{ index: number; displayStart: number; displayEnd: number }> };
export type BufferedSentence = {
  chunks: Uint8Array[]; state: "pending" | "done" | "failed"; bytes: number; waiters: Set<() => void>;
};
export type AudioTurn = {
  id: string; descriptor: SpeechDescriptor; controller: AbortController;
  sentences: BufferedSentence[]; bytes: number; cancelled: boolean; created: number;
  metrics: TtsMetrics; completed: Promise<void>;
};

export class AudioStore {
  readonly #client: SpeechClient;
  readonly #cacheDir: string;
  readonly #style: string;
  readonly #enabled: boolean;
  readonly #warn: (message: string) => void;
  readonly #fixed = new Map<FixedLineKey, Uint8Array>();
  readonly #turns = new Map<string, AudioTurn>();
  readonly #maxBytes: number;
  readonly #ttlMs: number;
  readonly #gone = new Map<string, number>();
  #gc: NodeJS.Timeout | null = null;
  #ready = false;
  #reason = "disabled";
  constructor(options: { client: SpeechClient; cacheDir: string; style?: string; enabled: boolean; warn?: (message: string) => void; maxTurnBytes?: number; ttlMs?: number }) {
    this.#client = options.client; this.#cacheDir = options.cacheDir; this.#style = options.style ?? "default";
    this.#enabled = options.enabled; this.#warn = options.warn ?? (() => {});
    this.#maxBytes = options.maxTurnBytes ?? 8 * 1024 * 1024;
    this.#ttlMs = options.ttlMs ?? 120000;
    if (this.#enabled) {
      this.#gc = setInterval(() => this.sweep(), Math.min(this.#ttlMs, 1000));
      this.#gc.unref();
    }
  }
  get ready(): boolean { return this.#ready; }
  get status() { return { enabled: this.#enabled, ready: this.#ready, reason: this.#reason }; }

  async initialize(): Promise<void> {
    if (!this.#enabled) return;
    try {
      const health = await this.#client.health();
      if (!health.warm || health.selfCheck !== "passed" || !health.styles.includes(this.#style)) throw new Error("self-check or style unavailable");
      await mkdir(this.#cacheDir, { recursive: true, mode: 0o700 });
      for (const [key, text] of Object.entries(FIXED_LINES) as Array<[FixedLineKey, string]>) {
        const hash = createHash("sha256").update(JSON.stringify({ version: 1, refHash: health.refHash, style: this.#style, text, format: "s16le/24000/mono" })).digest("hex");
        const path = join(this.#cacheDir, `${hash}.pcm`);
        let pcm: Uint8Array | null = null;
        try {
          const cached = await readFile(path);
          if (validPcm(cached)) pcm = cached;
        } catch { /* cache miss */ }
        if (!pcm) {
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          let done = false;
          for await (const chunk of this.#client.tts(text, this.#style)) {
            if (chunk.type === "audio") {
              bytes += chunk.pcm.length;
              if (bytes > 2 * 1024 * 1024) throw new Error("Fixed speech too large");
              chunks.push(chunk.pcm);
            } else {
              if (chunk.metrics.ttsFail || chunk.metrics.ttsTruncated) throw new Error("Fixed speech synthesis failed");
              done = true;
            }
          }
          pcm = Buffer.concat(chunks);
          if (!done || !validPcm(pcm)) throw new Error("Invalid fixed speech");
          const temporary = `${path}.${randomUUID()}.tmp`;
          await writeFile(temporary, pcm, { mode: 0o600, flag: "wx" });
          await rename(temporary, path);
        }
        this.#fixed.set(key, pcm);
      }
      this.#ready = true;
      this.#reason = "ready";
    } catch {
      this.#ready = false; this.#fixed.clear(); this.#reason = "startup_check_failed";
      this.#warn("TTS startup validation/cache failed; voice muted, cards remain available");
    }
  }

  fixed(key: string): Uint8Array | null { return this.#ready ? this.#fixed.get(key as FixedLineKey) ?? null : null; }
  start(sentences: SpokenSentence[], onMetrics?: (metrics: TtsMetrics) => void): AudioTurn | null {
    if (!this.#ready || !sentences.length) return null;
    this.sweep();
    // Single display: starting a newer turn cancels all earlier jobs.
    for (const turn of this.#turns.values()) if (!turn.cancelled) this.cancel(turn.id);
    while (this.#turns.size >= 4) this.#turns.delete(this.#turns.keys().next().value!);
    const id = randomUUID();
    const turn: AudioTurn = {
      id, descriptor: { turnId: id, sentences: sentences.map(({ index, displayStart, displayEnd }) => ({ index, displayStart, displayEnd })) },
      controller: new AbortController(), sentences: sentences.map(() => ({ chunks: [], state: "pending", bytes: 0, waiters: new Set() })),
      bytes: 0, cancelled: false, created: Date.now(), metrics: { ttsRegenerated: 0, ttsTruncated: 0, ttsFail: 0 }, completed: Promise.resolve(),
    };
    this.#turns.set(id, turn);
    turn.completed = this.produce(turn, sentences, onMetrics);
    return turn;
  }
  lookup(id: string): AudioTurn | null { this.sweep(); return this.#turns.get(id) ?? null; }
  isGone(id: string): boolean { this.sweep(); return this.#gone.has(id); }
  cancel(id: string): void {
    const turn = this.#turns.get(id);
    if (!turn || turn.cancelled) return;
    turn.cancelled = true;
    this.#gone.set(id, Date.now());
    while (this.#gone.size > 128) this.#gone.delete(this.#gone.keys().next().value!);
    turn.controller.abort(new Error("Audio turn cancelled"));
    turn.bytes = 0;
    for (const sentence of turn.sentences) { sentence.chunks.length = 0; sentence.bytes = 0; notify(sentence); }
  }
  close(): void {
    if (this.#gc) clearInterval(this.#gc);
    this.#gc = null;
    for (const id of this.#turns.keys()) this.cancel(id);
    this.#turns.clear(); this.#gone.clear();
  }
  private sweep(): void {
    for (const [id, turn] of this.#turns) if (Date.now() - turn.created > this.#ttlMs) { this.cancel(id); this.#turns.delete(id); }
    for (const [id, created] of this.#gone) if (Date.now() - created > this.#ttlMs) this.#gone.delete(id);
  }
  private async produce(turn: AudioTurn, sentences: SpokenSentence[], onMetrics?: (metrics: TtsMetrics) => void): Promise<void> {
    const started = performance.now();
    for (let i = 0; i < sentences.length && !turn.cancelled; i++) {
      const buffer = turn.sentences[i];
      let done = false;
      try {
        for await (const chunk of this.#client.tts(sentences[i].spokenText, this.#style, turn.controller.signal)) {
          if (turn.cancelled) return;
          if (chunk.type === "audio") {
            if (chunk.pcm.length % 2) throw new Error("Unaligned PCM");
            if (turn.bytes + chunk.pcm.length > this.#maxBytes) throw new Error("Audio buffer limit");
            turn.bytes += chunk.pcm.length;
            buffer.bytes += chunk.pcm.length;
            const first = turn.metrics.ttsFirstByteMs === undefined;
            turn.metrics.ttsFirstByteMs ??= performance.now() - started;
            if (first) onMetrics?.({ ...turn.metrics });
            buffer.chunks.push(chunk.pcm.slice());
            notify(buffer);
          } else {
            turn.metrics.ttsRegenerated += chunk.metrics.ttsRegenerated;
            turn.metrics.ttsTruncated += chunk.metrics.ttsTruncated;
            turn.metrics.ttsFail += chunk.metrics.ttsFail;
            done = true;
          }
        }
        if (!done || !buffer.bytes) throw new Error("Empty or incomplete synthesis");
        buffer.state = "done";
      } catch {
        if (turn.cancelled) return;
        turn.metrics.ttsFail += 1;
        buffer.state = "failed";
      } finally {
        notify(buffer);
      }
      onMetrics?.({ ...turn.metrics });
    }
  }
}

export function notify(sentence: BufferedSentence): void { for (const wake of sentence.waiters) wake(); sentence.waiters.clear(); }
function validPcm(pcm: Uint8Array): boolean {
  if (pcm.length < 14400 || pcm.length % 2 || pcm.length > 2 * 1024 * 1024) return false;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  for (let offset = 0; offset < pcm.length; offset += 2) if (Math.abs(view.getInt16(offset, true)) >= 33) return true;
  return false;
}
