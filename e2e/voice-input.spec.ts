import { test, expect, type Page } from "./audio-test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AudioStore } from "../services/voice-orchestrator/src/tts/audio-store";
import { createAudioHttpHandler } from "../services/voice-orchestrator/src/tts/http-audio";
import { createInputHttpHandler } from "../services/voice-orchestrator/src/http-input";
import { startVoiceHub } from "../services/voice-orchestrator/src/ws/ws-server";
import { createVoiceOrchestrator } from "../services/voice-orchestrator/src/orchestrator";
import { FIXED_LINES } from "../services/voice-orchestrator/src/tts/fixed-lines";
import { ScriptedAdapter } from "../services/voice-orchestrator/src/llm/scripted";
import { TraceSink } from "../services/voice-orchestrator/src/trace/metrics";
import { validatePublicPayload } from "../src/lib/voice/public-payload";
import { buildIntentAnswer } from "../src/lib/voice/intent-answers";
import { playbackFallbackMs } from "../src/lib/voice/playback-timing";
import type { SpeechClient } from "../services/voice-orchestrator/src/tts/voice-local-client";
const fixture=validatePublicPayload(JSON.parse(readFileSync(new URL("../services/voice-orchestrator/fixtures/public-sales-screen.json",import.meta.url),'utf8')))!;
type BrowserFixture={context:AudioContext;destination:MediaStreamAudioDestinationNode;ready:boolean;outputTail:number;outputContext:AudioContext|null;kwsReady:boolean;deadlineMs:number;sockets:WebSocket[];kwsDebug:{frames:number;resetEpoch:number;keywords:unknown[];wakeStatuses:number[];peak:number;energetic:number;resets:Array<{epoch:number;at:number}>}};
declare global { interface Window { voiceFixture:BrowserFixture } }
const screenToken='voice-input-screen-token',consoleToken='voice-input-console-token';
test.use({launchOptions:{args:['--autoplay-policy=no-user-gesture-required']}});
async function setup(page:Page,options:{listenTimeoutMs?:number;questionWindowMax?:number}={}){
  const cache=await mkdtemp(join(tmpdir(),'voice-input-e2e-'));
  let calls=0;const questions:string[]=[],requests:string[]=[];let ready=0;let readyAt=0;
  const client:SpeechClient={health:async()=>({warm:true,selfCheck:'passed',refHash:'a'.repeat(64),styles:['default','apologetic','warm']}),asr:async()=>({text:++calls===1?'您好晓川，本月销售怎么样':'本月目标完成率是多少',ms:1}),tts:async function*(){const pcm=new Uint8Array(96000);const view=new DataView(pcm.buffer);for(let i=0;i<48000;i++)view.setInt16(i*2,Math.round(3000*Math.sin(i*2*Math.PI*220/24000)),true);yield {type:'audio',pcm,sampleRate:24000};yield {type:'done',metrics:{ttsRegenerated:0,ttsTruncated:0,ttsFail:0}};}};
  const store=new AudioStore({client,enabled:true,cacheDir:cache});await store.initialize();
  const audio=createAudioHttpHandler({store,screenToken,consoleToken});
  const hub=await startVoiceHub({host:'127.0.0.1',port:0,onHttpRequest:(req,res)=>['/voice/wake','/voice/utterance','/voice/input-config','/voice/listen'].includes(new URL(req.url!,'http://localhost').pathname)?input(req,res):audio(req,res),onMessage:(conn,raw)=>orch.handleClientMessage(conn,raw),onClose:conn=>orch.detach(conn)});
  const llm=new ScriptedAdapter({firstTokenDelayMs:0});const classify=llm.classify.bind(llm);llm.classify=(q,s)=>{questions.push(q);return classify(q,s);};
  const orch:ReturnType<typeof createVoiceOrchestrator>=createVoiceOrchestrator({hub,audio:store,speechClient:client,dataSource:{name:'fixture',fetchPayload:async()=>fixture},llm,mcp:null,trace:new TraceSink(null),hubAuth:{screenToken,consoleToken},llmTimeoutMs:8000,partialPaceMs:45,partialMaxTotalMs:1200,prefetchTimeoutMs:5000,questionMinGapMs:0,questionWindowMs:60000,questionWindowMax:options.questionWindowMax??100,listenTimeoutMs:options.listenTimeoutMs,mcpToolWhitelist:[]});
  const input:ReturnType<typeof createInputHttpHandler>=createInputHttpHandler({screenToken,activity:orch.inputActivity,wake:(_followup,screenId)=>orch.beginSession(true,screenId),utterance:(pcm,signal,ms,lease)=>orch.submitUtterance(pcm,signal,ms,lease),config:()=>({hangoverMs:500,micReopenDelayMs:300,kwsThreshold:.25,kwsScore:1,kwsEnergy:.01,wakePhrase:'你好，小川'})});
  page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/voice/utterance'))requests.push(r.url());});
  page.on('response',r=>{if(r.url().includes('/voice/listen?action=ready')&&r.status()===202){ready++;readyAt=Date.now();}});
  await page.addInitScript(()=>{
    const context=new AudioContext(),destination=context.createMediaStreamDestination();window.voiceFixture={context,destination,ready:false,outputTail:0,outputContext:null,kwsReady:false,deadlineMs:0,sockets:[],kwsDebug:{frames:0,resetEpoch:0,keywords:[],wakeStatuses:[],peak:0,energetic:0,resets:[]}};
    navigator.mediaDevices.getUserMedia=async()=>{window.voiceFixture.ready=true;return destination.stream;};
    const source=AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource=function(){const node=source.call(this),start=node.start.bind(node);node.start=(when=0)=>{if(this!==context){window.voiceFixture.outputContext=this;window.voiceFixture.outputTail=when+(node.buffer?.duration??0);}start(when);};return node;};
    const OriginalWorker=Worker;window.Worker=class extends OriginalWorker{constructor(url:string|URL,options?:WorkerOptions){super(url,options);if(String(url).includes('kws-worker')){const post=this.postMessage.bind(this);this.postMessage=(data:{type:string;epoch?:number;samples?:Float32Array},transfer?:Transferable[]|StructuredSerializeOptions)=>{if(data.type==='audio'){const debug=window.voiceFixture.kwsDebug;debug.frames++;const rms=Math.sqrt(data.samples!.reduce((sum,x)=>sum+x*x,0)/data.samples!.length);debug.peak=Math.max(debug.peak,rms);if(rms>.01)debug.energetic++;}if(data.type==='reset'){window.voiceFixture.kwsDebug.resetEpoch=data.epoch!;window.voiceFixture.kwsDebug.resets.push({epoch:data.epoch!,at:performance.now()});}post(data,Array.isArray(transfer)?transfer:transfer?.transfer??[]);};this.addEventListener('message',e=>{if(e.data.type==='ready')window.voiceFixture.kwsReady=true;if(e.data.type==='keyword')window.voiceFixture.kwsDebug.keywords.push(e.data);});}}};
    const OriginalSocket=WebSocket;window.WebSocket=class extends OriginalSocket{constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);window.voiceFixture.sockets.push(this);}};
    const timer=window.setTimeout.bind(window);window.setTimeout=((fn:TimerHandler,ms?:number,...args:unknown[])=>timer(fn,window.voiceFixture.deadlineMs>0&&ms===window.voiceFixture.deadlineMs?1000:ms,...args)) as typeof window.setTimeout;
  });
  await page.goto(`/screen/sales?voiceLive=1&lite=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}#hubToken=${screenToken}`);
  await page.waitForFunction(()=>window.voiceFixture.ready&&window.voiceFixture.kwsReady);
  const play=async(name:string)=>page.evaluate(async b64=>{const m=window.voiceFixture;await m.context.resume();const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const node=m.context.createBufferSource();node.buffer=await m.context.decodeAudioData(bytes.buffer);node.connect(m.destination);node.start();},(await readFile(new URL(`fixtures/${name}`,import.meta.url))).toString('base64'));
  const open=async()=>{const before=ready;await page.keyboard.press('F9');await expect.poll(()=>orch.state.name,{timeout:10000}).toBe('listening');await expect.poll(()=>ready).toBeGreaterThan(before);};
  const kwsWake=async()=>{await expect.poll(()=>orch.state.name,{timeout:10000}).toBe('ambient');await page.waitForTimeout(5600);const previous=orch.sessionId;await play('wake.wav');try{await expect.poll(()=>orch.sessionId,{timeout:10000}).not.toBe(previous);}catch(error){console.log('KWS recovery diagnostic',await page.evaluate(()=>({debug:window.voiceFixture.kwsDebug,inputState:window.voiceFixture.context.state,text:document.querySelector('.overlay-root')?.textContent})));throw error;}};
  return {orch,client,llm,questions,requests,play,open,kwsWake,ready:()=>ready,readyAt:()=>readyAt,close:async()=>{orch.forceClose('force');store.close();await hub.close();await rm(cache,{recursive:true,force:true});}};
}
test('real worklet/VAD interrupts an answer, then a long question survives the 8s window',async({page})=>{
  test.setTimeout(60000);const s=await setup(page);try{
    await s.open();await s.play('sales-question.wav');await expect.poll(()=>s.questions.length,{timeout:10000}).toBe(1);
    await expect.poll(()=>s.orch.state.name).toBe('answering');expect(s.questions[0]).toBe('本月销售怎么样');
    await s.play('rate-question.wav');await expect(page.locator('.overlay-root')).toHaveAttribute('data-barge-paused','true',{timeout:1500});
    await expect.poll(()=>s.questions.length,{timeout:10000}).toBe(2);
    const before=s.ready();await expect.poll(()=>s.orch.state.name,{timeout:15000}).toBe('followup');await expect.poll(()=>s.ready(),{timeout:5000}).toBeGreaterThan(before);
    await page.waitForTimeout(3500);await s.play('followup-long.wav');await page.waitForTimeout(4000);
    expect(s.orch.state.name).toBe('followup');expect(s.questions).toHaveLength(2);
    await expect.poll(()=>s.questions.length,{timeout:15000}).toBe(3);expect(s.orch.state.name).not.toBe('closing');
  }finally{await s.close();}
});
test('silence is counted from actual open microphone; cached idle_exit then ambient',async({page})=>{
  test.setTimeout(35000);const s=await setup(page);try{
    await s.open();const at=s.readyAt();await page.waitForTimeout(4500);expect(s.orch.state.name).toBe('listening');
    await expect.poll(()=>s.orch.inputLease,{timeout:2000}).toBeNull();expect(Date.now()-at).toBeGreaterThanOrEqual(4900);
    await expect.poll(()=>s.orch.state.name,{timeout:7000}).toBe('ambient');expect(s.requests).toHaveLength(0);
  }finally{await s.close();}
});
test('speech beginning at second 4 survives the listening deadline and becomes an answer',async({page})=>{
  test.setTimeout(35000);const s=await setup(page);try{
    await s.open();await page.waitForTimeout(3900);await s.play('followup-long.wav');await page.waitForTimeout(2500);expect(s.orch.state.name).toBe('listening');
    await expect.poll(()=>s.requests.length,{timeout:15000}).toBe(1);await expect.poll(()=>s.orch.state.name).toBe('answering');
  }finally{await s.close();}
});
test('Esc while listening closes server session and F9 starts a fresh session',async({page})=>{
  test.setTimeout(30000);const s=await setup(page);try{await s.open();const id=s.orch.sessionId;await page.keyboard.press('Escape');await expect.poll(()=>s.orch.state.name).toBe('ambient');await s.open();expect(s.orch.sessionId).not.toBe(id);}finally{await s.close();}
});
for(const interruption of ['Escape','disconnect','supersede','timeout'] as const)test(`real KWS works after answering interruption: ${interruption}`,async({page})=>{
  test.setTimeout(50000);const s=await setup(page);try{
    await s.open();
    if(interruption==='timeout')await page.evaluate(ms=>window.voiceFixture.deadlineMs=ms,playbackFallbackMs(buildIntentAnswer('sales_progress',fixture).spoken));
    await s.play('sales-question.wav');await expect.poll(()=>s.orch.state.name).toBe('answering');
    if(interruption==='disconnect')await page.evaluate(()=>window.voiceFixture.sockets.forEach(socket=>socket.close()));
    else if(interruption==='supersede'){s.orch.handleClientMessage({id:'console',role:'console',send:()=>{},close:()=>{}},JSON.stringify({type:'question.submit',at:Date.now(),text:'本月回款情况怎么样'}));await expect.poll(()=>s.orch.answer?.spoken).toContain('回款');await page.keyboard.press('Escape');}
    else if(interruption==='timeout'){await expect.poll(()=>s.orch.state.name,{timeout:4000}).toBe('answering');await expect.poll(()=>s.orch.state.name,{timeout:14000}).toBe('ambient');}
    else await page.keyboard.press('Escape');
    await s.kwsWake();
  }finally{await s.close();}
});

