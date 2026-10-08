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
const screen={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',role:'screen' as const,send:()=>{},close:()=>{}};
async function setup(text='本月销售怎么样', max=100, connectedScreens=false){
  const events:VoiceWireEvent[]=[];
  const signals:AbortSignal[]=[];
  const client:SpeechClient={health:async()=>({warm:true,selfCheck:'passed',refHash:'a'.repeat(64),styles:['default','warm','serious']}),asr:vi.fn(async()=>({text,ms:100})),tts:async function*(_t,_s,signal){if(signal)signals.push(signal);yield {type:'audio',pcm,sampleRate:24000};yield {type:'done',metrics:{ttsFail:0,ttsTruncated:0,ttsRegenerated:0}};}};
  const dir=await mkdtemp(join(tmpdir(),'listen-repair-'));dirs.push(dir);
  const store=new AudioStore({client,cacheDir:dir,enabled:true});stores.push(store);await store.initialize();
  const llm=new ScriptedAdapter({firstTokenDelayMs:0});
  const orch=createVoiceOrchestrator({hub:{broadcast:(e:VoiceWireEvent)=>events.push(structuredClone(e)),connections:connectedScreens?new Set([screen,{...screen,id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}]):undefined,counts:()=>({screens:connectedScreens?2:1,consoles:0})} as unknown as VoiceHubServer,audio:store,speechClient:client,dataSource:{name:'fixture',fetchPayload:async()=>validatePublicPayload(fixture)!},llm,mcp:null,trace:new TraceSink(null),llmTimeoutMs:8000,partialPaceMs:1,partialMaxTotalMs:1,prefetchTimeoutMs:1000,questionMinGapMs:0,questionWindowMs:60000,questionWindowMax:max,mcpToolWhitelist:[]});
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
it('missing cached playback ack exits with error and never opens the microphone',async()=>{
  const s=await setup();s.orch.beginSession(true);await vi.advanceTimersByTimeAsync(3000);
  expect(s.orch.state.name).toBe('closing');expect(s.orch.inputLease).toBeNull();expect(s.events.some(e=>e.type==='session.end'&&e.reason==='error')).toBe(true);await vi.advanceTimersByTimeAsync(1000);expect(s.orch.state.name).toBe('ambient');
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

const secondScreen={...screen,id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'};
function report(s:Awaited<ReturnType<typeof setup>>,conn:typeof screen,type:string,turnId:string,reason?:string){
  s.orch.handleClientMessage(conn,JSON.stringify({type,at:Date.now(),turnId,...(reason?{reason}:{})}));
}
async function spokenAnswer(s:Awaited<ReturnType<typeof setup>>){
  await s.open();await s.orch.submitUtterance(new Uint8Array(9600),new AbortController().signal,0,s.orch.inputLease!);await vi.advanceTimersByTimeAsync(2);
  return (s.events.filter(e=>e.type==='answer.delta'&&e.full).at(-1) as Extract<VoiceWireEvent,{type:'answer.delta'}>).speech!.turnId;
}
it('the HTTP wake screen owns cached speech and input, even when it connected second',async()=>{
  const s=await setup(undefined,100,true);
  expect(()=>s.orch.beginSession(true,'cccccccc-cccc-cccc-cccc-cccccccccccc')).toThrow('screen_not_connected');
  s.orch.beginSession(true,secondScreen.id);await vi.advanceTimersByTimeAsync(1000);
  expect(s.events.find(e=>e.type==='session.start')).toMatchObject({screenId:secondScreen.id});
  s.ack(s.fixed().speech.turnId);expect(s.orch.state.name).toBe('waking');
  report(s,secondScreen,'playback.drained',s.fixed().speech.turnId);await vi.advanceTimersByTimeAsync(1);
  expect(s.orch.inputLease).toMatchObject({screenId:secondScreen.id});
  const lease=s.orch.inputLease!;
  expect(()=>s.orch.inputActivity({...lease,screenId:screen.id},'ready')).toThrow('stale_listen_window');
  await expect(s.orch.submitUtterance(new Uint8Array(9600),new AbortController().signal,0,{...lease,screenId:screen.id})).rejects.toMatchObject({status:409,message:'screen_not_session_owner'});
  expect(s.client.asr).not.toHaveBeenCalled();s.orch.inputActivity(lease,'ready');
});
it('owner drain opens 8s long window; only owner ready starts it, then 5s short window and warm exit',async()=>{
  const s=await setup(undefined,100,true),id=await spokenAnswer(s);
  report(s,secondScreen,'playback.drained',id);expect(s.orch.state.name).toBe('answering');
  s.ack(id);expect(s.orch.state.name).toBe('followup');
  const lease=s.orch.inputLease!;
  expect(()=>s.orch.inputActivity({...lease,screenId:secondScreen.id},'ready')).toThrow('stale_listen_window');
  await vi.advanceTimersByTimeAsync(200);s.orch.inputActivity(lease,'ready');s.ack(id);
  await vi.advanceTimersByTimeAsync(7999);expect(s.fixed().speech.fixed).toBe('wake');
  await vi.advanceTimersByTimeAsync(1);expect(s.fixed().speech.fixed).toBe('followup');expect(s.orch.inputLease).toBeNull();
  report(s,secondScreen,'playback.drained',s.fixed().speech.turnId);expect(s.orch.inputLease).toBeNull();
  s.ack(s.fixed().speech.turnId);await vi.advanceTimersByTimeAsync(900);
  s.orch.inputActivity(s.orch.inputLease!,'ready');await vi.advanceTimersByTimeAsync(4999);expect(s.fixed().speech.fixed).toBe('followup');
  await vi.advanceTimersByTimeAsync(1);expect(s.fixed().speech.fixed).toBe('idle_exit');
  s.ack(s.fixed().speech.turnId);await vi.advanceTimersByTimeAsync(1800);expect(s.orch.state.name).toBe('ambient');
});
it.each(['autoplay_blocked','audio_interrupted','audio_unavailable','timeout'])('owner failure %s keeps the card and exits without spoken followup, with diagnostic identity',async reason=>{
  const s=await setup(undefined,100,true),id=await spokenAnswer(s);
  report(s,screen,'playback.failed',id,reason);expect(s.orch.state.name).toBe('answering');expect(s.orch.answer?.card.kind).toBe('target-progress');
  const trace=s.events.filter(e=>e.type==='trace.turn').at(-1) as Extract<VoiceWireEvent,{type:'trace.turn'}>;
  expect(trace.trace).toMatchObject({playbackOutcome:reason==='timeout'?'timeout':'failed',playbackFailureReason:reason,playbackScreenId:screen.id,playbackScreenCount:2});
  expect(trace.trace.playbackEndMs).toBeGreaterThanOrEqual(0);
  await vi.advanceTimersByTimeAsync(7999);expect(s.orch.state.name).toBe('answering');
  await vi.advanceTimersByTimeAsync(1);expect(s.orch.state.name).toBe('closing');expect(s.events.some(e=>e.type==='speech.fixed'&&e.speech.fixed==='followup')).toBe(false);
});
it.each(['disconnect','supersede'] as const)('pending 8s followup is cancelled on owner %s',async why=>{
  const s=await setup(undefined,100,true),id=await spokenAnswer(s);s.ack(id);await vi.advanceTimersByTimeAsync(4000);
  if(why==='disconnect'){s.orch.detach(secondScreen);expect(s.orch.state.name).toBe('followup');s.orch.detach(screen);expect(s.orch.state.name).toBe('closing');}
  else{s.orch.handleClientMessage({...screen,role:'console'},JSON.stringify({type:'question.submit',at:Date.now(),text:'客户有多少'}));}
  await vi.advanceTimersByTimeAsync(4000);
  expect(s.events.some(e=>e.type==='speech.fixed'&&e.speech.fixed==='followup')).toBe(false);
  if(why==='supersede')expect(s.orch.state.name).toBe('answering');
});
it('owner fixed wake/followup failure never opens a microphone lease',async()=>{
  const s=await setup(undefined,100,true);s.orch.beginSession(true);report(s,screen,'playback.failed',s.fixed().speech.turnId,'autoplay_blocked');
  expect(s.orch.state.name).toBe('closing');expect(s.orch.inputLease).toBeNull();await vi.advanceTimersByTimeAsync(1000);
  const id=await spokenAnswer(s);s.ack(id);s.orch.inputActivity(s.orch.inputLease!,'ready');await vi.advanceTimersByTimeAsync(8000);
  report(s,screen,'playback.failed',s.fixed().speech.turnId,'audio_unavailable');expect(s.orch.state.name).toBe('closing');expect(s.orch.inputLease).toBeNull();
});

function attempt(s: Awaited<ReturnType<typeof setup>>, index=0) {
  const lease = s.events.filter(e=>e.type==='input.listen'&&e.mode==='barge').at(-1) as Extract<VoiceWireEvent,{type:'input.listen'}>;
  return {...lease,screenId:screen.id,attemptId:crypto.randomUUID(),sentenceIndex:index};
}
it.each(['echo','unheard'] as const)('rejects %s without cancelling old audio or using business quota',async reason=>{
  const s=await setup(undefined,1,true),id=await spokenAnswer(s),lease=attempt(s);
  vi.mocked(s.client.asr).mockResolvedValue({text:reason==='echo'?s.store.lookup(id)!.spokenSentences[0].spokenText:'',ms:100});
  s.orch.inputActivity(lease,'duck');s.orch.inputActivity(lease,'pause');
  await s.orch.submitUtterance(new Uint8Array(16000),new AbortController().signal,0,lease);
  expect(s.orch.state.name).toBe('answering');expect(s.store.lookup(id)?.cancelled).toBe(false);
  expect(s.events.filter(e=>e.type==='barge.result').at(-1)).toMatchObject({accepted:false,reason});
  expect(()=>s.orch.inputActivity(lease,'duck')).toThrow('stale_attempt');
});
it('valid wake interruption cancels its exit callback and accepts a new question',async()=>{
  const s=await setup(undefined,100,true);s.orch.beginSession(true);const id=s.fixed().speech.turnId,lease=attempt(s);
  s.orch.inputActivity(lease,'duck');s.orch.inputActivity(lease,'pause');await s.orch.submitUtterance(new Uint8Array(16000),new AbortController().signal,0,lease);
  await vi.advanceTimersByTimeAsync(2);expect(s.store.lookup(id)?.cancelled).toBe(true);expect(s.orch.state.name).toBe('answering');
  s.ack(id);expect(s.orch.state.name).toBe('answering');
});
it('a valid question pauses for 15s; judge timeout starts at upload and late ASR cannot cancel a replacement',async()=>{
  const s=await setup(undefined,100,true),id=await spokenAnswer(s),lease=attempt(s);
  s.orch.inputActivity(lease,'duck');await vi.advanceTimersByTimeAsync(15000);expect(s.orch.state.name).toBe('answering');
  let resolve!: (value:{text:string;ms:number})=>void;vi.mocked(s.client.asr).mockImplementation(()=>new Promise(r=>resolve=r));
  const pending=s.orch.submitUtterance(new Uint8Array(16000),new AbortController().signal,0,lease);
  await vi.advanceTimersByTimeAsync(5999);expect(s.events.some(e=>e.type==='barge.result')).toBe(false);
  await vi.advanceTimersByTimeAsync(1);expect(s.events.filter(e=>e.type==='barge.result').at(-1)).toMatchObject({reason:'timeout'});
  s.orch.handleClientMessage({...screen,role:'console'},JSON.stringify({type:'question.submit',at:Date.now(),text:'客户有多少'}));await vi.advanceTimersByTimeAsync(300);
  resolve({text:'本月销量',ms:100});await pending;expect(s.orch.state.name).toBe('answering');expect(s.store.lookup(id)?.cancelled).toBe(true);
});
it('cross-drain candidate pauses long window and misfire resumes exactly its remaining budget',async()=>{
  const s=await setup(undefined,100,true),id=await spokenAnswer(s),lease=attempt(s);
  s.orch.inputActivity(lease,'duck');s.ack(id);s.orch.inputActivity(s.orch.inputLease!,'ready');
  await vi.advanceTimersByTimeAsync(7000);expect(s.fixed().speech.fixed).toBe('wake');s.orch.inputActivity(lease,'misfire');
  await vi.advanceTimersByTimeAsync(7999);expect(s.fixed().speech.fixed).toBe('wake');await vi.advanceTimersByTimeAsync(1);expect(s.fixed().speech.fixed).toBe('followup');
});
it('foreign and previous barge leases cannot reach ASR or pause playback',async()=>{
  const s=await setup(undefined,100,true);await spokenAnswer(s);const lease=attempt(s);
  expect(()=>s.orch.inputActivity({...lease,screenId:secondScreen.id},'duck')).toThrow('stale_listen_window');
  s.orch.forceClose('force');await vi.advanceTimersByTimeAsync(1000);await s.open();
  await expect(s.orch.submitUtterance(new Uint8Array(16000),new AbortController().signal,0,lease)).rejects.toMatchObject({status:409});
});
it.each(['followup','idle_exit'] as const)('fixed %s can be interrupted before it completes',async key=>{
  const s=await setup(undefined,100,true),id=await spokenAnswer(s);s.ack(id);s.orch.inputActivity(s.orch.inputLease!,'ready');await vi.advanceTimersByTimeAsync(8000);
  if(key==='idle_exit'){s.ack(s.fixed().speech.turnId);await vi.advanceTimersByTimeAsync(900);s.orch.inputActivity(s.orch.inputLease!,'ready');await vi.advanceTimersByTimeAsync(5000);}
  const old=s.fixed().speech.turnId,lease=attempt(s);s.orch.inputActivity(lease,'duck');s.orch.inputActivity(lease,'pause');
  vi.mocked(s.client.asr).mockResolvedValue({text:'客户有多少',ms:100});await s.orch.submitUtterance(new Uint8Array(16000),new AbortController().signal,0,lease);await vi.advanceTimersByTimeAsync(2);
  s.ack(old);expect(s.orch.state.name).toBe('answering');expect(s.store.lookup(old)?.cancelled).toBe(true);
});

it('multiple rejected attempts retain a separate history and leave room for the next valid business question',async()=>{
  const s=await setup(undefined,2,true),id=await spokenAnswer(s);
  for(let i=0;i<2;i++){
    const lease=attempt(s);vi.mocked(s.client.asr).mockResolvedValue({text:'',ms:100});s.orch.inputActivity(lease,'duck');await s.orch.submitUtterance(new Uint8Array(16000),new AbortController().signal,0,lease);
  }
  const lease=attempt(s);vi.mocked(s.client.asr).mockResolvedValue({text:'客户有多少',ms:100});s.orch.inputActivity(lease,'duck');s.orch.inputActivity(lease,'pause');await s.orch.submitUtterance(new Uint8Array(16000),new AbortController().signal,0,lease);await vi.advanceTimersByTimeAsync(2);
  expect(s.events.filter(e=>e.type==='barge.result')).toHaveLength(3);expect(s.events.filter(e=>e.type==='barge.result').at(-1)).toMatchObject({accepted:true});expect(s.store.lookup(id)?.cancelled).toBe(true);
});
it('valid but limited barge gives apologetic unheard then reopens, without an idle exit',async()=>{
  const s=await setup(undefined,1,true);await spokenAnswer(s);const lease=attempt(s);vi.mocked(s.client.asr).mockResolvedValue({text:'客户有多少',ms:100});
  s.orch.inputActivity(lease,'duck');s.orch.inputActivity(lease,'pause');await s.orch.submitUtterance(new Uint8Array(16000),new AbortController().signal,0,lease);
  expect(s.events.filter(e=>e.type==='barge.result').at(-1)).toMatchObject({accepted:false,reason:'rate_limited'});
  const full=s.events.filter(e=>e.type==='answer.delta'&&e.full).at(-1) as Extract<VoiceWireEvent,{type:'answer.delta'}>;
  expect(full.speech?.fixed).toBe('unheard');s.ack(full.speech!.turnId);expect(s.orch.state.name).toBe('listening');expect(s.fixed().speech.fixed).toBe('wake');
});
