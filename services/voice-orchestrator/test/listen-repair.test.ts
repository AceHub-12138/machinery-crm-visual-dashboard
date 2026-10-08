import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ListenWindow } from "../src/listen-window";
import { createVoiceOrchestrator } from "../src/orchestrator";
import { AudioStore } from "../src/tts/audio-store";
import type { SpeechClient } from "../src/tts/voice-local-client";
import type { VoiceHubServer } from "../src/ws/ws-server";
import { ScriptedAdapter } from "../src/llm/scripted";
import { TraceSink } from "../src/trace/metrics";
import type { VoiceWireEvent } from "../../../src/lib/voice/protocol";
import { validatePublicPayload } from "../../../src/lib/voice/public-payload";
import fixture from "../fixtures/public-sales-screen.json";
const stores:AudioStore[]=[], dirs:string[]=[], closes:Array<()=>void>=[];
beforeEach(()=>vi.useFakeTimers());
afterEach(async()=>{closes.splice(0).forEach(f=>f());stores.splice(0).forEach(s=>s.close());vi.useRealTimers();await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
const pcm=new Uint8Array(24000);for(let i=0;i<pcm.length;i+=2)pcm[i]=100;
const screen={id:'screen',role:'screen' as const,send:()=>{},close:()=>{}};
async function setup(text='本月销售怎么样', max=100){
  const events:VoiceWireEvent[]=[];
  const signals:AbortSignal[]=[];
  const client:SpeechClient={health:async()=>({warm:true,selfCheck:'passed',refHash:'a'.repeat(64),styles:['default','warm','serious']}),asr:vi.fn(async()=>({text,ms:100})),tts:async function*(_t,_s,signal){if(signal)signals.push(signal);yield {type:'audio',pcm,sampleRate:24000};yield {type:'done',metrics:{ttsFail:0,ttsTruncated:0,ttsRegenerated:0}};}};
  const dir=await mkdtemp(join(tmpdir(),'listen-repair-'));dirs.push(dir);
  const store=new AudioStore({client,cacheDir:dir,enabled:true});stores.push(store);await store.initialize();
  const llm=new ScriptedAdapter({firstTokenDelayMs:0});
  const orch=createVoiceOrchestrator({hub:{broadcast:(e:VoiceWireEvent)=>events.push(structuredClone(e)),counts:()=>({screens:1,consoles:0})} as unknown as VoiceHubServer,audio:store,speechClient:client,dataSource:{name:'fixture',fetchPayload:async()=>validatePublicPayload(fixture)!},llm,mcp:null,trace:new TraceSink(null),llmTimeoutMs:8000,partialPaceMs:1,partialMaxTotalMs:1,prefetchTimeoutMs:1000,questionMinGapMs:0,questionWindowMs:60000,questionWindowMax:max,mcpToolWhitelist:[]});
  closes.push(()=>orch.forceClose('force'));
  const ack=(turnId:string)=>orch.handleClientMessage(screen,JSON.stringify({type:'playback.drained',at:Date.now(),turnId}));
  const fixed=()=>events.filter(e=>e.type==='speech.fixed').at(-1) as Extract<VoiceWireEvent,{type:'speech.fixed'}>;
  const open=async()=>{orch.beginSession(true);await vi.advanceTimersByTimeAsync(1000);ack(fixed().speech.turnId);await vi.advanceTimersByTimeAsync(1);orch.inputActivity(orch.inputLease!,'ready');};
  return {orch,client,llm,events,signals,store,ack,fixed,open};
}
it('starts 5s at actual ready; emits warm idle exit and permits another wake',async()=>{
  const s=await setup();await s.open();await vi.advanceTimersByTimeAsync(4999);expect(s.orch.state.name).toBe('listening');
  await vi.advanceTimersByTimeAsync(1);expect(s.fixed().speech).toMatchObject({fixed:'idle_exit',style:'warm'});
  s.ack(s.fixed().speech.turnId);await vi.advanceTimersByTimeAsync(1000);expect(s.orch.state.name).toBe('closing');
  expect(s.events.some(e=>e.type==='session.end'&&e.reason==='listen_timeout')).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);expect(s.orch.state.name).toBe('ambient');expect(s.orch.beginSession(true)).toBe(true);
});
it('confirmed speech at second 4 protects a long utterance; misfire resumes remaining time',async()=>{
  const s=await setup();await s.open();const lease=s.orch.inputLease!;
  await vi.advanceTimersByTimeAsync(4000);s.orch.inputActivity(lease,'speech_start');
  await vi.advanceTimersByTimeAsync(4000);expect(s.orch.state.name).toBe('listening');
  s.orch.inputActivity(lease,'misfire');await vi.advanceTimersByTimeAsync(999);expect(s.fixed().speech.fixed).toBe('wake');
  await vi.advanceTimersByTimeAsync(1);expect(s.fixed().speech.fixed).toBe('idle_exit');
});
it('without browser playback/ready reports the server forces exit at cached duration + 5s + 1s',async()=>{
  const s=await setup();s.orch.beginSession(true);await vi.advanceTimersByTimeAsync(6500);
  expect(s.orch.state.name).toBe('closing');await vi.advanceTimersByTimeAsync(1000);expect(s.orch.state.name).toBe('ambient');
});
it('dismissal is screen/current-session-only; stale utterances never reach ASR',async()=>{
  const s=await setup();await s.open();const old=s.orch.inputLease!;
  const msg=(sessionId:string)=>JSON.stringify({type:'session.dismiss',at:Date.now(),sessionId});
  s.orch.handleClientMessage({...screen,role:'unknown'},msg(s.orch.sessionId));s.orch.handleClientMessage(screen,msg('sess-deadbeef'));expect(s.orch.state.name).toBe('listening');
  s.orch.handleClientMessage(screen,msg(s.orch.sessionId));await vi.advanceTimersByTimeAsync(1000);await s.open();
  await expect(s.orch.submitUtterance(new Uint8Array(9600),new AbortController().signal,0,old)).rejects.toMatchObject({status:409});expect(s.client.asr).not.toHaveBeenCalled();
});
it('unheard reopens listening directly; the second consecutive unheard exits',async()=>{
  const s=await setup('小川');await s.open();await s.orch.submitUtterance(new Uint8Array(9600),new AbortController().signal,0,s.orch.inputLease!);
  const full=s.events.filter(e=>e.type==='answer.delta'&&e.full).at(-1) as Extract<VoiceWireEvent,{type:'answer.delta'}>;
  s.ack(full.speech!.turnId);expect(s.orch.state.name).toBe('listening');
  s.orch.inputActivity(s.orch.inputLease!,'ready');await s.orch.submitUtterance(new Uint8Array(9600),new AbortController().signal,0,s.orch.inputLease!);
  expect(s.fixed().speech.fixed).toBe('idle_exit');expect(s.events.filter(e=>e.type==='speech.fixed'&&e.speech.fixed==='followup')).toHaveLength(0);
});
it('rejects an unaccepted wake and globally limits fresh HTTP wake sessions',async()=>{
  const s=await setup('本月销售怎么样',2);s.orch.beginSession(true);expect(s.orch.beginSession(true)).toBe(false);
  s.orch.forceClose('force');await vi.advanceTimersByTimeAsync(1000);s.orch.beginSession(true);s.orch.forceClose('force');await vi.advanceTimersByTimeAsync(1000);
  expect(()=>s.orch.beginSession(true)).toThrow('wake_rate_limited');
});
it.each(['hit','miss'] as const)('speculation %s never publishes before authoritative classification',async outcome=>{
  const s=await setup('销售部最近忙不忙');await s.open();
  let classify!: (intent:'sales_progress'|'unanswerable')=>void;
  vi.spyOn(s.llm,'classify').mockImplementation(()=>new Promise(r=>classify=r));
  const lease=s.orch.inputLease!;await s.orch.submitUtterance(new Uint8Array(9600),new AbortController().signal,0,lease);await vi.advanceTimersByTimeAsync(2);
  expect(s.events.some(e=>e.type==='answer.delta')).toBe(false);const signal=s.signals.at(-1)!;expect(signal.aborted).toBe(false);
  classify(outcome==='hit'?'sales_progress':'unanswerable');await vi.advanceTimersByTimeAsync(2);
  const full=s.events.filter(e=>e.type==='answer.delta'&&e.full).at(-1) as Extract<VoiceWireEvent,{type:'answer.delta'}>;
  expect(full.card?.spoken.includes('合同额')).toBe(outcome==='hit');expect(signal.aborted).toBe(outcome==='miss');
  const trace=s.events.filter(e=>e.type==='trace.turn').at(-1) as Extract<VoiceWireEvent,{type:'trace.turn'}>;expect(trace.trace.speculative).toBe(outcome);
});
it('duplicate ready/start cannot freeze a listen lease indefinitely',async()=>{
  let expired=false;const w=new ListenWindow({sessionId:'sess-aaaaaaaa',listenId:'a'.repeat(36)},'listening',{timeoutMs:5000,expire:()=>expired=true,setTimer:(f,t)=>setTimeout(f,t),clearTimer:h=>clearTimeout(h as ReturnType<typeof setTimeout>)});
  w.report('ready');await vi.advanceTimersByTimeAsync(4000);w.report('ready');w.report('speech_start');await vi.advanceTimersByTimeAsync(15000);w.report('speech_start');await vi.advanceTimersByTimeAsync(1000);expect(expired).toBe(true);
});
it.each(['close','deadline'] as const)('cancels hidden GPU prediction on %s before classification',async why=>{
  const s=await setup();await s.open();vi.spyOn(s.llm,'classify').mockImplementation(()=>new Promise(()=>{}));
  await s.orch.submitUtterance(new Uint8Array(9600),new AbortController().signal,0,s.orch.inputLease!);await vi.advanceTimersByTimeAsync(2);
  const signal=s.signals.at(-1)!;expect(signal.aborted).toBe(false);
  if(why==='close')s.orch.forceClose('force');else await vi.advanceTimersByTimeAsync(8000);
  expect(signal.aborted).toBe(true);expect(s.events.some(e=>e.type==='answer.delta')).toBe(false);
});
