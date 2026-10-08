import { describe, expect, it, vi } from "vitest";
import { stripWakePrefix, isUnheard } from "./asr-text";
import { captureMode, toPcm16, VoiceMicrophone } from "./microphone";
import { classifyScriptedQuestion, parseIntent } from "./intents";
import { speechStyleFor } from "./speech-style";
import fixture from "../../../services/voice-orchestrator/fixtures/public-sales-screen.json";
import { validatePublicPayload } from "./public-payload";
import { normalizeSpokenText } from "./spoken-normalize";
const payload = validatePublicPayload(fixture)!;
describe("spoken input and scene policy", () => {
  it("strips only leading assistant address and preserves company references", () => {
    for (const q of ["你好小川,本月销售", "你好，小 川。 本月销售", "小川：本月销售"]) expect(stripWakePrefix(q)).toBe("本月销售");
    expect(stripWakePrefix("大川机床销售怎么样")).toBe("大川机床销售怎么样");
    expect(isUnheard(stripWakePrefix("你好，小川"))).toBe(true);
    expect(isUnheard("啊！")).toBe(true); expect(isUnheard("你好")).toBe(false);
  });
  it("greetings keep the conversation and the strict model schema agrees", () => {
    expect(classifyScriptedQuestion("你好！")).toBe("greeting");
    expect(parseIntent('{"intent":"greeting"}')).toBe("greeting");
    expect(classifyScriptedQuestion("你好，销售怎么样")).toBe("sales_progress");
    expect(classifyScriptedQuestion("谢谢，没有了")).toBe("chitchat_or_end");
  });
  it("half duplex rejects every output state and latency hold", () => {
    for (const state of ["waking", "thinking", "answering", "closing", "error-fallback"] as const) expect(captureMode(state, true, false)).toBe("off");
    expect(captureMode("ambient", true, false)).toBe("kws");
    expect(captureMode("followup", true, false)).toBe("vad");
    expect(captureMode("listening", true, true)).toBe("off");
    expect(captureMode("ambient", false, false)).toBe("off");
  });
  it("encodes little endian PCM and caps recording at 15 seconds", () => {
    const view = new DataView(toPcm16(new Float32Array([-2, 0, 2])).buffer);
    expect([view.getInt16(0, true), view.getInt16(2, true), view.getInt16(4, true)]).toEqual([-32768, 0, 32767]);
    expect(toPcm16(new Float32Array(300000)).length).toBe(480000);
  });
  it("selects one style from intent/data and supports explicit overrides", () => {
    expect(speechStyleFor("sales_progress", { ...payload, collection: { ...payload.collection, exceeded: false } })).toBe("default");
    expect(speechStyleFor("collection", { ...payload, collection: { ...payload.collection, exceeded: true } })).toBe("cheerful");
    expect(speechStyleFor("followup_todo", { ...payload, kpis: { ...payload.kpis, overdueFollowUp: 1 } })).toBe("serious");
    expect(speechStyleFor("unanswerable", payload)).toBe("apologetic");
    expect(speechStyleFor("chitchat_or_end", payload)).toBe("warm");
    expect(speechStyleFor("greeting", payload)).toBe("cheerful");
    expect(speechStyleFor("followup_todo", payload, { followup_todo: "advise" })).toBe("advise");
  });
  it("reads new measure words as liang without changing ordinals", () => {
    for (const unit of ["天", "周", "次", "位", "名", "人", "种", "批", "份", "套"]) expect(normalizeSpokenText(`2${unit}，第2${unit}`)).toBe(`两${unit}，第二${unit}`);
  });
});

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
it("the actual worklet resamples 48kHz and 44.1kHz across packet boundaries and emits no gated frames", () => {
  for (const rate of [48000, 44100]) {
    const frames: Float32Array[] = [];
    let Processor: new () => { port: { onmessage: (event: { data: { enabled: boolean } }) => void }; process: (input: Float32Array[][]) => boolean };
    runInNewContext(readFileSync("public/voice/mic-worklet.js", "utf8"), {
      AudioWorkletProcessor: class { port = { postMessage: (frame: Float32Array) => frames.push(frame), onmessage: null }; },
      sampleRate: rate, Float32Array, registerProcessor: (_name: string, type: typeof Processor) => { Processor = type; },
    });
    const mic = new Processor!(); mic.port.onmessage({ data: { enabled: true } });
    for (let start = 0; start < rate; start += 128) {
      const frame = Float32Array.from({ length: Math.min(128, rate-start) }, (_, i) => Math.sin((start+i)*2*Math.PI*440/rate));
      mic.process([[frame]]);
    }
    expect(frames.length).toBe(31);
    const audio = Float32Array.from(frames.flatMap(f => [...f]));
    const mse = audio.reduce((sum, value, index) => sum + (value-Math.sin(index*2*Math.PI*440/16000))**2, 0)/audio.length;
    expect(mse).toBeLessThan(.00001);
    mic.port.onmessage({ data: { enabled: false } }); mic.process([[new Float32Array(48000)]]);
    expect(frames.length).toBe(31);
  }
});

it.each(["您好小川，本月销售怎么样", "小船，本月销售怎么样", "晓川，本月销售怎么样", "您好晓川，本月销售怎么样"])("ASR address variant %s strips only prefix",text=>{expect(stripWakePrefix(text)).toBe("本月销售怎么样");expect(stripWakePrefix("请问小船和晓川的订单")).toBe("请问小船和晓川的订单");});

it('listen ready waits for initialized microphone and running context; track is enabled first',async()=>{
  const track={enabled:false},context={state:'suspended'};
  const request=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{expect(track.enabled).toBe(true);return new Response(null,{status:202});});
  try{
    const mic=new VoiceMicrophone({hubUrl:'ws://localhost:3210',token:'screen',state:()=> 'listening',notice:()=>{}});
    mic.setConnected(true);mic.setSession('sess-aaaaaaaa');mic.setListen({sessionId:'sess-aaaaaaaa',listenId:'a'.repeat(36)});expect(request).not.toHaveBeenCalled();
    Object.assign(mic,{mode:'off',stream:{getAudioTracks:()=>[track]},context,worklet:{port:{postMessage:()=>{}}}});
    mic.setConnected(true);expect(request).not.toHaveBeenCalled();context.state='running';mic.setConnected(true);mic.setConnected(true);
    expect(request).toHaveBeenCalledTimes(1);expect(String(request.mock.calls[0][0])).toContain('/voice/listen?action=ready');
    await Promise.resolve();
  }finally{request.mockRestore();}
});
