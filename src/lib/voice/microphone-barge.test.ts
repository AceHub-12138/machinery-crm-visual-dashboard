import { afterEach, expect, it, vi } from "vitest";
import { FrameProcessor, type FrameProcessorEvent } from "@ricky0123/vad-web/dist/frame-processor";
import { Message } from "@ricky0123/vad-web/dist/messages";
import { VoiceMicrophone, type InputConfig, type MicLease } from "./microphone";
import type { VoiceStateName } from "./session-machine";
type Internals = {handleVad:(e:FrameProcessorEvent)=>void;segment:MicLease|null;pendingAttempt:MicLease|null;processor:FrameProcessor;queue:Promise<void>;activityQueue:Promise<void>;busy:boolean;config:InputConfig};
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
afterEach(()=>vi.unstubAllGlobals());
async function setup(){
  let state:VoiceStateName='answering';const barge=vi.fn(),notice=vi.fn();
  const requests:Array<{url:string;lease:string|null}>=[];
  const fetcher=vi.fn(async(url:string,init:RequestInit)=>{requests.push({url,lease:new Headers(init.headers).get('x-voice-listen')});return new Response(null,{status:202});});vi.stubGlobal('fetch',fetcher);
  const mic=new VoiceMicrophone({hubUrl:'ws://localhost:3210',token:'test',state:()=>state,barge,notice});
  let probability=0;
  const processor=new FrameProcessor(async()=>({isSpeech:probability,notSpeech:1-probability}),()=>{}, {positiveSpeechThreshold:.8,negativeSpeechThreshold:.65,redemptionMs:64,preSpeechPadMs:500,minSpeechMs:300,submitUserSpeechOnPause:false},32);
  processor.resume();
  const internals=mic as unknown as Internals;Object.assign(mic,{processor,config:{hangoverMs:64,micReopenDelayMs:300,vadMinSpeechMs:200,bargeMinSpeechMs:300,bargeConfirmMs:500}});
  mic.setSession('sess-aaaaaaaa');mic.setConnected(true);const lease:MicLease={sessionId:'sess-aaaaaaaa',listenId:'a'.repeat(36),mode:'barge',turnId:'b'.repeat(36)};mic.setListen(lease);await flush();
  const event=(msg:Message)=>internals.handleVad(msg===Message.SpeechEnd?{msg,audio:new Float32Array(9600)}:msg===Message.FrameProcessed?{msg,probs:{isSpeech:1,notSpeech:0},frame:new Float32Array(512)}:{msg} as FrameProcessorEvent);
  const start=async()=>{event(Message.SpeechStart);event(Message.SpeechRealStart);processor.speechFrameCount=16;event(Message.FrameProcessed);await flush();return internals.pendingAttempt!.attemptId!;};
  const ordinary=async()=>{state='followup';mic.playbackEnded(0);mic.setListen({sessionId:'sess-aaaaaaaa',listenId:'c'.repeat(36),mode:'followup'});await flush();};
  const frames=async(p:number,n:number)=>{probability=p;for(let i=0;i<n;i++)await processor.process(new Float32Array(512),internals.handleVad.bind(mic));await flush();};
  return {mic,internals,processor,barge,notice,requests,fetcher,event,start,ordinary,frames,state:(next:VoiceStateName)=>{state=next;}};
}
it.each(['http-first','result-first'] as const)('rejection resumes even if the upload segment was cleared: %s',async order=>{
  const s=await setup();let complete!:()=>void;
  s.fetcher.mockImplementation(async(url,init)=>{s.requests.push({url,lease:new Headers(init.headers).get('x-voice-listen')});if(url.includes('/voice/utterance'))await new Promise<void>(r=>complete=r);return new Response(null,{status:202});});
  const id=await s.start();s.event(Message.SpeechEnd);await flush();expect(s.internals.segment).toBeNull();
  if(order==='http-first'){complete();await flush();expect(s.internals.busy).toBe(false);}
  expect(s.mic.bargeResult(id,false)).toBe(true);expect(s.barge).toHaveBeenLastCalledWith('resume','b'.repeat(36));
  if(order==='result-first'){complete();await flush();}
  expect(s.mic.bargeResult(id,false)).toBe(false);
});
it('limit result resolves identity without resuming replaced audio',async()=>{
  const s=await setup(),id=await s.start();expect(s.mic.bargeResult(id,false,'rate_limited')).toBe(true);expect(s.barge.mock.calls.map(c=>c[0])).toEqual(['duck','pause']);
});
it('SpeechStart noise never ducks or opens an attempt; real speech does',async()=>{
  const s=await setup();await s.frames(.99,2);await s.frames(0,2);expect(s.barge).not.toHaveBeenCalled();expect(s.requests).toHaveLength(0);
  await s.frames(.99,9);expect(s.barge).toHaveBeenCalledWith('duck','b'.repeat(36));
});
it('tail uses ordinary threshold and independent minimum for a short reply',async()=>{
  const s=await setup();await s.ordinary();expect(s.processor.options.positiveSpeechThreshold).toBe(.5);expect(s.processor.options.minSpeechMs).toBe(200);
  await s.frames(.6,7);await s.frames(0,2);
  expect(s.requests.filter(r=>r.url.includes('/voice/utterance'))).toEqual([{url:'http://localhost:3210/voice/utterance',lease:'c'.repeat(36)}]);expect(s.barge).not.toHaveBeenCalled();
});
it('a sub-confirmation phrase crossing drain is submitted on the new ordinary lease',async()=>{
  const s=await setup();await s.frames(.99,10);await s.ordinary();await s.frames(0,2);
  const uploads=s.requests.filter(r=>r.url.includes('/voice/utterance'));expect(uploads).toHaveLength(1);expect(uploads[0].lease).toBe('c'.repeat(36));expect(uploads[0].url).not.toContain('attemptId');
});
it('reset clears a partial segment; the next speech uses a fresh lease',async()=>{
  const s=await setup();s.event(Message.SpeechStart);expect(s.internals.segment).not.toBeNull();
  s.state('thinking');s.mic.setConnected(true);await flush();expect(s.internals.segment).toBeNull();
  s.state('listening');s.mic.setListen({sessionId:'sess-aaaaaaaa',listenId:'d'.repeat(36),mode:'listening'});await flush();s.event(Message.SpeechStart);expect(s.internals.segment?.listenId).toBe('d'.repeat(36));
});
it('128-attempt refusal does not lose an utterance crossing into ordinary listening',async()=>{
  const s=await setup();s.fetcher.mockImplementation(async(url,init)=>{s.requests.push({url,lease:new Headers(init.headers).get('x-voice-listen')});return new Response(null,{status:url.includes('action=duck')?429:202});});
  await s.frames(.99,10);expect(s.internals.pendingAttempt).toBeNull();expect(s.barge).toHaveBeenLastCalledWith('resume','b'.repeat(36));
  await s.ordinary();await s.frames(0,2);expect(s.requests.filter(r=>r.url.includes('/voice/utterance')).map(r=>r.lease)).toEqual(['c'.repeat(36)]);
});
it('a previous session cannot resume a new answer',async()=>{
  const s=await setup(),id=await s.start();s.mic.setSession('sess-bbbbbbbb');expect(s.mic.bargeResult(id,false)).toBe(false);expect(s.barge.mock.calls.map(c=>c[0])).toEqual(['duck','pause']);
});
