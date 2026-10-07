import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AudioStore } from "../services/voice-orchestrator/src/tts/audio-store";
import { createAudioHttpHandler } from "../services/voice-orchestrator/src/tts/http-audio";
import { createInputHttpHandler } from "../services/voice-orchestrator/src/http-input";
import { startVoiceHub } from "../services/voice-orchestrator/src/ws/ws-server";
import { createVoiceOrchestrator } from "../services/voice-orchestrator/src/orchestrator";
import { ScriptedAdapter } from "../services/voice-orchestrator/src/llm/scripted";
import { TraceSink } from "../services/voice-orchestrator/src/trace/metrics";
import { validatePublicPayload } from "../src/lib/voice/public-payload";
import type { SpeechClient } from "../services/voice-orchestrator/src/tts/voice-local-client";
import { readFileSync } from "node:fs";
const fixture=validatePublicPayload(JSON.parse(readFileSync(new URL("../services/voice-orchestrator/fixtures/public-sales-screen.json",import.meta.url),'utf8')))!;
test.use({launchOptions:{args:['--autoplay-policy=no-user-gesture-required']}});
test('AudioWorklet + local Silero: F9 wake, half duplex, and followup voice longer than 3s',async({page})=>{
  test.setTimeout(45000);
  let calls=0;const cache=await mkdtemp(join(tmpdir(),'voice-input-e2e-'));const screenToken='voice-input-screen-token',consoleToken='voice-input-console-token';
  const client:SpeechClient={health:async()=>({warm:true,selfCheck:'passed',refHash:'a'.repeat(64),styles:['default']}),asr:async()=>({text:++calls===1?'你好小川，本月销售怎么样':'本月目标完成率是多少',ms:1}),tts:async function*(){const pcm=new Uint8Array(48000);const view=new DataView(pcm.buffer);for(let i=0;i<24000;i++)view.setInt16(i*2,Math.round(3000*Math.sin(i*2*Math.PI*220/24000)),true);yield {type:'audio',pcm,sampleRate:24000};yield {type:'done',metrics:{ttsRegenerated:0,ttsTruncated:0,ttsFail:0}};}};
  const store=new AudioStore({client,enabled:true,cacheDir:cache});await store.initialize();
  const audio=createAudioHttpHandler({store,screenToken,consoleToken});
  const hub=await startVoiceHub({host:'127.0.0.1',port:0,onHttpRequest:(req,res)=>['/voice/wake','/voice/utterance','/voice/input-config'].includes(new URL(req.url!,'http://localhost').pathname)?input(req,res):audio(req,res),onMessage:(conn,raw)=>orch.handleClientMessage(conn,raw)});
  const orch:ReturnType<typeof createVoiceOrchestrator>=createVoiceOrchestrator({hub,audio:store,speechClient:client,dataSource:{name:'fixture',fetchPayload:async()=>fixture},llm:new ScriptedAdapter({firstTokenDelayMs:0}),mcp:null,trace:new TraceSink(null),hubAuth:{screenToken,consoleToken},llmTimeoutMs:8000,partialPaceMs:45,partialMaxTotalMs:1200,prefetchTimeoutMs:5000,questionMinGapMs:0,questionWindowMs:60000,questionWindowMax:100,mcpToolWhitelist:[]});
  const input:ReturnType<typeof createInputHttpHandler>=createInputHttpHandler({screenToken,wake:f=>f?orch.beginListening():orch.beginSession(true),utterance:(pcm,signal,ms)=>orch.submitUtterance(pcm,signal,ms),config:()=>({hangoverMs:500,micReopenDelayMs:300,kwsThreshold:.25,kwsScore:1,kwsEnergy:.01,wakePhrase:'你好，小川'})});
  try{
    await page.addInitScript(()=>{const context=new AudioContext(),destination=context.createMediaStreamDestination();Object.assign(window,{micFixture:{context,destination,ready:false}});navigator.mediaDevices.getUserMedia=async()=>{(window as unknown as {micFixture:{ready:boolean}}).micFixture.ready=true;return destination.stream;};});
    await page.goto(`/screen/sales?voiceLive=1&lite=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}#hubToken=${screenToken}`);
    await page.waitForFunction(()=>(window as unknown as {micFixture:{ready:boolean}}).micFixture.ready);
    const play=async(name:string)=>page.evaluate(async b64=>{const m=(window as unknown as {micFixture:{context:AudioContext,destination:MediaStreamAudioDestinationNode}}).micFixture;await m.context.resume();const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const node=m.context.createBufferSource();node.buffer=await m.context.decodeAudioData(bytes.buffer);node.connect(m.destination);node.start();},(await readFile(new URL(`fixtures/${name}`,import.meta.url))).toString('base64'));
    await page.keyboard.press('F9');await expect.poll(()=>orch.state.name).toBe('waking');
    await expect.poll(()=>orch.state.name).toBe('listening');await page.waitForTimeout(600);
    await play('sales-question.wav');await expect.poll(()=>calls,{timeout:10000}).toBe(1);
    await expect.poll(()=>orch.state.name).toBe('answering');
    await page.waitForFunction(()=>!(window as unknown as {micFixture:{destination:MediaStreamAudioDestinationNode}}).micFixture.destination.stream.getAudioTracks()[0].enabled);
    // Speech during the first answer must produce no new ASR request.
    await play('rate-question.wav');await page.waitForTimeout(1000);expect(calls).toBe(1);
    await expect.poll(()=>orch.state.name,{timeout:10000}).toBe('followup');
    await page.waitForFunction(()=>(window as unknown as {micFixture:{destination:MediaStreamAudioDestinationNode}}).micFixture.destination.stream.getAudioTracks()[0].enabled);
    await play('sales-question.wav');
    await expect.poll(()=>calls,{timeout:10000}).toBe(2);expect(orch.state.name).not.toBe('closing');
  }finally{orch.forceClose('force');store.close();await hub.close();await rm(cache,{recursive:true,force:true});}
});