test('one-sentence greeting card finishes unfolding during speech',async({page})=>{
  test.setTimeout(30000);const s=await setup(page);try{
    s.client.asr=async()=>({text:'你好',ms:1});await s.open();await s.play('sales-question.wav');await expect.poll(()=>s.orch.state.name).toBe('answering');
    await expect(page.locator('.overlay-card-corners')).toHaveClass(/is-on/,{timeout:1800});
    await expect.poll(()=>s.orch.state.name,{timeout:5000}).toBe('listening');
  }finally{await s.close();}
});

test('real VAD echo rejection resumes the same answer with its card intact',async({page})=>{
  test.setTimeout(35000);const s=await setup(page);try{
    await s.open();await s.play('sales-question.wav');await expect.poll(()=>s.orch.state.name).toBe('answering');
    const spoken=s.orch.answer!.sentences[0].spokenText;
    s.client.asr=async()=>({text:spoken,ms:1});await s.play('rate-question.wav');
    await expect(page.locator('.overlay-root')).toHaveAttribute('data-barge-paused','true',{timeout:1500});
    await expect.poll(()=>s.requests.length,{timeout:10000}).toBe(2);
    await expect(page.locator('.overlay-root')).toHaveAttribute('data-barge-paused','false');
    expect(s.questions).toHaveLength(1);await expect(page.locator('.overlay-card')).toBeVisible();
    await expect.poll(()=>s.orch.state.name,{timeout:10000}).toBe('followup');
  }finally{await s.close();}
});
test('full silence after an answer traverses long window, prompt, short window and warm exit',async({page})=>{
  test.setTimeout(45000);const s=await setup(page);try{
    await s.open();await s.play('sales-question.wav');await expect.poll(()=>s.orch.state.name).toBe('answering');
    await expect.poll(()=>s.orch.state.name,{timeout:15000}).toBe('followup');
    await expect.poll(()=>s.orch.state.name,{timeout:24000}).toBe('ambient');expect(s.questions).toHaveLength(1);
  }finally{await s.close();}
});

