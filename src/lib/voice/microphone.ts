import type { VoiceStateName } from "./session-machine";
import { audioBaseUrl } from "./pcm-player";
export type InputConfig = { hangoverMs: number; micReopenDelayMs: number; kwsThreshold: number; kwsScore: number; kwsEnergy: number; wakePhrase: string };
export function captureMode(state: VoiceStateName, ready: boolean, blocked: boolean): "kws" | "vad" | "off" {
  if (!ready || blocked) return "off";
  if (state === "ambient") return "kws";
  return state === "listening" || state === "followup" ? "vad" : "off";
}
export function toPcm16(audio: Float32Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Math.min(240000, audio.length) * 2); const view = new DataView(bytes.buffer);
  for (let i = 0; i < bytes.length / 2; i++) view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, audio[i])) * (audio[i] < 0 ? 32768 : 32767)), true);
  return bytes;
}
export class VoiceMicrophone {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private worklet: AudioWorkletNode | null = null;
  private worker: Worker | null = null;
  private processor: import("@ricky0123/vad-web").FrameProcessor | null = null;
  private model: import("@ricky0123/vad-web/dist/models/silero").Silero | null = null;
  private stopped = false;
  private busy = false;
  private connected = false;
  private fixedPlaying = false;
  private blockedUntil = 0;
  private cooldownUntil = 0;
  private mode: "kws" | "vad" | "off" = "off";
  private epoch = 0;
  private queue = Promise.resolve();
  private queued = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private requests = new AbortController();
  private config: InputConfig = { hangoverMs: 500, micReopenDelayMs: 300, kwsThreshold: .25, kwsScore: 1, kwsEnergy: .01, wakePhrase: "你好，小川" };
  constructor(private readonly options: { hubUrl: string; token: string; state: () => VoiceStateName; notice: (text: string) => void }) {}
  private async request(path: string, body?: Uint8Array<ArrayBuffer>): Promise<void> {
    const res = await fetch(`${audioBaseUrl(this.options.hubUrl)}${path}`, { method: "POST", headers: { authorization: `Bearer ${this.options.token}`, ...(body ? { "content-type": "audio/pcm" } : {}) }, body, signal: AbortSignal.any([this.requests.signal, AbortSignal.timeout(20000)]) });
    if (!res.ok) throw new Error(`voice HTTP ${res.status}`);
  }
  async wake(): Promise<void> {
    if (this.options.state() !== "ambient" || this.busy || !this.connected) return;
    this.busy = true; this.update();
    try { await this.request("/voice/wake"); this.cooldownUntil = performance.now() + 5000; }
    catch { this.options.notice("唤醒暂不可用，请检查语音服务。"); }
    finally { this.busy = false; this.update(); }
  }
  setConnected(value: boolean): void { this.connected = value; if (!value) { this.requests.abort(); this.requests = new AbortController(); } this.update(); }
  playbackStarted(): void { this.fixedPlaying = true; this.update(); }
  playbackEnded(outputLatencyMs: number): void { this.fixedPlaying = false; this.blockedUntil = performance.now() + outputLatencyMs + this.config.micReopenDelayMs; this.cooldownUntil = performance.now() + 5000; this.update(); }
  private update(): void {
    const mode = captureMode(this.options.state(), this.connected, this.busy || this.fixedPlaying || performance.now() < this.blockedUntil);
    if (mode === this.mode) return;
    this.mode = mode; this.epoch++;
    this.queue = this.queue.then(() => { this.processor?.reset(); this.processor?.resume(); });
    this.worker?.postMessage({ type: "reset", epoch: this.epoch });
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = mode !== "off";
    this.worklet?.port.postMessage({ enabled: mode !== "off" });
  }
  async start(): Promise<void> {
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("secure_context_required");
      const config = await fetch(`${audioBaseUrl(this.options.hubUrl)}/voice/input-config`, { headers: { authorization: `Bearer ${this.options.token}` }, signal: this.requests.signal });
      if (!config.ok) throw new Error("input_config_unavailable");
      this.config = await config.json();
      const [{ FrameProcessor, Message }, { Silero }, ort] = await Promise.all([import("@ricky0123/vad-web"), import("@ricky0123/vad-web/dist/models/silero"), import("onnxruntime-web/wasm")]);
      ort.env.wasm.wasmPaths = "/voice/vad/"; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
      this.model = await Silero.new(ort, async () => { const r = await fetch("/voice/vad/silero_vad_v5.onnx", { signal: this.requests.signal }); if (!r.ok) throw new Error("vad_missing"); return r.arrayBuffer(); }) as typeof this.model;
      if (this.stopped) { const model = this.model; this.model = null; await model?.release(); return; }
      if (!this.model) return;
      this.processor = new FrameProcessor(this.model.process, this.model.reset_state, { positiveSpeechThreshold: .5, negativeSpeechThreshold: .35, redemptionMs: this.config.hangoverMs, preSpeechPadMs: 200, minSpeechMs: 300, submitUserSpeechOnPause: false }, 32);
      this.processor.resume();
      this.worker = new Worker("/voice/kws-worker.js");
      this.worker.onmessage = ({ data }) => {
        if (data.type === "keyword" && data.epoch === this.epoch && this.mode === "kws" && performance.now() >= this.cooldownUntil) void this.wake();
        if (data.type === "error") this.options.notice("唤醒词暂不可用，可按 F9 唤醒小川。");
      };
      this.worker.postMessage({ type: "init", ...this.config });
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.stopped) { this.stream.getTracks().forEach(t => t.stop()); return; }
      this.context = new AudioContext(); await this.context.audioWorklet.addModule("/voice/mic-worklet.js");
      const source = this.context.createMediaStreamSource(this.stream);
      this.worklet = new AudioWorkletNode(this.context, "voice-capture");
      const silent = this.context.createGain(); silent.gain.value = 0;
      source.connect(this.worklet).connect(silent).connect(this.context.destination);
      this.worklet.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
        this.update();
        const epoch = this.epoch;
        if (this.mode === "kws") { this.worker?.postMessage({ type: "audio", samples: data, epoch }, [data.buffer]); return; }
        if (this.mode !== "vad" || this.queued >= 32) return;
        this.queued++;
        this.queue = this.queue.then(async () => {
          if (epoch !== this.epoch || this.mode !== "vad") return;
          const handle = (event: import("@ricky0123/vad-web/dist/frame-processor").FrameProcessorEvent) => {
            if (epoch !== this.epoch) return;
            if (event.msg === Message.SpeechStart && this.options.state() === "followup") void this.request("/voice/wake?followup=1").catch(() => {});
            if (event.msg === Message.SpeechEnd) {
              this.busy = true; this.update();
              void this.request("/voice/utterance", toPcm16(event.audio)).catch(() => this.options.notice("语音识别暂不可用，请再试一次。")).finally(() => { this.busy = false; this.update(); });
            }
          };
          await this.processor?.process(data, handle);
          if (this.processor && this.processor.audioBuffer.length * 512 >= 240000) this.processor.endSegment(handle);
        }).catch(() => this.options.notice("麦克风处理异常，请刷新页面。")).finally(() => { this.queued--; });
      };
      this.mode = "off"; this.update();
      this.timer = setInterval(() => this.update(), 25);
      await this.context.resume();
    } catch (error) { console.warn("[voice-input] initialization failed", error instanceof Error ? error.message : "unknown"); if (!this.stopped) this.options.notice("请允许麦克风权限，并使用本机或 HTTPS 页面。"); }
  }
  async resume(): Promise<void> { await this.context?.resume(); }
  async close(): Promise<void> {
    this.stopped = true; this.requests.abort(); if (this.timer) clearInterval(this.timer); this.worker?.terminate();
    this.stream?.getTracks().forEach(t => t.stop()); this.worklet?.disconnect(); await this.context?.close(); await this.queue; await this.model?.release();
  }
}
