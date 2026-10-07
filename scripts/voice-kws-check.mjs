/** Verify exact deployed browser KWS using local PCM16 recordings; no speech/GPU service. */
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
const dir=process.env.VOICE_KWS_TEST_DIR;assert(dir,"Local fixture directory required");
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  await page.goto(process.env.VOICE_TEST_PAGE_URL??"http://127.0.0.1:3015/screen/sales");
  await page.evaluate(()=>{window.kwsTest={ready:false,hits:[]};window.kwsTest.worker=new Worker("/voice/kws-worker.js");window.kwsTest.worker.onmessage=({data})=>{if(data.type==="ready")window.kwsTest.ready=true;window.kwsTest.hits.push(data);};window.kwsTest.worker.postMessage({type:"init",kwsEnergy:.01,kwsThreshold:.25,kwsScore:1,wakePhrase:"你好，小川"});});
  await page.waitForFunction(()=>window.kwsTest.ready,undefined,{timeout:30000});
  const rows=[];
  for(const [name,count] of [["你好小川",20],["大川机床",10],["小川",10],["你好",10],["小王",10],["你好大川",10]]) {
    for(let rep=0;rep<count;rep++){
      const pcm=await readFile(join(dir,name+".pcm"));const values=Array.from(new Int16Array(pcm.buffer.slice(pcm.byteOffset,pcm.byteOffset+pcm.length)),v=>v/32768);
      const hits=await page.evaluate(async samples=>{const m=window.kwsTest;const epoch=Math.random();m.hits=[];m.worker.postMessage({type:"reset",epoch});const padded=new Float32Array(samples.length+16000);padded.set(samples);for(let i=0;i<padded.length;i+=512){const frame=padded.slice(i,i+512);m.worker.postMessage({type:"audio",samples:frame,epoch},[frame.buffer]);}m.worker.postMessage({type:"flush",epoch});await new Promise((resolve,reject)=>{const end=Date.now()+10000;const tick=()=>{if(m.hits.some(h=>h.type==="flushed"&&h.epoch===epoch))resolve();else if(Date.now()>end)reject(new Error("KWS decode timeout"));else setTimeout(tick,10);};tick();});return m.hits.filter(v=>v.type==="keyword"&&v.epoch===epoch);},values);
      rows.push({phrase:name,rep:rep+1,hits:hits.map(h=>h.keyword)});
    }
    console.log(name,rows.filter(r=>r.phrase===name&&r.hits.length).length,"/",count);
  }
  await writeFile("docs/voice-8c-task7-kws-calibration.json",JSON.stringify({scope:"single macOS synthesized near-field phrase repeated deterministically; no human/exhibit/noise-hour evidence",errors,rows},null,2));
}finally{await browser.close();}
