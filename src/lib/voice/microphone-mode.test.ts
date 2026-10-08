import { expect, it, vi } from "vitest";
import { VoiceMicrophone } from "./microphone";
import type { VoiceStateName } from "./session-machine";
it("barge to vad and a new lease preserve VAD history; thinking and passive screens disable capture", async () => {
  let state: VoiceStateName = "answering";
  const reset=vi.fn(),setOptions=vi.fn(),track={enabled:false};
  const mic=new VoiceMicrophone({hubUrl:"ws://localhost:3210",token:"test",state:()=>state,notice:()=>{}});
  mic.setSession("sess-aaaaaaaa");mic.setConnected(true);
  Object.assign(mic,{stream:{getAudioTracks:()=>[track]},processor:{reset,resume:()=>{},setOptions}});
  mic.setListen({sessionId:"sess-aaaaaaaa",listenId:"a".repeat(36),mode:"barge",turnId:"a".repeat(36)});
  for(let i=0;i<10;i++)await Promise.resolve();reset.mockClear();
  const segment={sessionId:"sess-aaaaaaaa",listenId:"a".repeat(36),mode:"barge",attemptId:"attempt"};Object.assign(mic,{segment});
  state="followup";mic.setListen({sessionId:"sess-aaaaaaaa",listenId:"b".repeat(36),mode:"followup"});
  for(let i=0;i<10;i++)await Promise.resolve();
  expect(reset).not.toHaveBeenCalled();expect(track.enabled).toBe(true);expect((mic as unknown as {segment:unknown}).segment).toBe(segment);
  state="thinking";mic.setConnected(true);expect(track.enabled).toBe(false);
  state="answering";mic.setSession("sess-aaaaaaaa",false);mic.setListen({sessionId:"sess-aaaaaaaa",listenId:"c".repeat(36),mode:"barge",turnId:"c".repeat(36)});expect(track.enabled).toBe(false);
});
