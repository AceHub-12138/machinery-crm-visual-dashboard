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
import { loadConfig, loadEnvFileExplicit } from "../services/voice-orchestrator/src/config.ts";
import { createDataSource } from "../services/voice-orchestrator/src/datasource/index.ts";
import { OpenAiCompatibleAdapter } from "../services/voice-orchestrator/src/llm/zhipu.ts";
import { TraceSink } from "../services/voice-orchestrator/src/trace/metrics.ts";
import { percentile } from "../services/voice-orchestrator/src/trace/metrics.ts";
const root = fileURLToPath(new URL("..", import.meta.url));
loadEnvFileExplicit(join(root,"services/voice-orchestrator"));
const cfg = loadConfig();
assert(cfg.llmApiKey && cfg.llmModel , "Local model configuration required");
const startedAt = new Date().toISOString();
const buildId = (await readFile(join(root,".next/BUILD_ID"),"utf8")).trim();
const output = process.argv[2] ?? "docs/voice-8c-barge-calibration.json";
const cache = await mkdtemp(join(tmpdir(), "voice-barge-"));
const screenToken = randomBytes(24).toString("hex"), consoleToken = randomBytes(24).toString("hex");
const interactions=[], records=[], events=[], questions=[], classifications=[], rounds=[], errors=[];
const summarize=rows=>Object.fromEntries(['duckMs','pauseMs','lastSpeechToNewSampleMs','uploadToNewSampleMs','asrQueueMs','asrMs'].map(key=>{const values=rows.map(r=>r[key]).filter(v=>typeof v==='number');return [key,{samples:values.length,p50:percentile(values,50),p95:percentile(values,95)}];}));
const save=async()=>writeFile(output,JSON.stringify({startedAt,buildId,conditions:process.env.VOICE_BARGE_RUN_LABEL??"unspecified",scope:"injected prerecorded speech → actual AudioWorklet/Silero → real ASR/LLM/TTS → Web Audio; input/output muted, not human or exhibit pickup",model:cfg.llmModel,errors,thresholds:{duckMs:150,pauseMs:700,lastSpeechToNewSampleMs:1500},passed:rounds.length>=10&&rounds.every(r=>r.accepted&&r.oldTurnCancelled)&&summarize(rounds).duckMs.p95<=150&&summarize(rounds).pauseMs.p95<=700&&summarize(rounds).lastSpeechToNewSampleMs.p95<=1500,summary:summarize(rounds),rounds,interactions},null,2));
const delay = ms => new Promise(r=>setTimeout(r,ms));
async function wait(fn,timeout=90000) { const end=Date.now()+timeout; while(!fn()) { assert(Date.now()<end,"capture verification timeout"); await delay(25); } }
class Sink extends TraceSink { async append(r) { records.push(structuredClone(r)); } async appendInteraction(r) { interactions.push(structuredClone(r)); } }
let store,hub,orch,browser,next;
try {
  const client = new VoiceLocalClient(cfg.voiceLocalUrl);
  store=new AudioStore({client,cacheDir:cache,enabled:true});await store.initialize();assert(store.ready);
  const audioHandler=createAudioHttpHandler({store,screenToken,consoleToken});
  let inputHandler;
  hub=await startVoiceHub({host:"127.0.0.1",port:0,onHttpRequest:(req,res)=>["/voice/wake","/voice/utterance","/voice/input-config","/voice/listen"].includes(new URL(req.url,"http://localhost").pathname)?inputHandler(req,res):audioHandler(req,res),onMessage:(conn,raw)=>orch.handleClientMessage(conn,raw)});
  const broadcast=hub.broadcast.bind(hub);
  hub.broadcast=(ev,filter)=>{events.push(structuredClone(ev));broadcast(ev,filter);};
  const adapter=new OpenAiCompatibleAdapter({baseUrl:cfg.llmBaseUrl,apiKey:cfg.llmApiKey,model:cfg.llmModel,reasoningEffort:"none"});
  const llm={name:adapter.name,stream:adapter.stream.bind(adapter),classify:async(text,signal)=>{questions.push(text);const intent=await adapter.classify(text,signal);classifications.push(intent);return intent;}};
  orch=createVoiceOrchestrator({hub,audio:store,speechClient:client,dataSource:createDataSource({mode:"fixture",fixturePath:cfg.fixturePath,baseUrl:"",publicId:""}),llm,mcp:null,trace:new Sink(null),hubAuth:{screenToken,consoleToken},llmTimeoutMs:8000,partialPaceMs:45,partialMaxTotalMs:1200,prefetchTimeoutMs:5000,questionMinGapMs:0,questionWindowMs:60000,questionWindowMax:100,mcpToolWhitelist:[]});
  inputHandler=createInputHttpHandler({screenToken,activity:orch.inputActivity,wake:(_followup,screenId)=>orch.beginSession(true,screenId),utterance:(pcm,signal,ms,lease)=>orch.submitUtterance(pcm,signal,ms,lease),config:()=>cfg.inputConfig});
  next=spawn(process.execPath,[join(root,"node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port","18816"],{cwd:root,stdio:"ignore"});
  let ready=false;for(let i=0;i<100&&!ready;i++){try{ready=(await fetch("http://127.0.0.1:18816/screen/sales")).ok;}catch{} if(!ready)await delay(100);}assert(ready);
  browser=await chromium.launch({headless:true,args:["--autoplay-policy=no-user-gesture-required"]});
  const page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:"reduce"});
  page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error"||m.text().includes("voice-input"))errors.push(m.text());});
  await page.addInitScript(()=>{
    const context=new AudioContext(),destination=context.createMediaStreamDestination();
    const m=window.captureTest={context,destination,ready:false,measuring:false,newTurn:false,start:0,lastSpeech:0,duck:0,pause:0,utterance:0,first:0,firstByte:0};
    navigator.mediaDevices.getUserMedia=async()=>{m.ready=true;return destination.stream;};
    const OriginalSocket=WebSocket;
    window.WebSocket=class extends OriginalSocket { constructor(url, protocols) {super(url,protocols);this.addEventListener("message",({data})=>{const e=JSON.parse(data);if(m.measuring && e.type==="answer.delta" && e.full && e.speech) m.newTurn=true;});} };
    const setTarget=AudioParam.prototype.setTargetAtTime;
    AudioParam.prototype.setTargetAtTime=function(value,...args){if(m.measuring&&value===.2&&!m.duck)m.duck=performance.now();return setTarget.call(this,value,...args);};
    const suspend=AudioContext.prototype.suspend;
    AudioContext.prototype.suspend=function(){if(m.measuring&&this!==context&&m.duck&&!m.pause)m.pause=performance.now();return suspend.call(this);};
    const createSource=AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource=function(){const node=createSource.call(this),start=node.start.bind(node);node.start=(when=0)=>{if(this!==context&&m.measuring&&m.newTurn&&!m.first)m.first=performance.now()+Math.max(0,when-this.currentTime)*1000;start(when);};return node;};
    const request=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      if(m.measuring&&String(input).includes("/voice/utterance"))m.utterance=performance.now();
      const r=await request(input,init);
      if(!String(input).includes("/voice/audio/")||!r.body)return r;
      const reader=r.body.getReader();return new Response(new ReadableStream({async pull(c){const p=await reader.read();if(p.done)c.close();else{if(m.measuring&&m.newTurn&&!m.firstByte)m.firstByte=performance.now();c.enqueue(p.value);}},cancel:()=>reader.cancel()}),{status:r.status,headers:r.headers});
    };
    // Keep the real output graph and clock, but prevent physical speaker feedback
    // from being mistaken for injected input in a latency-only measurement.
    const createAnalyser=AudioContext.prototype.createAnalyser;
    AudioContext.prototype.createAnalyser=function(){const analyser=createAnalyser.call(this),connect=analyser.connect.bind(analyser);analyser.connect=(target)=>{const mute=this.createGain();mute.gain.value=0;connect(mute);mute.connect(target);return target;};return analyser;};
  });
  await page.goto(`http://127.0.0.1:18816/screen/sales?voiceLive=1&lite=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}#hubToken=${screenToken}`);
  await wait(()=>hub.counts().screens===1,5000);
  await page.waitForFunction(()=>window.captureTest.ready, undefined, {timeout:20000});
  console.log("browser microphone ready", errors);
  await delay(2000);
  const feed=async(name,measuring=false)=>{
    const wav=await readFile(join(root,"e2e/fixtures",name));
    await page.evaluate(async({base64,measuring})=>{
      const m=window.captureTest;await m.context.resume();const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const buffer=await m.context.decodeAudioData(bytes.buffer);
      if(measuring){m.measuring=true;m.newTurn=false;m.duck=0;m.pause=0;m.utterance=0;m.first=0;m.firstByte=0;}
      const samples=buffer.getChannelData(0);let first=0,last=samples.length-1;
      while(first<samples.length&&Math.abs(samples[first])<.003)first++;
      while(last>first&&Math.abs(samples[last])<.003)last--;
      m.start=performance.now()+first/buffer.sampleRate*1000;m.lastSpeech=performance.now()+last/buffer.sampleRate*1000;
      const node=m.context.createBufferSource();node.buffer=buffer;node.connect(m.destination);node.start();
    },{base64:wav.toString("base64"),measuring});
  };
  const count=Number(process.env.VOICE_TEST_ROUNDS??10);
  for(let index=0;index<count;index++){
    await page.evaluate(()=>window.captureTest.measuring=false);
    await page.keyboard.press("F9");await wait(()=>orch.state.name==="listening",10000);
    await wait(()=>events.some(e=>e.type==="input.open"&&e.sessionId===orch.sessionId),5000);
    await feed("sales-question.wav");await wait(()=>orch.state.name==="answering",20000);await delay(650);
    const old=(events.filter(e=>e.type==="answer.delta"&&e.full).at(-1)).speech.turnId;
    const before=events.length;
    await feed("rate-question.wav",true);
    await wait(()=>events.slice(before).some(e=>e.type==="barge.result"),15000);
    const decision=events.slice(before).find(e=>e.type==="barge.result");
    assert(decision.accepted,`barge rejected: ${decision.reason}`);
    await page.waitForFunction(()=>window.captureTest.first>0,undefined,{timeout:20000});
    const m=await page.evaluate(()=>{const {start,lastSpeech,duck,pause,utterance,first,firstByte}=window.captureTest;return {start,lastSpeech,duck,pause,utterance,first,firstByte};});
    const newTrace=events.slice(before).filter(e=>e.type==="trace.turn").at(-1)?.trace;
    const bargeLease=events.slice(0,before).filter(e=>e.type==="input.listen"&&e.mode==="barge").at(-1);
    const row={round:index+1,accepted:decision.accepted,oldTurnCancelled:store.lookup(old)?.cancelled===true,duckMs:m.duck-m.start,pauseMs:m.pause-m.start,lastSpeechToNewSampleMs:m.first-m.lastSpeech,uploadToNewSampleMs:m.first-m.utterance,hangoverAndUploadMs:m.utterance-m.lastSpeech,asrMs:newTrace?.asrMs,asrQueueMs:newTrace?.asrQueueMs,classifyMs:newTrace?.classifyMs,ttsFirstByteMs:newTrace?.ttsFirstByteMs,speculative:newTrace?.speculative,browserPrebufferMs:m.first-m.firstByte,bargeListenId:bargeLease.listenId};
    rounds.push(row);await save();console.log(JSON.stringify(row));
    assert(row.oldTurnCancelled&&m.duck>0&&m.pause>0&&m.first>m.utterance);
    orch.forceClose("force");await wait(()=>orch.state.name==="ambient",5000);await delay(300);
  }
  const summary=summarize(rounds);
  console.log(JSON.stringify({summary,passed:summary.duckMs.p95<=150&&summary.pauseMs.p95<=700&&summary.lastSpeechToNewSampleMs.p95<=1500}));
} catch(error) { errors.push(error.message); await save(); console.error("capture errors",errors);throw error; }
finally { orch?.forceClose("force");store?.close();await browser?.close();await hub?.close();next?.kill("SIGTERM");await rm(cache,{recursive:true,force:true}); }
