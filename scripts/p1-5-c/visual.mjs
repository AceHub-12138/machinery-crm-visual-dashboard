/** Visual-only capture: synthetic workload and video must never be included in performance timings. */
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {installProbe} from './instrumentation.mjs';
const out=path.resolve('.review/p1-5-c/visual');mkdirSync(out,{recursive:true});
const base='http://127.0.0.1:3072',fixture='http://127.0.0.1:3199';const children=[],logs=[],report={purpose:'visual only, no performance claim',scenarios:[],errors:[]};let browser,currentPage;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function serve(args,env={}){const p=spawn(process.execPath,args,{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});children.push(p);for(const s of [p.stdout,p.stderr])s.on('data',d=>logs.push(String(d)));}
async function ready(url){for(let i=0;i<300;i++){try{if((await fetch(url)).ok)return;}catch{}await delay(100);}throw Error('Server not ready');}
function state(){const d=document.querySelector('.nexus-motion-debug'),r=document.querySelector('#screen-stage');return {mode:d?.dataset.qualityAutomation,targetHz:Number(d?.dataset.qualityTarget),paused:d?.dataset.paused,performance:JSON.parse(document.querySelector('[data-performance-log]')?.textContent??'[]'),quality:d?.dataset.qualityState,level:d?.dataset.level,scene:d?.dataset.state,clock:Number(d?.dataset.clock),routes:document.querySelectorAll('.nexus-route-light').length,particles:!!document.querySelector('.nexus-particles'),numbers:[...document.querySelectorAll('[data-motion-number]')].map(n=>n.textContent),feed:document.querySelectorAll('.nexus-feed-item').length,mapPaths:document.querySelectorAll('.nexus-map-frame path').length,audit:JSON.parse(document.querySelector('[data-gsap-audit]')?.textContent??'null'),travelers:[...document.querySelectorAll('.nexus-route-traveler')].map(n=>({x:n.getAttribute('cx'),y:n.getAttribute('cy'),opacity:n.getAttribute('opacity')})),decisions:JSON.parse(document.querySelector('[data-quality-log]')?.textContent??'[]'),time:Number(r?.getAttribute('data-motion-time'))};}
async function waitQuality(page,quality){await page.waitForFunction(q=>document.querySelector('.nexus-motion-debug')?.dataset.qualityState===q,quality,{timeout:Number(process.env.P15C_VISUAL_TIMEOUT??90000),polling:100});}
try{
  for(const url of [base,fixture]){let busy=false;try{await fetch(url);busy=true;}catch{}if(busy)throw Error(`Occupied ${url}`);}
  serve(['e2e/nexus-fixture-server.mjs']);await ready(fixture);
  serve(['scripts/p1-5-c/local-server.mjs','--port','3072'],{SCREEN_PLATFORM_URL:fixture,SCREEN_PUBLIC_ID:'fixture-only',NEXUS_QUALITY_PERMISSION:'local-candidate'});await ready(`${base}/screen/sales?source=mock`);
  browser=await chromium.launch({headless:false});const cdp=await browser.newBrowserCDPSession();report.environment={browser:browser.version(),gpu:await cdp.send('SystemInfo.getInfo'),headless:false,dpr:1};
  for(const engine of (process.env.P15C_VISUAL_ENGINES??'legacy,gsap').split(','))for(const width of (process.env.P15C_VISUAL_WIDTHS??'1280,1792,1920,3840').split(',').map(Number)){
    const video=width===1920,context=await browser.newContext({viewport:{width,height:Math.round(width*9/16)},deviceScaleFactor:1,reducedMotion:'no-preference',...(video?{recordVideo:{dir:path.join(out,'videos'),size:{width:1280,height:720}}}:{})});await context.addInitScript(installProbe,60);
    const page=await context.newPage();currentPage=page;page.on('pageerror',e=>report.errors.push(e.message));
    // Warm fonts/assets in the same engine before the finite reference calibration. No quality controls.
    await page.goto(`${base}/screen/sales?motion=${engine}&layout=16x9`);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);
    await page.goto(`${base}/screen/sales?debug=1&motion=${engine}&qualityExperiment=candidate&layout=16x9`);await page.waitForFunction(()=>document.querySelector('.nexus-motion-debug')?.dataset.paused==='false',undefined,{polling:100});await page.evaluate(()=>document.fonts.ready);await page.addStyleTag({content:'.nexus-motion-debug{display:none!important}'});
    const s={engine,width,frames:[],sequence:[],video:null};const record=async(label)=>{const at=await page.evaluate(state);const file=`${engine}-${width}-${label}.png`;await page.screenshot({path:path.join(out,file)});const after=await page.evaluate(state);s.frames.push({label,file,...at,captureEndQuality:after.quality,captureEndClock:after.clock});report.partialScenario=s;writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({engine,width,label,mode:at.mode,targetHz:at.targetHz,quality:at.quality}));};
    await record('normal');assert.equal(s.frames[0].mode,'candidate','Visual scenario must not silently fall back to Baseline');
    await page.evaluate(()=>{window.__visualBurn=setInterval(()=>{const until=performance.now()+85;while(performance.now()<until){}},100);});
    await waitQuality(page,'low');await record('low');await waitQuality(page,'probe');
    await record('probe');
    for(let i=0;i<10;i++){s.sequence.push(await page.evaluate(state));await page.waitForTimeout(100);}
    await waitQuality(page,'low');await record('failed-low');await page.evaluate(()=>clearInterval(window.__visualBurn));
    await waitQuality(page,'probe');await record('recover-probe');
    for(let i=0;i<5;i++){s.sequence.push(await page.evaluate(state));await page.waitForTimeout(100);}
    await waitQuality(page,'normal');await record('recovered-normal');
    await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.querySelector('#screen-stage')?.getAttribute('data-motion-level')==='static',undefined,{polling:100});await record('reduced-motion');
    await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>document.querySelector('.nexus-motion-debug')?.dataset.paused==='false',undefined,{polling:100});
    const initial=s.frames[0];for(const f of s.frames){assert.equal(f.routes,initial.routes);assert.equal(f.mapPaths,initial.mapPaths);assert.equal(f.feed,initial.feed);assert.equal(f.particles,true);assert.deepEqual(f.numbers,initial.numbers);}
    assert.ok(s.frames.some(f=>f.label==='probe'&&f.level==='normal'));assert.ok(s.frames.some(f=>f.label==='recovered-normal'&&f.quality==='normal'));
    const videoFile=page.video();await context.close();if(videoFile){s.video=path.relative(out,await videoFile.path());}
    report.scenarios.push(s);writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({engine,width,frames:s.frames.length,video:s.video}));
  }
  report.status='passed';assert.equal(report.errors.length,0);
}catch(e){report.status='failed';report.failure=e.stack;try{report.lastSnapshot=await currentPage?.evaluate(state);}catch{}throw e;}
finally{writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();for(const p of children)p.kill('SIGTERM');writeFileSync(path.join(out,'servers.log'),logs.join(''));}