test('speech spanning the final sample and tail guard is preserved as one barge utterance',async({page})=>{
  test.setTimeout(35000);const s=await setup(page);try{
    await s.open();await s.play('sales-question.wav');await expect.poll(()=>s.orch.state.name).toBe('answering');
    await page.waitForTimeout(500);
    await page.waitForFunction(()=>{const m=window.voiceFixture;return m.outputContext&&m.outputTail-m.outputContext.currentTime<.17&&m.outputTail-m.outputContext.currentTime>0;},undefined,{timeout:15000,polling:10});
    await s.play('rate-question.wav');await expect.poll(()=>s.orch.state.name,{timeout:2000}).toBe('followup');
    await expect.poll(()=>s.questions.length,{timeout:10000}).toBe(2);await expect.poll(()=>s.orch.state.name).toBe('answering');
    expect(s.requests).toHaveLength(2);
  }finally{await s.close();}
});
test('goodbye and fallback close without accepting speech during their playback',async({page})=>{
  test.setTimeout(40000);const s=await setup(page);try{
    s.client.asr=async()=>({text:'没有了，谢谢',ms:1});await s.open();await s.play('sales-question.wav');await expect.poll(()=>s.orch.state.name).toBe('answering');
    await s.play('rate-question.wav');await expect.poll(()=>s.orch.state.name,{timeout:7000}).toBe('ambient');expect(s.requests).toHaveLength(1);
    s.client.asr=async()=>({text:'本月销售怎么样',ms:1});s.llm.classify=async()=>{throw new Error('test classifier outage');};
    await s.open();await s.play('sales-question.wav');await expect.poll(()=>s.orch.state.name).toBe('error-fallback');
    await s.play('rate-question.wav');await expect.poll(()=>s.orch.state.name,{timeout:7000}).toBe('ambient');expect(s.requests).toHaveLength(2);
  }finally{await s.close();}
});

