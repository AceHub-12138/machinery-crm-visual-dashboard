import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceOrchestrator } from "../src/orchestrator";
import { ScriptedAdapter } from "../src/llm/scripted";
import { TraceSink } from "../src/trace/metrics";
import type { SpeechClient } from "../src/tts/voice-local-client";
import type { VoiceHubServer } from "../src/ws/ws-server";
import fixture from "../fixtures/public-sales-screen.json";
import { validatePublicPayload } from "../../../src/lib/voice/public-payload";
import { VOICE_TIMING } from "../../../src/lib/voice/session-machine";
const pcm=new Uint8Array(9600);
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
function setup(text="你好小川，本月销售怎么样") {
  const events:Array<{type:string;text?:string,full?:boolean,speech?:unknown}>=[];
  const hub={broadcast:(event:unknown)=>events.push(event as typeof events[number]),counts:()=>({screens:0,consoles:1})} as unknown as VoiceHubServer;
  const asr=vi.fn(async()=>({text,ms:120}));
  const speechClient={asr} as unknown as SpeechClient;
  const llm=new ScriptedAdapter({firstTokenDelayMs:0});const classify=vi.spyOn(llm,'classify');
  const orch=createVoiceOrchestrator({hub,speechClient,dataSource:{name:'fixture',fetchPayload:async()=>validatePublicPayload(fixture)!},llm,mcp:null,trace:new TraceSink(null),llmTimeoutMs:8000,partialPaceMs:45,partialMaxTotalMs:1200,prefetchTimeoutMs:1000,questionMinGapMs:1000,questionWindowMs:60000,questionWindowMax:10,mcpToolWhitelist:[]});
  return {orch,events,asr,classify};
}
describe('ASR session safety and immediate classification',()=>{
  it('requires a listening window, strips prefix and skips simulated transcript delay',async()=>{
    const s=setup();await expect(s.orch.submitUtterance(pcm,new AbortController().signal)).rejects.toMatchObject({status:409});expect(s.asr).not.toHaveBeenCalled();
    s.orch.beginSession(true);await vi.advanceTimersByTimeAsync(VOICE_TIMING.wakingMs);
    await s.orch.submitUtterance(pcm,new AbortController().signal);expect(s.orch.state.name).toBe('thinking');
    expect(s.events.find(e=>e.type==='asr.partial'&&e.full===undefined)?.text).toBe('本月销售怎么样');
    await vi.advanceTimersByTimeAsync(1);expect(s.classify).toHaveBeenCalledWith('本月销售怎么样',expect.any(AbortSignal));
    await expect(s.orch.submitUtterance(pcm,new AbortController().signal)).rejects.toMatchObject({status:409});s.orch.forceClose('force');
  });
  it('empty recognition produces unheard and keeps a followup window',async()=>{
    const s=setup('小川');s.orch.beginSession(true);await vi.advanceTimersByTimeAsync(VOICE_TIMING.wakingMs);
    await s.orch.submitUtterance(pcm,new AbortController().signal);expect(s.orch.answer?.spoken).toContain('没有听清');expect(s.classify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);expect(s.orch.state.name).toBe('followup');s.orch.beginListening();expect(s.orch.state.name).toBe('listening');
    await expect(s.orch.submitUtterance(pcm,new AbortController().signal)).resolves.toBeUndefined();s.orch.forceClose('force');
  });
  it('shares the global question limit with console input',async()=>{
    const s=setup();s.orch.beginSession(true);await vi.advanceTimersByTimeAsync(VOICE_TIMING.wakingMs);await s.orch.submitUtterance(pcm,new AbortController().signal);await vi.advanceTimersByTimeAsync(1);
    s.orch.handleClientMessage({id:'console',role:'console',send:ev=>s.events.push(ev as typeof s.events[number]),close:()=>{}},JSON.stringify({type:'question.submit',at:Date.now(),text:'客户多少'}));expect(s.events.at(-1)?.type).toBe('error');s.orch.forceClose('force');
  });
});
