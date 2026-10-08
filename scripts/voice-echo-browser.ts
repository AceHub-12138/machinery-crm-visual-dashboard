/** Physical Step 0 controls. No captured PCM leaves the page. */
import { PcmPlayer } from "../src/lib/voice/pcm-player.ts";
import { FrameProcessor } from "@ricky0123/vad-web/dist/frame-processor";
import { Message } from "@ricky0123/vad-web/dist/messages";
import { Silero } from "@ricky0123/vad-web/dist/models/silero";
import * as ort from "onnxruntime-web/wasm";
import { summarizeLevels, evaluatePickup, evaluateHuman, type Level } from "./voice-echo-metrics.ts";
type SinkContext = AudioContext & { setSinkId(id: string): Promise<void> };
type Clip = { id: string; seconds: number; sha256: string };
type Window = { index: number; kind: "baseline" | "playback"; since: number; levels: Level[]; starts: number; realStarts: number; confirms: number; ends: number; misfires: number; queuedMax: number; events: Array<{ event: string; ms: number }> };
type Summary = ReturnType<typeof summarizeLevels> & { index: number; starts: number; confirms: number; realStarts: number; misfires: number; ends: number; queuedMax: number; events: Window["events"]; quality: boolean };
type Trial = { index: number; clip: Clip; baseline: Summary & { durationMs: number; levels: Level[] }; playback: Summary; settings: MediaTrackSettings; prompt?: string };
const status = (message: string) => { document.querySelector("pre")!.textContent = message; console.log(message); };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const button = document.querySelector("button") as HTMLButtonElement;
let suiteRunning = false;
async function run() {
  if (suiteRunning) return;
  suiteRunning = true; button.disabled = true;
  let stream: MediaStream | undefined, input: AudioContext | undefined, model: Silero | undefined, player: PcmPlayer | undefined;
  let queue = Promise.resolve(), current: Window | null = null;
  const rounds: Array<{ mode: string; trials: Trial[]; passed: boolean }> = [];
  const report: Record<string, unknown> = { schema: 2, state: "initializing", passed: false, scope: "physical Mac speaker/KZ microphone; not exhibit acceptance", rounds };
  const save = async () => { const r = await fetch("/result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report) }); if (!r.ok) throw new Error(`report HTTP ${r.status}`); };
  try {
    const config = await (await fetch("/config.json")).json() as { placement: string; displayPlacement: boolean; consentedQuiet: boolean; prior?: { rounds: typeof rounds }; priorPath?: string; priorSha256?: string };
    report.placement = { description: config.placement, exhibitPlacementVerified: config.displayPlacement, distanceMeasured: false };
    report.userConfirmedQuiet = config.consentedQuiet;
    report.thresholds = { positive: .8, negative: .35, minimumMs: 300, confirmationMs: 500, baselineMs: 5000 };
    report.method = "SpeechStart ducks in80ms except AEC-off control; confirm counts >=500ms positive speech frames without pausing; no ASR or stored microphone PCM";
    const clips = await (await fetch("/clips.json")).json() as Clip[]; report.fixtureSet = clips;
    ort.env.wasm.wasmPaths = "/voice/vad/"; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
    model = await Silero.new(ort, async () => (await fetch("/voice/vad/silero_vad_v5.onnx")).arrayBuffer()) as Silero;
    const processor = new FrameProcessor(model.process, model.reset_state, { positiveSpeechThreshold: .8, negativeSpeechThreshold: .35, redemptionMs: 500, preSpeechPadMs: 500, minSpeechMs: 300, submitUserSpeechOnPause: false }, 32);
    processor.resume();
    input = new AudioContext(); await input.audioWorklet.addModule("/voice/mic-worklet.js");
    const worklet = new AudioWorkletNode(input, "voice-capture"), silent = input.createGain(); silent.gain.value = 0;
    worklet.connect(silent).connect(input.destination); worklet.port.postMessage({ enabled: true }); await input.resume();
    let source: MediaStreamAudioSourceNode | undefined, settings: MediaTrackSettings;
    let output: SinkContext | undefined, gain: GainNode | undefined;
    let queued = 0, speech = false, speechMs = 0, confirmed = false, allowDuck = true, processingError: string | null = null;
    const restore = () => { if (gain && output) { gain.gain.cancelScheduledValues(output.currentTime); gain.gain.setTargetAtTime(1, output.currentTime, .02); } speech = false; speechMs = 0; confirmed = false; };
    const openMic = async (aec: boolean) => {
      current = null; source?.disconnect(); stream?.getTracks().forEach(track => track.stop()); await queue;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: { exact: aec }, noiseSuppression: { exact: aec }, autoGainControl: { exact: aec } } });
      const track = stream.getAudioTracks()[0]; if (!track.label.includes("KZ")) throw new Error(`输入不是当前确认的KZ：${track.label}`);
      const s = track.getSettings(); if ([s.echoCancellation, s.noiseSuppression, s.autoGainControl].some(value => value !== aec)) throw new Error("AEC/降噪/AGC设置未按实验要求生效");
      settings = { sampleRate: s.sampleRate, channelCount: s.channelCount, echoCancellation: s.echoCancellation, noiseSuppression: s.noiseSuppression, autoGainControl: s.autoGainControl };
      report.input = track.label; source = input!.createMediaStreamSource(stream); source.connect(worklet);
      if (!output) {
        const sink = (await navigator.mediaDevices.enumerateDevices()).find(device => device.kind === "audiooutput" && device.label.includes("Mac Studio")); if (!sink) throw new Error("未找到Mac Studio扬声器");
        output = new AudioContext() as SinkContext; if (!output.setSinkId) throw new Error("不支持选择实验输出设备");
        await output.setSinkId(sink.deviceId); report.output = sink.label;
        gain = output.createGain(); gain.connect(output.destination);
        const makeAnalyser = output.createAnalyser.bind(output);
        output.createAnalyser = () => { const a = makeAnalyser(), connect = a.connect.bind(a); a.connect = ((destination: AudioNode) => connect(destination === output!.destination ? gain! : destination)) as typeof a.connect; return a; };
        player = new PcmPlayer({ createContext: () => output! }); await player.resume();
      }
      await sleep(500);
    };
    worklet.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
      const row = current; if (!row) return;
      let sum = 0, peak = 0; for (const sample of data) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
      const ms = performance.now() - row.since; row.levels.push({ ms: Math.round(ms), rms: Math.sqrt(sum / data.length), peak });
      queued++; row.queuedMax = Math.max(row.queuedMax, queued);
      queue = queue.then(async () => {
        if (row !== current) return;
        await processor.process(data, event => {
          const mark = (name: string) => row.events.push({ event: name, ms: Math.round(ms) });
          if (event.msg === Message.SpeechStart) { row.starts++; speech = true; speechMs = 32; mark("SpeechStart"); if (allowDuck && row.kind === "playback" && gain && output) { gain.gain.cancelScheduledValues(output.currentTime); gain.gain.linearRampToValueAtTime(.2, output.currentTime + .08); } }
          if (event.msg === Message.FrameProcessed && speech && event.probs.isSpeech >= .8) { speechMs += 32; if (!confirmed && speechMs >= 500) { confirmed = true; row.confirms++; mark("barge_confirm"); } }
          if (event.msg === Message.SpeechRealStart) { row.realStarts++; mark("SpeechRealStart"); }
          if (event.msg === Message.VADMisfire) { row.misfires++; mark("VADMisfire"); restore(); }
          if (event.msg === Message.SpeechEnd) { row.ends++; mark("SpeechEnd"); restore(); }
        });
      }).catch(error => { processingError = String(error); }).finally(() => { queued--; });
    };
    const startWindow = async (index: number, kind: Window["kind"]) => { current = null; await queue; processor.reset(); processor.resume(); restore(); const row: Window = { index, kind, since: performance.now(), levels: [], starts: 0, realStarts: 0, confirms: 0, ends: 0, misfires: 0, queuedMax: 0, events: [] }; current = row; return row; };
    const finish = async (row: Window, expectedMs: number): Promise<Summary> => { await queue; current = null; if (processingError) throw new Error(processingError); return { index: row.index, ...summarizeLevels(row.levels), starts: row.starts, realStarts: row.realStarts, confirms: row.confirms, ends: row.ends, misfires: row.misfires, queuedMax: row.queuedMax, events: row.events, quality: row.levels.length >= expectedMs / 32 * .8 && row.queuedMax <= 32 }; };
    const oneTrial = async (round: typeof rounds[number], index: number, prompt?: string) => {
      report.state = `${round.mode}-baseline-${index + 1}`; await save(); status(`${round.mode} ${index + 1}：先保持安静5秒`);
      const baselineRow = await startWindow(index + 1, "baseline"); await sleep(5000);
      const baseline = { ...await finish(baselineRow, 5000), durationMs: Math.round(performance.now() - baselineRow.since), levels: baselineRow.levels };
      if (!baseline.quality || baseline.realStarts > 0) { report.failedBaseline = baseline; throw new Error("5秒底噪基线无效或检测到语音，请安静后重测"); }
      const clip = clips[index % clips.length], row = await startWindow(index + 1, "playback");
      report.state = `${round.mode}-playback-${index + 1}`; await save(); status(prompt ? `第${index + 1}次：等绿色提示再说问题` : `${round.mode} ${index + 1}：播放中，请保持安静`);
      let cue: ReturnType<typeof setTimeout> | undefined;
      await new Promise<void>((resolve, reject) => player!.play({ turnId: clip.id, sentences: [{ index: 0, displayStart: 0, displayEnd: 1 }] }, location.origin, null, {
        onSentenceStart: () => { row.events.push({ event: "playback_started", ms: Math.round(performance.now() - row.since) }); if (prompt) cue = setTimeout(() => { document.querySelector("pre")!.setAttribute("style", "color:green;font-size:30px"); status(`现在请说：${prompt}`); }, 1500); },
        onDrained: resolve, onError: reason => reject(new Error(reason)),
      }, clip.seconds * 2000 + 5000));
      clearTimeout(cue); row.events.push({ event: "playback_drained", ms: Math.round(performance.now() - row.since) });
      const summary = await finish(row, clip.seconds * 1000); round.trials.push({ index: index + 1, clip, baseline, playback: summary, settings, ...(prompt ? { prompt } : {}) });
      console.log(JSON.stringify({ mode: round.mode, index: index + 1, maxRmsDbFS: summary.maxRmsDbFS, starts: summary.starts, confirms: summary.confirms })); document.querySelector("pre")!.removeAttribute("style"); await sleep(700); await save();
    };
    status("初始化真实麦克风…"); await openMic(true);
    const quiet = config.prior?.rounds.find(round => round.mode === "aec-on-quiet") ?? { mode: "aec-on-quiet", trials: [] as Trial[], passed: false }; rounds.push(quiet); allowDuck = true;
    if (!config.prior) for (let index = 0; index < 10; index++) await oneTrial(quiet, index);
    quiet.passed = quiet.trials.length === 10 && quiet.trials.every(t => t.playback.quality && t.baseline.quality) && quiet.trials.reduce((sum, t) => sum + t.playback.confirms, 0) === 0 && quiet.trials.reduce((sum, t) => sum + t.playback.starts, 0) <= 2;
    const off = config.prior?.rounds.find(round => round.mode === "aec-off-quiet") ?? { mode: "aec-off-quiet", trials: [] as Trial[], passed: false }; rounds.push(off);
    if (!config.prior) { await openMic(false); allowDuck = false; for (let index = 0; index < 3; index++) await oneTrial(off, index); }
    if (config.prior) {
      if (quiet.trials.length !== 10 || off.trials.length !== 3 || off.trials.some((trial, index) => trial.clip.sha256 !== quiet.trials[index].clip.sha256)) throw new Error("前序配对证据不完整或PCM不一致");
      report.priorEvidence = { path: config.priorPath, sha256: config.priorSha256, originalDecisionRetained: true, correction: "旧判定要求每条都满足，本次按三条整体拾音阳性证据；原始数据不变" };
    }
    const pickup = evaluatePickup(quiet.trials.map(t => t.playback), off.trials.map(t => t.playback)); report.pickup = pickup; off.passed = pickup.passed;
    if (!quiet.passed || !off.passed) { report.state = "blocked-controls"; await save(); status(`对照未通过，需复核摆位。AEC开无人声=${quiet.passed}，AEC关闭拾音证据=${off.passed}。未进入ASR插队。`); return report; }
    await openMic(true); allowDuck = true;
    const human = { mode: "aec-on-human", trials: [] as Trial[], passed: false }; rounds.push(human);
    const prompts = ["本月销售情况怎么样？", "今天有哪些客户要跟进？", "最近的回款情况怎么样？", "各区域发货情况怎么样？", "本月销售目标完成了多少？"];
    report.state = "awaiting-human"; await save();
    for (let index = 0; index < 5; index++) {
      status(`准备第${index + 1}/5次真人对照：点击后先安静5秒，再等绿色提示开口。`); button.textContent = `开始第${index + 1}次真人提问`; button.disabled = false;
      await new Promise<void>(resolve => button.addEventListener("click", () => { button.disabled = true; resolve(); }, { once: true }));
      await oneTrial(human, index, prompts[index]); report.state = index === 4 ? "evaluating" : "awaiting-human"; await save();
    }
    const humanResult = evaluateHuman(human.trials.map(t => t.playback)); report.human = humanResult; human.passed = humanResult.passed;
    report.passed = quiet.passed && off.passed && human.passed; report.state = report.passed ? "completed-passed" : "completed-failed"; await save();
    status(`三组完成：无人声=${quiet.passed}，关AEC拾音=${off.passed}，真人确认=${humanResult.successes}/5。Step0 ${report.passed ? "达到本机门槛" : "不通过"}。`); return report;
  } catch (error) { report.state = "failed"; report.error = String(error); await save().catch(() => {}); throw error; }
  finally { current = null; await queue; await player?.close(); stream?.getTracks().forEach(track => track.stop()); await input?.close(); await model?.release(); }
}
Object.assign(window, { runEchoCheck: run });
button.addEventListener("click", () => { if (suiteRunning) return; void run().catch(error => { Object.assign(window, { echoFailure: String(error) }); status(String(error)); }); });