for(const action of ['Escape','disconnect'] as const)test(`paused playback releases both ends on ${action}`,async({page})=>{
  test.setTimeout(30000);const s=await setup(page);try{
    await s.open();await s.play('sales-question.wav');await expect.poll(()=>s.orch.state.name).toBe('answering');
    await s.play('rate-question.wav');await expect(page.locator('.overlay-root')).toHaveAttribute('data-barge-paused','true',{timeout:1500});
    if(action==='Escape')await page.keyboard.press('Escape');else await page.evaluate(()=>window.voiceFixture.sockets.forEach(socket=>socket.close()));
    await expect.poll(()=>s.orch.state.name,{timeout:7000}).toBe('ambient');await expect(page.locator('.overlay-root')).toHaveCount(0,{timeout:3000});
    expect(s.questions).toHaveLength(1);await s.open();expect(s.orch.state.name).toBe('listening');
  }finally{await s.close();}
});

test('200ms prerecorded speech cannot confirm a barge or submit a business question',async({page})=>{
  test.setTimeout(25000);const s=await setup(page);try{
    await s.open();await s.play('sales-question.wav');await expect.poll(()=>s.orch.state.name).toBe('answering');
    await page.evaluate(async base64=>{
      const m=window.voiceFixture;const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const decoded=await m.context.decodeAudioData(bytes.buffer);
      const samples=decoded.getChannelData(0);let start=0;while(start<samples.length&&Math.abs(samples[start])<.003)start++;
      const clip=m.context.createBuffer(1,Math.round(.2*decoded.sampleRate),decoded.sampleRate);clip.copyToChannel(samples.slice(start,start+clip.length),0);
      const source=m.context.createBufferSource();source.buffer=clip;source.connect(m.destination);source.start();
    },(await readFile(new URL('fixtures/rate-question.wav',import.meta.url))).toString('base64'));
    await page.waitForTimeout(1200);expect(s.requests).toHaveLength(1);expect(s.questions).toHaveLength(1);await expect(page.locator('.overlay-root')).toHaveAttribute('data-barge-paused','false');
    await expect.poll(()=>s.orch.state.name,{timeout:10000}).toBe('followup');
  }finally{await s.close();}
});

