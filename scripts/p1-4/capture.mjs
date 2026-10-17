/** P1.4 diagnostic runner. No product source mutation. Run AFTER original benchmark. */
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import os from 'node:os';
const dir = '.review/p1-4'; mkdirSync(dir, {recursive:true});
const base = 'http://127.0.0.1:3048', fixture = 'http://127.0.0.1:3199';
const children=[], serverLogs=[];
const save=(file,data)=>writeFileSync(`${dir}/${file}`,JSON.stringify(data,null,2));
const original=readFileSync('scripts/gsap-poc-benchmark.mjs','utf8');
// Reuse the exact original seeded RAF collector and summary, including its limitations.
const instrument = new Function(`return ${original.slice(original.indexOf('function instrument()'),original.indexOf('const quantile'))}`)();
const summarize = new Function(`${original.slice(original.indexOf('const quantile'),original.indexOf('let browser;'))}; return summary;`)();
function server(args,env={}) { const p=spawn(process.execPath,args,{env:{...process.env,...env},stdio:['ignore','pipe','pipe']}); children.push(p); for(const s of [p.stdout,p.stderr])s.on('data',b=>serverLogs.push(b.toString())); return p; }
async function ready(url) { for(let n=0;n<200;n++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error(`Not ready ${url}`); }
let browser;
async function context(engine,width=3840,metrics=true) {
  await fetch(`${fixture}/control?reset=1`);
  const ctx=await browser.newContext({viewport:{width,height:width*9/16},deviceScaleFactor:1,reducedMotion:'no-preference',timezoneId:'Asia/Shanghai'});
  if(metrics) await ctx.addInitScript(instrument);
  else await ctx.addInitScript(()=>{let seed=713;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};});
  const page=await ctx.newPage(),errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const cdp=await ctx.newCDPSession(page); await cdp.send('Performance.enable');
  await page.goto(`${base}/screen/sales?layout=16x9&motion=${engine}&debug=1`);
  await page.locator(`#screen-stage[data-motion-engine="${engine}"]`).waitFor(); await page.evaluate(()=>document.fonts.ready); await page.waitForTimeout(3000);
  await page.addStyleTag({content:'.nexus-motion-debug{display:none!important}'});
  return {ctx,page,cdp,errors};
}
async function trace(cdp,file,fn) {
  const done=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
  await cdp.send('Tracing.start',{transferMode:'ReturnAsStream',traceConfig:{recordMode:'recordUntilFull',traceBufferSizeInKb:262144,includedCategories:'toplevel,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking,disabled-by-default-devtools.timeline.layers,blink.user_timing,cc,gpu,viz,benchmark,disabled-by-default-gpu.service'.split(',')}});
  const result=await fn(); await cdp.send('Tracing.end'); const completion=await done;const {stream,...status}=completion;save(`${file}-trace-status.json`,status);
  const gzip=createGzip(), output=createWriteStream(`${dir}/${file}.trace.json.gz`); gzip.pipe(output);
  while(true){const chunk=await cdp.send('IO.read',{handle:stream}); if(chunk.data&&!gzip.write(Buffer.from(chunk.data,chunk.base64Encoded?'base64':'utf8')))await once(gzip,'drain');if(chunk.eof)break;}
  await cdp.send('IO.close',{handle:stream});gzip.end();await once(output,'finish');return result;
}
async function snapshot(cdp,file) {
  const output=createWriteStream(`${dir}/${file}.heapsnapshot`);
  const onChunk=({chunk})=>output.write(chunk); cdp.on('HeapProfiler.addHeapSnapshotChunk',onChunk);
  await cdp.send('HeapProfiler.takeHeapSnapshot',{reportProgress:false,captureNumericValue:true}); cdp.off('HeapProfiler.addHeapSnapshotChunk',onChunk);
  output.end();await once(output,'finish');
}
async function measure(page,cdp,ms,mutations=false,pulse=false) {
  if(mutations)await page.evaluate(()=>{window.p14Writes={attr:{},style:{},canvas:{}};
    const a=Element.prototype.setAttribute;Element.prototype.setAttribute=function(k,v){const key=this.tagName+':'+k;window.p14Writes.attr[key]=(window.p14Writes.attr[key]??0)+1;return a.call(this,k,v);};
    const s=CSSStyleDeclaration.prototype.setProperty;CSSStyleDeclaration.prototype.setProperty=function(k,v,p){window.p14Writes.style[k]=(window.p14Writes.style[k]??0)+1;return s.call(this,k,v,p);};
    for(const k of ['clearRect','fillRect','drawImage']){const f=CanvasRenderingContext2D.prototype[k];CanvasRenderingContext2D.prototype[k]=function(...v){window.p14Writes.canvas[k]=(window.p14Writes.canvas[k]??0)+1;return f.apply(this,v);};}
  });
  await page.evaluate(()=>window.pocMetrics(true));
  const before=await cdp.send('Performance.getMetrics'); const started=Date.now(),segments=[];let pulseTriggered=false;
  while(Date.now()-started<ms){await page.waitForTimeout(Math.min(1000,ms-(Date.now()-started))); const seg=await page.evaluate(()=>{
    const m=window.pocMetrics(true), el=document.querySelector('#screen-stage');
    const debugText=document.querySelector('.nexus-motion-debug p:nth-child(2)')?.textContent??'';
    return {time:performance.now(),intervals:m.intervals,callbacks:m.callbacks,longTasks:m.longTasks,maxPending:m.maxPending,level:m.level,state:m.state,audit:m.audit,records:m.directorRecords,directorFPS:Number(debugText.match(/FPS ([0-9.]+)/)?.[1]??NaN),particleVisibility:getComputedStyle(el.querySelector('canvas')).visibility};});
    segments.push({...seg,metrics:summarize(seg,1000)});
    if(pulse&&!pulseTriggered&&Date.now()-started>=30000){await page.getByRole('button',{name:'触发共振',includeHidden:true}).evaluate(e=>e.click());pulseTriggered=true;}
  }
  const after=await cdp.send('Performance.getMetrics');const b=Object.fromEntries(before.metrics.map(x=>[x.name,x.value])),a=Object.fromEntries(after.metrics.map(x=>[x.name,x.value]));
  const raw={intervals:segments.flatMap(s=>s.intervals),callbacks:segments.flatMap(s=>s.callbacks),longTasks:segments.flatMap(s=>s.longTasks),maxPending:Math.max(...segments.map(s=>s.maxPending)),state:segments.at(-1).state,level:segments.at(-1).level};
  return {actualMs:Date.now()-started,metrics:summarize(raw,Date.now()-started),cpuSeconds:Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(k=>[k,a[k]-b[k]])),segments,writes:mutations?await page.evaluate(()=>window.p14Writes):null};
}
try {
  for(const url of [base,fixture]){let occupied=false;try{await fetch(url);occupied=true;}catch{}if(occupied)throw Error(`Refuse occupied ${url}`);}
  server(['e2e/nexus-fixture-server.mjs']); await ready(fixture);
  server(['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3048'],{SCREEN_PLATFORM_URL:fixture,SCREEN_PUBLIC_ID:'fixture-only',TZ:'Asia/Shanghai'}); await ready(`${base}/screen/sales?source=mock`);
  const phase=process.env.P14_PHASE??'all';
  browser=await chromium.launch({headless:!['hardware','cadence'].includes(phase)});const bcdp=await browser.newBrowserCDPSession();
  const gpu=await bcdp.send('SystemInfo.getInfo');let command;
  try {command=await bcdp.send('Browser.getBrowserCommandLine');}
  catch(e){command={protocolError:e.message};try{const processes=await bcdp.send('SystemInfo.getProcessInfo');const pid=processes.processInfo.find(p=>p.type==='browser')?.id;if(pid)command.processCommandLine=execFileSync('ps',['-ww','-p',String(pid),'-o','args='],{encoding:'utf8'}).trim();}catch(err){command.fallbackError=err.message;}}
  const platform={at:new Date().toISOString(),browser:browser.version(),node:process.version,os:os.release(),arch:os.arch(),cpu:os.cpus()[0].model,cores:os.cpus().length,memory:os.totalmem(),gpu,command};
  try {const displays=JSON.parse(execFileSync('system_profiler',['SPDisplaysDataType','-json'],{encoding:'utf8'}));platform.displays=displays.SPDisplaysDataType.map(d=>({name:d.sppci_model,cores:d.sppci_cores,metal:d.spdisplays_metal,gpuType:d.spdisplays_device_type,displays:d.spdisplays_ndrvs?.map(s=>({name:s._name,resolution:s.spdisplays_resolution,pixels:s.spdisplays_pixels,refreshRate:s.spdisplays_refresh_rate}))}));}catch(e){platform.displayError=e.message;}
  save(phase==='hardware'?'environment/browser-gpu-headed.json':phase==='cadence'?'environment/browser-gpu-cadence.json':'environment/browser-gpu.json',platform);
  await fetch(`${fixture}/control?reset=1`);const payload=await(await fetch(fixture)).json();save(['hardware','cadence'].includes(phase)?`environment/fixture-${phase}.json`:'environment/fixture.json',{sha256:createHash('sha256').update(JSON.stringify({...payload,generatedAt:'NORMALIZED'})).digest('hex'),payload});
  if(phase==='all'||phase==='trace'||phase==='trace-repeat')for(const width of (phase==='trace-repeat'?[3840]:[1920,3840]))for(const engine of ['legacy','gsap']){
    console.log('TRACE',engine,width);const {ctx,page,cdp,errors}=await context(engine,width);
    const layers=[];cdp.on('LayerTree.layerTreeDidChange',e=>layers.push({at:Date.now(),layers:e.layers?.map(l=>({id:l.layerId,backendNodeId:l.backendNodeId,width:l.width,height:l.height,paintCount:l.paintCount,drawsContent:l.drawsContent}))}));await cdp.send('LayerTree.enable');
    await page.evaluate(()=>{const el=document.querySelector('#screen-stage');window.p14Levels=[];new MutationObserver(()=>{const level=el.dataset.motionLevel;const last=window.p14Levels.at(-1);if(last?.level!==level){const record={time:performance.now(),level};window.p14Levels.push(record);performance.mark('P14:level:'+level);}}).observe(el,{attributes:true,attributeFilter:['data-motion-level']});performance.mark('P14:sample-start');});
    const result=await trace(cdp,`${engine}-${width}`,async()=>{await page.evaluate(()=>performance.mark('P14:sample-start'));return measure(page,cdp,width===3840?18000:12000);});
    result.levelMarks=await page.evaluate(()=>window.p14Levels);result.layers=layers;result.errors=errors;
    const backendIds=[...new Set(layers.flatMap(x=>x.layers??[]).map(x=>x.backendNodeId).filter(Boolean))];
    result.layerNodes=[];
    for(const backendNodeId of backendIds){try{result.layerNodes.push(await cdp.send('DOM.describeNode',{backendNodeId}));}catch{}}
    result.compositingReasons=[];
    for(const layer of layers.at(-1)?.layers??[]){try{result.compositingReasons.push({layerId:layer.id,...await cdp.send('LayerTree.compositingReasons',{layerId:layer.id})});}catch{}}
    result.domDocument=await cdp.send('DOM.getDocument',{depth:-1});
    result.dom=await page.evaluate(()=>({hidden:document.hidden,dpr:devicePixelRatio,canvas:[...document.querySelectorAll('canvas')].map(c=>({class:c.className,width:c.width,height:c.height,rect:c.getBoundingClientRect().toJSON()})),svgPaths:document.querySelectorAll('svg path').length,svgs:document.querySelectorAll('svg').length,filters:[...document.querySelectorAll('#screen-stage *')].filter(e=>getComputedStyle(e).filter!=='none').map(e=>({tag:e.tagName,class:e.getAttribute('class'),filter:getComputedStyle(e).filter})),stage:document.querySelector('#screen-stage').getBoundingClientRect().toJSON()}));
    save(`${engine}-${width}-trace-metrics.json`,result);await ctx.close();
  }
  // Controlled browser-only diagnostic ablations: never persisted as product changes or proposed visual cuts.
  if(phase==='all'||phase==='ablation'){
    const cases=[['control',''],['canvas-hidden','.nexus-particles{visibility:hidden!important}'],['map-hidden','.nexus-map-frame{visibility:hidden!important}'],['mask-off','.nexus-map-frame{-webkit-mask-image:none!important;mask-image:none!important}'],['filters-off','#screen-stage *{filter:none!important}']];
    const results=[];
    for(const round of [1,2])for(const [name,css] of (round===1?cases:[...cases].reverse())){
      console.log('ABLATION',round,name);const {ctx,page,cdp,errors}=await context('legacy',3840);
      await page.getByRole('button',{name:'恢复自动档',includeHidden:true}).evaluate(e=>e.click());
      if(css)await page.addStyleTag({content:css});
      const result=await measure(page,cdp,24000);results.push({round,name,css,...result,errors});save('ablation.json',results);await ctx.close();
    }
    console.log('MUTATION_COUNTS');const {ctx,page,cdp}=await context('legacy',3840);save('mutation-counts.json',await measure(page,cdp,6000,true));await ctx.close();
  }
  if(phase==='all'||phase==='memory'){
    const all=[];
    for(const cohort of [{label:'clean',metrics:false,navigate:true},{label:'instrumented',metrics:true,navigate:true},{label:'dwell',metrics:false,navigate:false}]){
      const {label,metrics,navigate}=cohort;
      console.log('MEMORY',label);const {ctx,page,cdp,errors}=await context('gsap',1920,metrics);
      const rows=[];
      async function sample(cycle){if(metrics)await page.evaluate(()=>window.pocMetrics(true));await cdp.send('HeapProfiler.collectGarbage');await cdp.send('HeapProfiler.collectGarbage');const row={cycle,at:Date.now(),...await cdp.send('Runtime.getHeapUsage'),...await cdp.send('Memory.getDOMCounters'),dom:await page.evaluate(()=>({engine:document.querySelector('#screen-stage')?.dataset.motionEngine,audit:document.querySelector('[data-gsap-audit]')?.textContent,stageCount:document.querySelectorAll('#screen-stage').length,canvases:document.querySelectorAll('canvas').length,debugs:document.querySelectorAll('.nexus-motion-debug').length}))};rows.push(row);save(`memory-${label}.json`,{rows,errors});return row;}
      await sample(0);
      for(let n=1;n<=70;n++){
        const next=n%2?'legacy':'gsap';
        const link=page.getByRole('link',{name:`切换 ${next==='gsap'?'GSAP':'Legacy'}`,exact:true,includeHidden:true});
        if(navigate){await link.evaluate(e=>e.click());await page.locator(`#screen-stage[data-motion-engine="${next}"]`).waitFor();}
        else await link.evaluate(e=>e.getAttribute('href'));
        await page.waitForTimeout(2500);await sample(n);
        if(label==='clean'&&[10,30,50,70].includes(n)){console.log('SNAPSHOT',n);await snapshot(cdp,`memory-clean-${n}`);}
        if(n%10===0)console.log('NAV',label,n,rows.at(-1).usedSize);
      }
      // Settled same-route dwell distinguishes delayed work from accumulated route retention.
      await page.waitForTimeout(15000);await sample(70.1);
      if(label==='clean')await snapshot(cdp,'memory-clean-settled');
      if(label==='dwell')await snapshot(cdp,'memory-dwell-settled');
      all.push({label,rows,errors});save('memory.json',all);await ctx.close();
    }
  }
  if(phase==='hardware'){
    const results=[];
    for(const width of [1920,3840])for(const engine of ['legacy','gsap']){
      console.log('HEADED',engine,width);const {ctx,page,cdp,errors}=await context(engine,width);
      const result=await measure(page,cdp,60000,false,true);result.engine=engine;result.width=width;result.errors=errors;
      result.viewport=await page.evaluate(()=>({innerWidth,innerHeight,outerWidth,outerHeight,dpr:devicePixelRatio,hidden:document.hidden,screen:{width:screen.width,height:screen.height,availWidth:screen.availWidth,availHeight:screen.availHeight},stage:document.querySelector('#screen-stage').getBoundingClientRect().toJSON()}));
      results.push(result);save('headed-matrix.json',{platform,results});
      if(width===3840){const traced=await trace(cdp,`headed-${engine}-${width}`,async()=>{await page.evaluate(()=>performance.mark('P14:sample-start'));return measure(page,cdp,12000);});save(`headed-${engine}-${width}-trace-metrics.json`,traced);}
      await ctx.close();
    }
  }
  if(phase==='cadence'){
    const results=[];
    for(const width of [1920,3840])for(const engine of ['legacy','gsap']){
      console.log('CADENCE',engine,width);const {ctx,page,cdp,errors}=await context(engine,width);
      results.push({engine,width,...await measure(page,cdp,12000),errors});save('cadence.json',{platform,results});await ctx.close();
    }
  }
} finally {await browser?.close();for(const p of children)p.kill('SIGTERM');writeFileSync(`${dir}/${process.env.P14_PHASE??'all'}-servers.log`,serverLogs.join(''));}
