/* eslint-disable @typescript-eslint/no-explicit-any -- browser-only diagnostic instrumentation */
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { startVoiceHub, type VoiceHubServer } from "../services/voice-orchestrator/src/ws/ws-server";
import { CARD_INTENTS, task12Card } from "./task12-fixtures";
import { displaySpoken } from "../src/lib/voice/card-presentation";
import { auditText } from "./layout-audit";
import type { AnswerCardData } from "../src/lib/voice/session-machine";
const out = path.resolve(process.env.P16_OUTPUT_DIR ?? "docs/nexus-p1-6");
mkdirSync(`${out}/evidence`, {recursive:true}); mkdirSync(`${out}/media`, {recursive:true});
const pcm = [0,1].map(i=>readFileSync(path.resolve(`docs/nexus-p1-6/audio/${i}.pcm`)));
const card: AnswerCardData = {kind:"customer-kpi",title:"本期客户概览 · 脱敏演示",newCustomers:12,totalCustomers:120,spoken:"本期新增客户十二家。客户总数为一百二十家。"};
const speech = (id:string) => ({turnId:id,sentences:[{index:0,displayStart:0,displayEnd:10},{index:1,displayStart:10,displayEnd:21}]});
let hub:VoiceHubServer, fail=false, autoFollowup=true, turn=0;
const reports:Array<Record<string,unknown>>=[];
function emit(event:object) { hub.broadcast({at:Date.now(),...event}); }
function state(from:string,to:string) { emit({type:"state.change",from,to,turn}); }
test.beforeAll(async()=>{
  hub=await startVoiceHub({host:"127.0.0.1",port:0,
    onHttpRequest:(req,res)=>{
      res.setHeader("access-control-allow-origin",String(req.headers.origin??"*"));
      res.setHeader("access-control-expose-headers","x-sample-rate,x-channels,x-sample-format");
      if(req.method==="OPTIONS"){res.writeHead(204,{"access-control-allow-methods":"GET","access-control-allow-headers":"Authorization"});res.end();return;}
      const match=/\/voice\/audio\/[^/]+\/(\d+)$/.exec(req.url??"");
      if(!match||fail){res.writeHead(503);res.end();return;}
      const bytes=pcm[Number(match[1])];
      res.writeHead(200,{"content-type":"audio/pcm","x-sample-rate":"24000","x-channels":"1","x-sample-format":"s16le"});res.end(bytes);
    },
    onMessage:(conn,raw)=>{const event=JSON.parse(raw);if(event.type==="console.hello") conn.role="screen";
      if(event.type.startsWith("playback.")) reports.push(event);
      if(event.type==="playback.drained"&&autoFollowup) state("answering","followup");
    },
  });
});
test.afterAll(async()=>{await hub?.close();});
test.beforeEach(()=>{reports.length=0; fail=false;autoFollowup=true;turn=0;});
async function instrument(context:BrowserContext) {
  await context.addInitScript(()=>{
    const w=window as any; // diagnostic harness only
    const metrics:any={frames:[],canvasMs:[],callbackMs:[],scheduled:[],stopped:0,peak:0,events:[],samples:[],pending:0,sourceCounts:[],recorderAt:null};
    w.p16=metrics;
    const pending=new Set<number>();const raf=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);
    let draws=0,last=0;
    const draw=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(...args:any[]){draws++;return (draw as any).apply(this,args);};
    window.requestAnimationFrame=fn=>{let id=0;id=raf(now=>{pending.delete(id);const start=performance.now(),before=draws;fn(now);const ms=performance.now()-start;metrics.callbackMs.push(ms);if(draws>before)metrics.canvasMs.push(ms);metrics.pending=pending.size;});pending.add(id);return id;};
    window.cancelAnimationFrame=id=>{pending.delete(id);cancel(id);};
    const observe=(now:number)=>{
      if(last)metrics.frames.push(now-last);last=now;
      const root=document.querySelector<HTMLElement>(".overlay-root"),body=document.querySelector<HTMLElement>(".overlay-card-body"),line=document.querySelector<HTMLElement>(".overlay-card-line");
      if(root&&metrics.samples.length<10000){const m=w.__xiaochuanMotionAudit?.();metrics.samples.push({at:now,state:root.dataset.state,phase:root.dataset.phase,opacity:getComputedStyle(root).opacity,launchAt:document.querySelector<HTMLElement>(".overlay-card")?.dataset.launchAt,body:body?.style.transform,bodyOpacity:body?.style.opacity,line:line?.style.transform,dash:document.querySelector<SVGElement>(".overlay-card-frame-rect")?.style.strokeDashoffset,visual:m?.visual,canvas:m?.canvasSample,highlight:document.querySelector(".overlay-sentence-active")?.textContent??null});}
      raf(observe);
    };raf(observe); // observer is outside the product pending-RAF count
    const Native=window.AudioContext;
    w.captures=[];
    window.AudioContext=class extends Native {
      constructor(options?:AudioContextOptions){super(options);
        const dest=this.createMediaStreamDestination(),chunks:BlobPart[]=[];const recorder=new MediaRecorder(dest.stream,{mimeType:"audio/webm;codecs=opus"});
        const capture={context:this,dest,recorder,chunks,start:performance.now()};w.captures.push(capture);recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
        recorder.start();metrics.recorderAt=capture.start;
      }
    };
    const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(...args:any[]){const capture=w.captures.find((c:any)=>c.context===this.context);if(capture&&args[0]===this.context.destination)(connect as any).call(this,capture.dest);return (connect as any).apply(this,args);};
    const source=AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource=function(){const node=source.call(this),start=node.start.bind(node),stop=node.stop.bind(node);node.start=(when=0)=>{metrics.scheduled.push({at:performance.now(),contextTime:this.currentTime,when,duration:node.buffer?.duration});start(when);};node.stop=(when=0)=>{metrics.stopped++;stop(when);};return node;};
    const sample=AnalyserNode.prototype.getFloatTimeDomainData;
    AnalyserNode.prototype.getFloatTimeDomainData=function(data){sample.call(this,data);let sum=0;for(const x of data)sum+=x*x;metrics.peak=Math.max(metrics.peak,Math.sqrt(sum/data.length));};
  });
}
async function open(page:Page,engine:string,route="/screen/sales") {
  await page.goto(`${route}${route.includes("?")?"&":"?"}debug=1&voiceLive=1&xiaochuanMotion=${engine}&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);
  await expect.poll(()=>hub.counts().screens).toBeGreaterThan(0);
  if(engine==="gsap") await expect.poll(()=>audit(page)).not.toBeNull();
  else expect(await audit(page)).toBeNull();
  await page.evaluate(()=>document.fonts.ready); await page.mouse.click(40,100); await page.waitForTimeout(500);
}
async function wake(page:Page){emit({type:"session.start",sessionId:"p16-fixture"});await expect(page.locator(".overlay-root")).toHaveCount(1);}
async function listen(page:Page){state("waking","listening");await expect(page.locator(".overlay-root")).toHaveAttribute("data-state","listening");emit({type:"asr.partial",text:"本期新增客户有多少家",final:false});}
async function answer(page:Page,answerCard:AnswerCardData=card,withSpeech=true){state("listening","thinking");await expect(page.locator(".overlay-root")).toHaveAttribute("data-state","thinking");await page.waitForTimeout(300);turn++;const id=`00000000-0000-4000-8000-${String(turn).padStart(12,"0")}`;emit({type:"answer.delta",seq:0,text:answerCard.spoken,full:true,card:answerCard,...(withSpeech?{speech:speech(id)}:{})});state("thinking","answering");await expect(page.locator(".overlay-root")).toHaveAttribute("data-state","answering");return id;}
async function close(page:Page){state("answering","closing");await expect(page.locator(".overlay-root")).toHaveCount(0,{timeout:4000});}
async function audit(page:Page){return page.evaluate(()=>(window as any).__xiaochuanMotionAudit?.()??null);}
async function save(page:Page,name:string){await page.screenshot({path:`${out}/media/${name}.png`});}
async function data(page:Page){return page.evaluate(()=>(window as any).p16);}
for(const engine of ["legacy","gsap"]) {
  test(`${engine} full interaction film`,async({browser})=>{
    const videoStart=Date.now();const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,recordVideo:{dir:path.resolve(".review/p1-6/video"),size:{width:1920,height:1080}},reducedMotion:"no-preference"});
    await instrument(context);const page=await context.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
    await open(page,engine);await wake(page);await page.waitForTimeout(450);await save(page,`${engine}-wake`);
    await page.waitForTimeout(500);await listen(page);await page.waitForTimeout(500);state("listening","thinking");await page.waitForTimeout(400);await save(page,`${engine}-thinking`);
    const first=await answer(page);await page.waitForTimeout(720);await save(page,`${engine}-answer`);
    await expect(page.locator(".overlay-sentence-active")).toHaveCount(1);await save(page,`${engine}-speaking`);
    await expect.poll(()=>reports.some(r=>r.type==="playback.drained"&&r.turnId===first)).toBe(true);
    await expect(page.locator(".overlay-root")).toHaveAttribute("data-state","followup");
    const second=await answer(page);await expect.poll(()=>reports.some(r=>r.type==="playback.started"&&r.turnId===second)).toBe(true);await page.waitForTimeout(1000);
    const stops=(await data(page)).stopped;state("answering","listening");await expect(page.locator(".overlay-root")).toHaveAttribute("data-state","listening");await page.waitForTimeout(100);await save(page,`${engine}-interrupt`);
    expect((await data(page)).stopped).toBeGreaterThan(stops);await page.waitForTimeout(300);const third=await answer(page);
    await expect.poll(()=>reports.some(r=>r.type==="playback.drained"&&r.turnId===third)).toBe(true);await save(page,`${engine}-followup`);
    state("followup","closing");await page.waitForTimeout(40);if(engine==="gsap")await expect(page.locator(".overlay-card-spoken")).toHaveText(card.spoken,{timeout:100});await save(page,`${engine}-exit`);if(engine==="gsap"){await page.waitForTimeout(500);expect(Number(await page.locator(".overlay-root").evaluate(el=>getComputedStyle(el).opacity))).toBeLessThan(.99);await save(page,`${engine}-return-crossfade`);}await expect(page.locator(".overlay-root")).toHaveCount(0);await page.waitForTimeout(300);await save(page,`${engine}-returned`);
    const metrics=await data(page);expect(metrics.peak).toBeGreaterThan(.01);expect(errors).toEqual([]);
    if(engine==="gsap"){const a=await audit(page);expect(a.liveTimelines).toBe(0);expect(a.pendingJob).toBe(false);}
    const captured=await page.evaluate(async()=>{const w=window as any;const c=w.captures[0];if(!c)return null;await new Promise<void>(resolve=>{c.recorder.onstop=()=>resolve();c.recorder.stop();});const blob=new Blob(c.chunks,{type:"audio/webm"});const bytes=new Uint8Array(await blob.arrayBuffer());let binary="";for(const x of bytes)binary+=String.fromCharCode(x);return{base64:btoa(binary),start:c.start,timeOrigin:performance.timeOrigin};});
    if(captured)writeFileSync(`${out}/media/${engine}-browser-audio.webm`,Buffer.from(captured.base64,"base64"));
    writeFileSync(`${out}/evidence/${engine}-film.json`,JSON.stringify({videoStart,audio:captured?{start:captured.start,timeOrigin:captured.timeOrigin}:null,fixture:card,pcmSeconds:pcm.map(b=>b.length/48000),reports:[...reports],errors,audit:await audit(page),metrics},null,2));
    const video=page.video()!;await context.close();await video.saveAs(`${out}/media/${engine}-interaction.webm`);
  });
  for(const viewport of [{width:1280,height:720},{width:1792,height:832},{width:1920,height:1080},{width:3840,height:2160}]) {
    test(`${engine} ${viewport.width} geometry and performance`,async({browser})=>{
      const context=await browser.newContext({viewport,deviceScaleFactor:1,reducedMotion:"no-preference"});await instrument(context);const page=await context.newPage();await open(page,engine);
      const cdp=await context.newCDPSession(page);await cdp.send("Performance.enable");const before=await cdp.send("Performance.getMetrics");
      await wake(page);await page.waitForTimeout(950);await listen(page);const id=await answer(page);
      await expect.poll(()=>reports.some(r=>r.type==="playback.drained"&&r.turnId===id)).toBe(true);await page.waitForTimeout(500);
      const box=await page.locator(".overlay-card").boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height);
      await expect(page.locator(".overlay-card-spoken")).toHaveText(card.spoken);await expect(page.locator(".overlay-card-data")).toHaveCSS("opacity","1");await expect(page.locator(".overlay-card-data")).toContainText("120");await save(page,`${process.env.P16_PERF_TAG??""}${engine}-${viewport.width}`);
      const after=await cdp.send("Performance.getMetrics");const metrics=await data(page);
      const gpu=await page.evaluate(()=>{const canvas=document.createElement("canvas"),gl=canvas.getContext("webgl");const ext=gl?.getExtension("WEBGL_debug_renderer_info");return{renderer:ext?gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,dpr:devicePixelRatio};});
      await close(page);await page.waitForTimeout(500);const a=await audit(page);if(a){expect(a.liveTimelines).toBe(0);expect(a.pendingJob).toBe(false);}
      writeFileSync(`${out}/evidence/${process.env.P16_PERF_TAG??""}${engine}-${viewport.width}-performance.json`,JSON.stringify({viewport,gpu,before,after,metrics,audit:a,reports:[...reports]},null,2));await context.close();
    });
  }
  test(`${engine} audio failure reduced motion and repeated wake exit`,async({browser})=>{
    const context=await browser.newContext({reducedMotion:"reduce"});await instrument(context);const page=await context.newPage();await open(page,engine);fail=true;
    for(let i=0;i<4;i++){await wake(page);await listen(page);await answer(page);await expect(page.locator(".overlay-card-spoken")).toHaveText(card.spoken);await expect(page.locator(".overlay-audio-notice")).toContainText("查看卡片");await close(page);}
    expect(reports.some(r=>r.type==="playback.drained")).toBe(false);expect(reports.some(r=>r.type==="playback.failed")).toBe(true);
    const a=await audit(page);if(a){expect(a.liveTimelines).toBe(0);expect(a.pendingJob).toBe(false);}writeFileSync(`${out}/evidence/${engine}-reduced-failure.json`,JSON.stringify({audit:a,reports},null,2));await context.close();
  });
  test(`${engine} hidden restore early interruption navigation and reentry`,async({browser})=>{
    const context=await browser.newContext({reducedMotion:"no-preference"});await instrument(context);const page=await context.newPage();await open(page,engine,"/poc/xiaochuan");autoFollowup=false;
    await wake(page);await listen(page);await answer(page);await page.waitForTimeout(100);state("answering","listening");await page.waitForTimeout(250);await expect(page.locator(".overlay-card")).toHaveCount(0);
    for(let i=0;i<5;i++){await answer(page);await page.waitForTimeout(150);state("answering","listening");await page.waitForTimeout(220);}
    await answer(page);await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"));});await page.waitForTimeout(1300);
    const hidden=await audit(page);if(hidden)expect(hidden.pendingJob).toBe(false);
    await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});document.dispatchEvent(new Event("visibilitychange"));});await page.waitForTimeout(100);await expect(page.locator(".overlay-card-body")).toHaveCSS("transform","matrix(1, 0, 0, 1, 0, 0)");
    const restored=await audit(page);
    if(engine==="gsap") await page.evaluate(()=>{(window as any).p161SavedAudit=(window as any).__xiaochuanMotionAudit;});
    await page.getByRole("button",{name:"卸载小川",exact:true}).click();
    await expect.poll(()=>hub.counts().screens).toBe(0);
    const canvasCount=(await data(page)).canvasMs.length;await page.waitForTimeout(150);expect((await data(page)).canvasMs.length).toBe(canvasCount);
    const unmounted=await audit(page);expect(unmounted).toBeNull();
    if(engine==="gsap") expect(await page.evaluate(()=>(window as any).p161SavedAudit())).toBeNull();
    await page.getByRole("button",{name:"重新挂载小川",exact:true}).click();await expect.poll(()=>hub.counts().screens).toBe(1);
    await wake(page);await listen(page);await answer(page);
    await page.getByRole("link",{name:"离开原型"}).click();await expect(page).toHaveURL(/voice-console/);
    await expect.poll(()=>hub.counts().screens).toBe(0);
    const navigated=await audit(page);expect(navigated).toBeNull();
    await page.goBack();await expect(page).toHaveURL(/poc\/xiaochuan/);if(await page.getByRole("button",{name:"重新挂载小川",exact:true}).count())await page.getByRole("button",{name:"重新挂载小川",exact:true}).click();await expect.poll(()=>hub.counts().screens).toBe(1);
    await wake(page);await listen(page);await answer(page);await close(page);
    const a=await audit(page);if(a){expect(a.liveControllers).toBe(1);expect(a.liveTimelines).toBe(0);expect(a.pendingJob).toBe(false);}
    writeFileSync(`${out}/evidence/${engine}-lifecycle.json`,JSON.stringify({hidden,restored,unmounted,navigated,final:a,reports},null,2));await context.close();
  });
}
test("main GSAP and overlay share the existing ticker owner without altering its cap",async({browser})=>{
  const context=await browser.newContext({reducedMotion:"no-preference"});await instrument(context);const page=await context.newPage();
  await open(page,"gsap","/screen/sales?motion=gsap");
  await wake(page);await listen(page);await answer(page);const active=await audit(page);expect(active.configuredCapHz).toBe(60);expect(active.activeListeners).toBeLessThanOrEqual(2);
  await close(page);const closed=await audit(page);expect(closed.liveTimelines).toBe(0);expect(closed.pendingJob).toBe(false);expect(closed.activeListeners).toBeLessThanOrEqual(1);
  writeFileSync(`${out}/evidence/shared-owner.json`,JSON.stringify({active,closed},null,2));await context.close();
});

test("gsap P1.3 normal and long templates retain layout and spoken pagination",async({browser})=>{
  const context=await browser.newContext({viewport:{width:1792,height:832},deviceScaleFactor:1,reducedMotion:"no-preference"});await instrument(context);const page=await context.newPage();await open(page,"gsap");
  emit({type:"session.start",sessionId:"p16-layout",screenId:"11111111-1111-4111-8111-111111111111"});await expect(page.locator(".overlay-root")).toHaveCount(1);await listen(page);
  const measured=[];
  for(const variant of ["normal","long"] as const)for(const intent of CARD_INTENTS){
    const fixture=task12Card(intent,variant);await answer(page,fixture,false);await page.waitForTimeout(950);
    await expect(page.locator(".overlay-card-header")).toHaveCSS("opacity","1");await expect(page.locator(".overlay-card-body")).toHaveAttribute("data-spoken-complete","true");await expect(page.locator(".overlay-card-spoken")).toHaveAttribute("data-measured","true");
    const bounds=await page.locator(".overlay-card").boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(832);
    expect(await auditText(page,".overlay-root")).toEqual([]);
    const pages=Number(await page.locator(".overlay-spoken-section").getAttribute("data-pages")),parts=new Map<number,string>();
    for(let i=0;i<pages;i++){parts.set(Number(await page.locator(".overlay-spoken-section").getAttribute("data-page")),await page.locator(".overlay-card-spoken").innerText());if(pages>1)await page.getByRole("button",{name:"下一页播报"}).click();}
    expect([...parts].sort((a,b)=>a[0]-b[0]).map(([,text])=>text).join("")).toBe(displaySpoken(fixture.spoken));
    measured.push({variant,intent,kind:fixture.kind,pages,bounds});
  }
  await close(page);writeFileSync(`${out}/evidence/gsap-p13-layout.json`,JSON.stringify(measured,null,2));await context.close();
});