test('configured 2s ordinary window reaches the browser and expires from actual ready',async({page})=>{
  test.setTimeout(20000);const s=await setup(page,{listenTimeoutMs:2000});try{
    await s.open();const at=s.readyAt();await page.waitForTimeout(1200);expect(s.orch.state.name).toBe('listening');
    await expect.poll(()=>s.orch.inputLease,{timeout:2000}).toBeNull();expect(Date.now()-at).toBeGreaterThanOrEqual(1900);
    await expect.poll(()=>s.orch.state.name,{timeout:7000}).toBe('ambient');expect(s.requests).toHaveLength(0);
  }finally{await s.close();}
});
test('ordinary rate limit plays an apology and reopens instead of leaving the session',async({page})=>{
  test.setTimeout(35000);const s=await setup(page,{questionWindowMax:1});try{
    await s.open();await s.play('sales-question.wav');await expect.poll(()=>s.questions.length,{timeout:10000}).toBe(1);
    await expect.poll(()=>s.orch.state.name,{timeout:15000}).toBe('followup');
    await s.play('rate-question.wav');await expect.poll(()=>s.requests.length,{timeout:10000}).toBe(2);
    await expect.poll(()=>s.orch.state.name,{timeout:5000}).toBe('listening');expect(s.questions).toHaveLength(1);
    expect(s.orch.answer?.spoken).toBe(FIXED_LINES.unheard);
  }finally{await s.close();}
});
