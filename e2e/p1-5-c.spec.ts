import { test, expect } from '@playwright/test';
import {startVoiceHub,type VoiceHubServer} from '../services/voice-orchestrator/src/ws/ws-server';
let hub:VoiceHubServer;
test.beforeAll(async()=>{hub=await startVoiceHub({host:'127.0.0.1',port:0,onMessage:(conn,raw)=>{if(JSON.parse(raw).type==='console.hello')conn.role='screen';}});});
test.afterAll(async()=>{await hub.close();});
const permitted=process.env.NEXUS_QUALITY_PERMISSION==='local-candidate';
test.beforeEach(async ({request})=>{await request.get('http://127.0.0.1:3199/control?reset=1');});
for(const mode of ['candidate','shadow','external','invalid',''] as const) test(`server permission resolves ${mode||'default'}`,async({page})=>{
  await page.goto(`/screen/sales?debug=1&qualityExperiment=${mode}`);
  const expected=permitted&&(mode==='candidate'||mode==='shadow')?mode:'baseline';
  await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-quality-automation',expected);
  await expect(page.locator('#screen-stage')).toHaveAttribute('data-motion-engine','legacy');
  await expect(page.getByRole('button',{name:'强制低档'})).toBeEnabled({enabled:permitted&&expected!=='candidate'});
  if(!permitted) { await page.getByRole('button',{name:'强制低档'}).evaluate(el=>{(el as HTMLButtonElement).disabled=false;(el as HTMLButtonElement).click();}); await expect(page.locator('#screen-stage')).toHaveAttribute('data-motion-level','normal'); }
});
for(const engine of ['legacy','gsap']) for(const mode of ['candidate','shadow']) test(`${engine} ${mode} lifecycle and quality rollback`, async({page})=>{
  test.skip(!permitted,'permission-denied matrix only exercises access checks');
  await page.goto(`/screen/sales?debug=1&motion=${engine}&qualityExperiment=${mode}`);
  const debug=page.locator('.nexus-motion-debug');
  await expect(debug).toHaveAttribute('data-quality-automation',mode); await expect(debug).toHaveAttribute('data-paused','false');
  const audit=async()=>JSON.parse((await page.locator('[data-gsap-audit]').textContent())!);
  for(const kind of ['hidden','voice','reduced']) {
    if(kind==='hidden') await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    if(kind==='voice') await page.getByRole('button',{name:'模拟小川唤醒'}).click();
    if(kind==='reduced') await page.emulateMedia({reducedMotion:'reduce'});
    await expect(debug).toHaveAttribute('data-paused','true');
    if(engine==='gsap') expect((await audit()).activeListeners).toBe(0);
    if(kind==='hidden') await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
    if(kind==='voice') await page.getByRole('button',{name:'模拟小川退出'}).click();
    if(kind==='reduced') await page.emulateMedia({reducedMotion:'no-preference'});
    await expect(debug).toHaveAttribute('data-paused','false');
    if(engine==='gsap') {await expect.poll(async()=>(await audit()).activeListeners).toBe(1);expect((await audit()).liveScenes).toBe(1);}
  }
  await page.getByRole('button',{name:'重新校准刷新率'}).click();
  await expect(debug).toHaveAttribute('data-paused','false');
  await expect.poll(async()=>JSON.parse((await page.locator('[data-quality-log]').textContent())!).some((d:{reason:string})=>d.reason==='reference-recalibrated')).toBe(true);
  const numbers=await page.locator('[data-motion-number]').allTextContents();
  await page.waitForTimeout(1200);expect(await page.locator('[data-motion-number]').allTextContents()).toEqual(numbers);
  await page.goto(`/screen/sales?debug=1&motion=${engine}`);await expect(debug).toHaveAttribute('data-quality-automation','baseline');
});
test('rapid engine and mode switches dispose old GSAP hosts/scenes',async({page})=>{
  test.skip(!permitted);
  await page.goto('/screen/sales?debug=1&motion=gsap&qualityExperiment=candidate');
  for(let i=0;i<8;i++){
    await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-paused','false');
    await page.getByRole('link',{name:'切换 Legacy',exact:true}).click();await expect(page.locator('#screen-stage')).toHaveAttribute('data-motion-engine','legacy');
    await page.getByRole('link',{name:'切换 GSAP',exact:true}).click();await expect(page.locator('#screen-stage')).toHaveAttribute('data-motion-engine','gsap');
  }
  await expect.poll(async()=>JSON.parse((await page.locator('[data-gsap-audit]').textContent())!).activeListeners).toBe(1);
  const a=JSON.parse((await page.locator('[data-gsap-audit]').textContent())!);expect(a.liveScenes).toBe(1);expect(a.rootAnimations).toBe(0);expect(a.liveTimelines).toBe(Number(await page.locator('#screen-stage').getAttribute('data-gsap-timelines')));
  // Same-engine client navigation must recreate its Director when its permission/mode changes.
  await page.getByRole('link',{name:'回到 Baseline',exact:true}).click();
  await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-quality-automation','baseline');
});

