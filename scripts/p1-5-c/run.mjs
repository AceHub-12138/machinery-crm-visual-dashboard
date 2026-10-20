/** Real-time local evidence; production Candidate owns all quality decisions. No debug quality clicks. */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installProbe } from './instrumentation.mjs';
const phase=process.env.P15C_PHASE??'smoke',engine=process.env.P15C_ENGINE??'gsap';
const durationMs=Number(process.env.P15C_DURATION_MS??90000),width=Number(process.env.P15C_WIDTH??3840);
const reliefAtMs=Number(process.env.P15C_RELIEF_AT_MS??(durationMs-70000));
const port=3071, base=`http://127.0.0.1:${port}`,fixture='http://127.0.0.1:3199';
const output=path.resolve(`.review/p1-5-c/${phase}-${engine}`);mkdirSync(output,{recursive:true});
const save=(name,value)=>writeFileSync(path.join(output,name),JSON.stringify(value,null,2));
const children=[], logs=[];let browser;
const transitionMap=new Map();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function server(args,env={}) {const p=spawn(process.execPath,args,{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});children.push(p);for(const stream of [p.stdout,p.stderr])stream.on('data',d=>logs.push(String(d)));}
async function ready(url){for(let i=0;i<300;i++){try{if((await fetch(url)).ok)return;}catch{}await delay(100);}throw Error(`Not ready ${url}`);}
const report={phase,engine,durationMs,width,reliefAtMs,startedAt:new Date().toISOString(),samples:[],resources:[],actions:[],errors:[],network:[],caveats:['RAF/update counts are scheduling evidence, not presented frames.','Performance timing excludes screenshots/video.','Test RAF target capped at 60Hz; production Legacy cap unchanged.']};
function snapshot(){const probe=window.__p15cProbe.snapshot(true),intervals=probe.engineIntervals.sort((a,b)=>a-b);const d=document.querySelector('.nexus-motion-debug'),q=JSON.parse(document.querySelector('[data-quality-log]')?.textContent??'[]');return {raf:{updates:intervals.length,p95Ms:intervals[Math.ceil(intervals.length*.95)-1]??null,maxPending:probe.maxPending},level:d?.dataset.level,state:d?.dataset.state,paused:d?.dataset.paused,mode:d?.dataset.qualityAutomation,targetHz:Number(d?.dataset.qualityTarget),decision:q.at(-1),qualityRecords:q,audit:JSON.parse(document.querySelector('[data-gsap-audit]')?.textContent??'null'),timers:window.__p15cProbe.timerAudit()};}
try {
  for(const url of [base,fixture]){let busy=false;try{await fetch(url);busy=true;}catch{}if(busy)throw Error(`Occupied ${url}`);}
  server(['e2e/nexus-fixture-server.mjs']);await ready(fixture);
  server(['scripts/p1-5-c/local-server.mjs','--port',String(port)],{SCREEN_PLATFORM_URL:fixture,SCREEN_PUBLIC_ID:'fixture-only',NEXUS_QUALITY_PERMISSION:'local-candidate',TZ:'Asia/Shanghai'});await ready(`${base}/screen/sales?source=mock`);
  browser=await chromium.launch({headless:process.env.P15C_HEADED!=='1'});
  const bc=await browser.newBrowserCDPSession();report.environment={browser:browser.version(),gpu:await bc.send('SystemInfo.getInfo'),cpu:os.cpus()[0].model,memoryBytes:os.totalmem(),headless:process.env.P15C_HEADED!=='1',dpr:1};
  const context=await browser.newContext({viewport:{width,height:Math.round(width*9/16)},deviceScaleFactor:1,reducedMotion:'no-preference'});await context.addInitScript(installProbe,60);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('requestfailed',r=>report.network.push({url:r.url(),error:r.failure()?.errorText}));page.on('response',r=>{if(r.status()>=400)report.network.push({url:r.url(),status:r.status()});});
  await page.goto(`${base}/screen/sales?debug=1&layout=16x9&motion=${engine}&qualityExperiment=candidate`);
  await page.waitForFunction(()=>document.querySelector('.nexus-motion-debug')?.dataset.qualityAutomation==='candidate',undefined,{polling:100});
  await page.waitForFunction(()=>document.querySelector('.nexus-motion-debug')?.dataset.paused==='false',undefined,{polling:100});
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(3000);
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
  await page.addStyleTag({content:'.nexus-motion-debug{display:none!important}'});
  const start=Date.now();let relieved=false,nextResource=0,nextLifecycle=phase==='soak'?120000:Infinity,lifecycleIndex=0;
  const resources=async(elapsedMs)=>{const metrics=await cdp.send('Performance.getMetrics');return {elapsedMs,...Object.fromEntries(metrics.metrics.filter(x=>['JSHeapUsedSize','JSHeapTotalSize','Nodes','JSEventListeners','Documents'].includes(x.name)).map(x=>[x.name,x.value])),dom:await cdp.send('Memory.getDOMCounters'),...await page.evaluate(snapshot)};};
  while(Date.now()-start<durationMs){
    await page.waitForTimeout(Math.min(1000,durationMs-(Date.now()-start)));const elapsedMs=Date.now()-start,s=await page.evaluate(snapshot);for(const d of s.qualityRecords)if(d.state!==d.previous)transitionMap.set(JSON.stringify(d),d);delete s.qualityRecords;report.samples.push({elapsedMs,...s});
    if(elapsedMs>=nextResource){report.resources.push(await resources(elapsedMs));nextResource+=60000;save('report.json',report);console.log(JSON.stringify({phase,engine,elapsedMs,level:s.level,policy:s.decision?.state,failures:s.decision?.failureCount,ticker:s.audit?.activeListeners,timers:s.timers}));}
    if(!relieved&&elapsedMs>=reliefAtMs){await page.setViewportSize({width:1920,height:1080});relieved=true;report.actions.push({elapsedMs,action:'viewport-relief-3840-to-1920',visualModulesRemoved:0});}
    if(elapsedMs>=nextLifecycle){
      const kind=['hidden','voice','reduced'][lifecycleIndex%3];report.actions.push({elapsedMs,action:kind});
      if(kind==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
      if(kind==='voice')await page.evaluate(()=>window.dispatchEvent(new CustomEvent('nexus-debug-voice',{detail:true})));
      if(kind==='reduced')await page.emulateMedia({reducedMotion:'reduce'});
      await page.waitForTimeout(1000);const paused=await page.evaluate(snapshot);report.actions.push({elapsedMs:Date.now()-start,action:'paused-audit',kind,snapshot:paused});assert.equal(paused.paused,'true');if(engine==='gsap')assert.equal(paused.audit.activeListeners,0);
      if(kind==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
      if(kind==='voice')await page.evaluate(()=>window.dispatchEvent(new CustomEvent('nexus-debug-voice',{detail:false})));
      if(kind==='reduced')await page.emulateMedia({reducedMotion:'no-preference'});
      await page.waitForFunction(()=>document.querySelector('.nexus-motion-debug')?.dataset.paused==='false',undefined,{polling:100});
      lifecycleIndex++;nextLifecycle+=180000;
    }
  }
  report.actualMs=Date.now()-start;
  const observationGaps=report.samples.map((s,i)=>s.elapsedMs-(i?report.samples[i-1].elapsedMs:0));
  report.observationCoverage={samples:report.samples.length,maxGapMs:Math.max(...observationGaps)};
  assert.ok(report.actualMs>=durationMs);assert.ok(report.observationCoverage.maxGapMs<10000,'Unobserved scheduling gap: possible host sleep or stalled collection');report.final=await resources(report.actualMs);await cdp.send('HeapProfiler.collectGarbage');report.afterGC=await resources(Date.now()-start);
  report.transitions=[...transitionMap.values()];
  report.finishedAt=new Date().toISOString();assert.equal(report.errors.length,0);assert.equal(report.final.mode,'candidate');assert.equal(report.final.level,'normal');assert.ok(report.transitions.some(d=>d.reason==='normal-load-probe-failed'));assert.ok(report.transitions.some(d=>d.reason==='normal-load-probe-passed'));
  if(engine==='gsap'){assert.equal(report.final.audit.activeListeners,1);assert.equal(report.final.audit.liveScenes,1);assert.equal(report.final.audit.rootAnimations,0);}
  report.status='passed';save('report.json',report);console.log(JSON.stringify({status:report.status,actualMs:report.actualMs,transitions:report.transitions.length}));await context.close();
}catch(error){report.status='failed';report.failure=error.stack;save('report.json',report);throw error;}
finally{await browser?.close();for(const p of children)p.kill('SIGTERM');writeFileSync(path.join(output,'servers.log'),logs.join(''));}
