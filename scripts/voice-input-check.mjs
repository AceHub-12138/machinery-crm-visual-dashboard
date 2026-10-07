#!/usr/bin/env node
/** Production browser capture: injected local speech feeds a MediaStream, then
 * AudioWorklet → Silero → HTTP PCM → real ASR/classifier/TTS → Web Audio.
 * Synthetic near-field audio cannot validate exhibit distance/noise or LAN L1.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { AudioStore } from "../services/voice-orchestrator/src/tts/audio-store.ts";
import { VoiceLocalClient } from "../services/voice-orchestrator/src/tts/voice-local-client.ts";
import { createAudioHttpHandler } from "../services/voice-orchestrator/src/tts/http-audio.ts";
import { createInputHttpHandler } from "../services/voice-orchestrator/src/http-input.ts";
import { startVoiceHub } from "../services/voice-orchestrator/src/ws/ws-server.ts";
import { createVoiceOrchestrator } from "../services/voice-orchestrator/src/orchestrator.ts";
import { loadConfig } from "../services/voice-orchestrator/src/config.ts";
import { createDataSource } from "../services/voice-orchestrator/src/datasource/index.ts";
import { OpenAiCompatibleAdapter } from "../services/voice-orchestrator/src/llm/zhipu.ts";
import { TraceSink } from "../services/voice-orchestrator/src/trace/metrics.ts";
const root = fileURLToPath(new URL("..", import.meta.url));
const cfg = loadConfig();
assert(cfg.llmApiKey && cfg.llmModel && process.env.VOICE_TEST_AUDIO_DIR, "Local model and test recording directory required");
const output = process.argv[2] ?? "docs/voice-8c-task6-browser-calibration.json";
const cache = await mkdtemp(join(tmpdir(), "voice-input-"));
const screenToken = randomBytes(24).toString("hex"), consoleToken = randomBytes(24).toString("hex");
const records=[], events=[], questions=[], rounds=[], errors=[];
const delay = ms => new Promise(r=>setTimeout(r,ms));
async function wait(fn,timeout=90000) { const end=Date.now()+timeout; while(!fn()) { assert(Date.now()<end,"capture verification timeout"); await delay(25); } }
class Sink extends TraceSink { async append(r) { records.push(structuredClone(r)); } }
let store,hub,orch,browser,next;
try {
  const client = new VoiceLocalClient(cfg.voiceLocalUrl);
  store=new AudioStore({client,cacheDir:cache,enabled:true});await store.initialize();assert(store.ready);
  const audioHandler=createAudioHttpHandler({store,screenToken,consoleToken});
  let inputHandler;
  hub=await startVoiceHub({host:"127.0.0.1",port:0,onHttpRequest:(req,res)=>["/voice/wake","/voice/utterance","/voice/input-config"].includes(new URL(req.url,"http://localhost").pathname)?inputHandler(req,res):audioHandler(req,res),onMessage:(conn,raw)=>orch.handleClientMessage(conn,raw)});
  const broadcast=hub.broadcast.bind(hub);
  hub.broadcast=(ev,filter)=>{events.push(structuredClone(ev));broadcast(ev,filter);};
  const adapter=new OpenAiCompatibleAdapter({baseUrl:cfg.llmBaseUrl,apiKey:cfg.llmApiKey,model:cfg.llmModel,reasoningEffort:"none"});
  const llm={name:adapter.name,stream:adapter.stream.bind(adapter),classify:async(text,signal)=>{questions.push(text);return adapter.classify(text,signal);}};
  orch=createVoiceOrchestrator({hub,audio:store,speechClient:client,dataSource:createDataSource({mode:"fixture",fixturePath:cfg.fixturePath,baseUrl:"",publicId:""}),llm,mcp:null,trace:new Sink(null),hubAuth:{screenToken,consoleToken},llmTimeoutMs:8000,partialPaceMs:45,partialMaxTotalMs:1200,prefetchTimeoutMs:5000,questionMinGapMs:0,questionWindowMs:60000,questionWindowMax:100,mcpToolWhitelist:[]});
  inputHandler=createInputHttpHandler({screenToken,wake:followup=>followup?orch.beginListening():orch.beginSession(true),utterance:(pcm,signal,ms)=>orch.submitUtterance(pcm,signal,ms),config:()=>cfg.inputConfig});
  next=spawn(process.execPath,[join(root,"node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port","18815"],{cwd:root,stdio:"ignore"});
  let ready=false;for(let i=0;i<100&&!ready;i++){try{ready=(await fetch("http://127.0.0.1:18815/screen/sales")).ok;}catch{} if(!ready)await delay(100);}assert(ready);
  browser=await chromium.launch({headless:true,args:["--autoplay-policy=no-user-gesture-required"]});
  const page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:"reduce"});
  page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error"||m.text().includes("voice-input"))errors.push(m.text());});
  await page.addInitScript(()=>{
    const inputContext=new AudioContext(), destination=inputContext.createMediaStreamDestination();
    window.captureTest={inputContext,destination,ready:false,utteranceAt:0,firstSampleAt:0,lastSpeechAt:0,outputScheduled:[],audioFirstByteAt:0};
    navigator.mediaDevices.getUserMedia=async()=>{window.captureTest.ready=true;return destination.stream;};
    const originalFetch=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      if(String(input).includes("/voice/utterance"))window.captureTest.utteranceAt=performance.now();
      const res=await originalFetch(input,init);
      if(!String(input).includes("/voice/audio/")||!res.body)return res;
      const reader=res.body.getReader();return new Response(new ReadableStream({async pull(controller){const part=await reader.read();if(part.done){controller.close();return;}window.captureTest.audioFirstByteAt ||= performance.now();controller.enqueue(part.value);},cancel(){return reader.cancel();}}),{status:res.status,headers:res.headers});
    };
    const original=AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource=function(){const node=original.call(this),start=node.start.bind(node);node.start=(when=0)=>{if(this!==inputContext){window.captureTest.outputScheduled.push({when,seconds:node.buffer.duration});if(!window.captureTest.firstSampleAt)window.captureTest.firstSampleAt=performance.now()+Math.max(0,when-this.currentTime)*1000;}start(when);};return node;};
  });
  await page.goto(`http://127.0.0.1:18815/screen/sales?voiceLive=1&lite=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}#hubToken=${screenToken}`);
  await wait(()=>hub.counts().screens===1,5000);
  await page.waitForFunction(()=>window.captureTest.ready, undefined, {timeout:20000});
  console.log("browser microphone ready", errors);
  await delay(2000);
  const count=Number(process.env.VOICE_TEST_ROUNDS??20);
  for(let index=0;index<count;index++){
    const q=index%8+1;const wav=await readFile(join(process.env.VOICE_TEST_AUDIO_DIR,`q${q}.wav`));
    const before=records.length;
    await page.keyboard.press("F9");await wait(()=>orch.state.name==="listening",10000);console.log("listening",index+1);await delay(700);
    await page.evaluate(async base64=>{
      const m=window.captureTest;await m.inputContext.resume();m.firstSampleAt=0;m.utteranceAt=0;m.audioFirstByteAt=0;m.outputScheduled=[];
      const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const buffer=await m.inputContext.decodeAudioData(bytes.buffer);
      const node=m.inputContext.createBufferSource();node.buffer=buffer;node.connect(m.destination);const samples=buffer.getChannelData(0);let last=samples.length-1;while(last>0&&Math.abs(samples[last])<.003)last--;m.lastSpeechAt=performance.now()+last/buffer.sampleRate*1000;node.start();
    },wav.toString("base64"));
    await wait(()=>records.length>before,120000);
    const metrics=await page.evaluate(()=>({utteranceAt:window.captureTest.utteranceAt,firstSampleAt:window.captureTest.firstSampleAt,lastSpeechAt:window.captureTest.lastSpeechAt,outputScheduled:window.captureTest.outputScheduled,audioFirstByteAt:window.captureTest.audioFirstByteAt}));
    const record=records.at(-1);assert.equal(record.playbackOutcome,"drained");assert(metrics.utteranceAt>0&&metrics.firstSampleAt>metrics.utteranceAt);
    rounds.push({round:index+1,fixture:`q${q}`,question:questions.at(-1),L1:metrics.firstSampleAt-metrics.utteranceAt,L2:metrics.firstSampleAt-metrics.lastSpeechAt,asrMs:record.asrMs,asrRoundTripMs:record.asrRoundTripMs,uploadBodyMs:record.uploadMs,classifyMs:record.classifyMs,ttsFirstByteMs:record.ttsFirstByteMs,voiceLocalFirstByteMs:record.voiceLocalFirstByteMs,ttsForwardingMs:record.voiceLocalFirstByteMs==null?null:record.ttsFirstByteMs-record.voiceLocalFirstByteMs,browserBufferMs:metrics.firstSampleAt-metrics.audioFirstByteAt,style:record.style,styleFallback:record.styleFallback??null,playbackOutcome:record.playbackOutcome});
    await writeFile(output,JSON.stringify({scope:"injected macOS synthesized speech → real browser AudioWorklet/Silero VAD → loopback HTTP → real ASR/LLM/TTS → first scheduled sample; not exhibit/real microphone/LAN",errors,rounds},null,2));
    console.log(JSON.stringify(rounds.at(-1)));
    orch.forceClose("force");await wait(()=>orch.state.name==="ambient",5000);await delay(500);
  }
} catch(error) { console.error("capture errors",errors);throw error; }
finally { orch?.forceClose("force");store?.close();await browser?.close();await hub?.close();next?.kill("SIGTERM");await rm(cache,{recursive:true,force:true}); }