for(const engine of ['legacy','gsap'])test(`${engine} Candidate respects actual voice overlay waking, speaking and exit`,async({page})=>{
  test.skip(!permitted);
  await page.goto(`/screen/sales?debug=1&qualityExperiment=candidate&motion=${engine}&voiceLive=1&lite=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);
  const debug=page.locator('.nexus-motion-debug');await expect(debug).toHaveAttribute('data-paused','false');
  await expect.poll(()=>hub.counts().screens).toBe(1);
  await page.getByRole('button',{name:'重启入场'}).click();
  await expect(debug).toHaveAttribute('data-state','INTRO');
  hub.broadcast({type:'session.start',at:Date.now(),sessionId:'p15c-priority'});
  hub.broadcast({type:'state.change',at:Date.now(),from:'waking',to:'listening',turn:0});
  await expect(debug).toHaveAttribute('data-paused','true');
  hub.broadcast({type:'state.change',at:Date.now(),from:'listening',to:'speaking',turn:0});
  await page.waitForTimeout(1200);await expect(debug).toHaveAttribute('data-paused','true');
  await page.keyboard.press('Escape');await expect(debug).toHaveAttribute('data-paused','false');
  await page.getByRole('button',{name:'触发共振'}).click();await expect(debug).toHaveAttribute('data-state','PULSE');
  hub.broadcast({type:'session.start',at:Date.now(),sessionId:'p15c-pulse-priority'});
  hub.broadcast({type:'state.change',at:Date.now(),from:'waking',to:'listening',turn:0});
  await expect(debug).toHaveAttribute('data-paused','true');await expect(debug).not.toHaveAttribute('data-state','PULSE');
  await page.keyboard.press('Escape');await expect(debug).toHaveAttribute('data-paused','false');
});

for(const engine of ['legacy','gsap'])test(`${engine} frequent short voice takeovers do not starve a due full-load probe`,async({page})=>{
  test.skip(!permitted);test.setTimeout(180000);
  await page.clock.install();await page.clock.pauseAt(new Date());
  await page.addInitScript(()=>{
    let minimum=16,last=-Infinity;const native=requestAnimationFrame.bind(window);
    Object.assign(window,{testFrameLoad:(interval:number)=>{minimum=interval;}});
    window.requestAnimationFrame=fn=>native(function attempt(t){if(t-last<minimum-.1){native(attempt);return;}last=t;fn(t);});
  });
  await page.goto(`/screen/sales?debug=1&qualityExperiment=candidate&motion=${engine}`);await page.clock.runFor(1800);
  const debug=page.locator('.nexus-motion-debug');await expect(debug).toHaveAttribute('data-paused','false');
  await page.evaluate(()=>(window as unknown as{testFrameLoad:(ms:number)=>void}).testFrameLoad(50));await page.clock.runFor(15000);
  const decisions=()=>page.locator('[data-quality-log]').textContent().then(t=>JSON.parse(t!) as {state:string;reason:string;failureCount:number}[]);
  expect((await decisions()).some(d=>d.reason==='normal-load-probe-failed')).toBe(true);
  await page.evaluate(()=>(window as unknown as{testFrameLoad:(ms:number)=>void}).testFrameLoad(16));
  for(let i=0;i<6;i++){
    await page.clock.runFor(10000);await page.evaluate(()=>window.dispatchEvent(new CustomEvent('nexus-debug-voice',{detail:true})));await expect(debug).toHaveAttribute('data-paused','true');
    await page.clock.runFor(1000);await page.evaluate(()=>window.dispatchEvent(new CustomEvent('nexus-debug-voice',{detail:false})));await expect(debug).toHaveAttribute('data-paused','false');
  }
  await expect(debug).toHaveAttribute('data-quality-state','normal');expect((await decisions()).some(d=>d.reason==='normal-load-probe-passed')).toBe(true);
});
