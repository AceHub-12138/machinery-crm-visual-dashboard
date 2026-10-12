import { test, expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { startVoiceHub, type VoiceHubServer } from "../services/voice-orchestrator/src/ws/ws-server";
import { isValidAnswerCard } from "../src/lib/voice/protocol";
import type { AnswerCardData } from "../src/lib/voice/session-machine";
import { displaySpoken } from "../src/lib/voice/card-presentation";
import { CARD_INTENTS, task12Card } from "./task12-fixtures";
let hub: VoiceHubServer;
const evidence: unknown[]=[];
const output = join(process.cwd(),"docs/design/answer-card-mockups");
test.beforeAll(async () => {
  hub = await startVoiceHub({host:"127.0.0.1",port:0,onMessage:(conn,raw)=>{const ev=JSON.parse(raw); if(ev.type==="console.hello")conn.role="screen";}});
  await mkdir(output,{recursive:true});
});
test.afterAll(async()=>{await hub?.close(); await writeFile(join(process.cwd(),"docs/voice-8c-task12-browser-calibration.json"),JSON.stringify(evidence,null,2)+"\n");});
async function open(page: Page) {
  await page.goto(`/screen/sales?voiceLive=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);
  await expect.poll(()=>hub.counts().screens).toBe(1);
  await page.mouse.click(40,40);
  hub.broadcast({type:"session.start",at:Date.now(),sessionId:"task12-layout",screenId:"00000000-0000-0000-0000-000000000001"});
  hub.broadcast({type:"state.change",at:Date.now(),from:"waking",to:"listening",turn:0});
}
async function show(page:Page, card:AnswerCardData) {
  expect(isValidAnswerCard(card)).toBe(true);
  hub.broadcast({type:"state.change",at:Date.now(),from:"listening",to:"thinking",turn:0,question:"布局验收"});
  hub.broadcast({type:"answer.delta",at:Date.now(),seq:0,text:card.spoken,full:true,card});
  hub.broadcast({type:"state.change",at:Date.now(),from:"thinking",to:"answering",turn:0});
  await expect(page.locator(`[data-card-kind="${card.kind}"] .overlay-card-body`)).toBeVisible();
  await expect.poll(()=>page.locator(".overlay-card-spoken").innerText(),{timeout:12000}).toBe(displaySpoken(card.spoken));
  await page.evaluate(()=>document.fonts.ready);
}
async function bounds(page:Page) {
  return page.locator(".overlay-card").evaluate(el => {
    const rect=el.getBoundingClientRect();
    const spills=Array.from(el.querySelectorAll<HTMLElement>("*"))
      .filter(node=>!node.closest(".sr-only") && !(node instanceof SVGElement) && node.textContent?.trim() && node.childElementCount===0)
      .filter(node=>node.scrollWidth>node.clientWidth+1)
      .map(node=>({class:node.className,text:node.textContent?.slice(0,40),scroll:node.scrollWidth,client:node.clientWidth}));
    const sections=Array.from(el.querySelectorAll<HTMLElement>(".overlay-card-header,.overlay-card-data,.overlay-spoken-section,.overlay-followups")).map(node=>({class:node.className,y:node.getBoundingClientRect().y,bottom:node.getBoundingClientRect().bottom,height:node.getBoundingClientRect().height}));
    const data=el.querySelector(".overlay-card-data")?.getBoundingClientRect();
    const dataSpills=data ? Array.from(el.querySelectorAll<HTMLElement>(".overlay-card-data *"))
      .filter(node=>!node.closest(".sr-only") && !(node instanceof SVGElement) && node.textContent?.trim() && node.childElementCount===0)
      .filter(node=>{const r=node.getBoundingClientRect();return r.y<data.y-1 || r.bottom>data.bottom+1;})
      .map(node=>({class:node.className,text:node.textContent?.slice(0,40)})) : [];
    return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,bottom:rect.bottom,spills,dataSpills,sections};
  });
}
for (const viewport of [{width:1920,height:1080},{width:1280,height:720}]) {
  for (const variant of ["normal","long"] as const) {
    for (const intent of CARD_INTENTS) test(`${viewport.width} ${variant} ${intent}`,async({page})=>{
      await page.setViewportSize(viewport); await open(page);
      const card=task12Card(intent,variant); await show(page,card);
      const measured=await bounds(page); evidence.push({viewport,variant,intent,kind:card.kind,...measured});
      expect(measured.bottom).toBeLessThanOrEqual(1020*viewport.height/1080+1);
      expect(measured.x).toBeGreaterThanOrEqual(0); expect(measured.x+measured.width).toBeLessThanOrEqual(viewport.width+1);
      expect(measured.spills).toEqual([]);
      expect(measured.dataSpills).toEqual([]);
      for(const section of measured.sections) expect(section.bottom).toBeLessThanOrEqual(measured.bottom+1);
      expect(measured.bottom - measured.sections.find(s=>s.class==="overlay-followups")!.bottom).toBeGreaterThanOrEqual((card.kind === "brief" ? 35 : 71)*viewport.height/1080);
      expect(measured.sections.find(s=>s.class==="overlay-spoken-section")!.height).toBeCloseTo(170*viewport.height/1080,0);
      if(card.kind!=="brief")expect(measured.sections.find(s=>s.class==="overlay-card-data")!.height).toBeCloseTo(270*viewport.height/1080,0);
      expect(await page.locator(".overlay-card-body").count()).toBe(1);
      expect(await page.locator(".overlay-card-spoken").count()).toBe(1);
      if(card.kind==="region")expect(await page.locator(".overlay-map-point").count()).toBe(card.mapPoints?.length);
      if(viewport.width===1920 && variant==="normal") await page.screenshot({path:join(output,`实现_${CARD_INTENTS.indexOf(intent)+1}_${card.kind}.png`)});
    });
  }
}
test("zero values, 180% and no duplicate brief body",async({page})=>{
  test.setTimeout(90000);
  await open(page);
  for(const intent of CARD_INTENTS) {
    const card=task12Card(intent,"zero"); await show(page,card); expect((await bounds(page)).spills).toEqual([]);
  }
  for(const intent of ["sales_progress","target_rate"] as const){
    const card=task12Card(intent,"exceeded"); await show(page,card);
    await expect(page.locator(".overlay-card-data")).toContainText("180%");
    expect(await page.locator(".overlay-card-data").innerText()).not.toContain("距目标还差");
  }
  const brief=task12Card("unanswerable","normal"); await show(page,brief);
  await expect(page.locator(".overlay-card-spoken")).toHaveText(displaySpoken(brief.spoken));
  expect((await page.locator(".overlay-card-body").innerText()).split(displaySpoken(brief.spoken)).length-1).toBe(1);
});
test("15 shipments slide at 4s with five slots and three dots",async({page})=>{
  await open(page); await show(page,task12Card("upcoming_shipments","long"));
  expect(await page.locator(".overlay-shipment-page").count()).toBe(3);
  for(const rows of await page.locator(".overlay-shipment-page").all()) expect(await rows.locator('[role="row"]').count()).toBeLessThanOrEqual(5);
  await expect(page.locator(".overlay-shipments-block")).toHaveAttribute("data-page","2",{timeout:5500});
  await expect(page.locator(".overlay-shipments-block")).toHaveAttribute("data-page","3",{timeout:5500});
});

test("demo automatically completes launch, answer and withdrawal for seven cards",async({page})=>{
  test.setTimeout(90000);
  await page.clock.install();
  await page.goto("/screen/sales?voiceDemo=1&lite=1");
  const kinds=["target-progress","completion-ring","region","customers-shipments","customer-kpi","followup-buckets","collection-split"];
  for(const kind of kinds){
    await page.clock.fastForward(2200); await expect(page.locator('.overlay-en')).toHaveText('Waking');
    await page.clock.fastForward(900); await expect(page.locator('.overlay-en')).toHaveText('Listening');
    await page.clock.fastForward(2800); await expect(page.locator('.overlay-en')).toHaveText('Thinking');
    await page.clock.fastForward(1700); await expect(page.locator('[data-card-kind]')).toHaveAttribute('data-card-kind',kind);
    await page.clock.fastForward(10000); await expect(page.locator('.overlay-en')).toHaveText('Awaiting');
    await page.clock.fastForward(17200); await expect(page.locator('.overlay-en')).toHaveText('Closing');
    await page.clock.fastForward(800); await expect(page.locator('[data-card-kind]')).toHaveCount(0);
    await page.clock.fastForward(520); await expect(page.locator('.overlay-root')).toHaveCount(0);
  }
});

test("overlay RAF callback CPU increment stays within 8ms at both resolutions",async({page})=>{
  test.setTimeout(60000);
  for(const viewport of [{width:1920,height:1080},{width:1280,height:720}]) {
    await page.setViewportSize(viewport);
    await page.addInitScript(()=>{
      const native=window.requestAnimationFrame.bind(window);
      const frames=new Map<number,number>();
      Object.assign(window,{task12Frames:frames});
      window.requestAnimationFrame=(callback)=>native(now=>{const start=performance.now(); try{callback(now);} finally {frames.set(now,(frames.get(now)??0)+performance.now()-start);}});
    });
    await page.goto(`/screen/sales?voiceLive=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);
    await expect.poll(()=>hub.counts().screens).toBe(1);
    const sample=async()=>{
      await page.evaluate(()=>((window as unknown as {task12Frames:Map<number,number>}).task12Frames).clear());
      await page.waitForTimeout(2500);
      return page.evaluate(()=>[...(window as unknown as {task12Frames:Map<number,number>}).task12Frames.values()]);
    };
    const baseline=await sample();
    await page.mouse.click(40,40);
    hub.broadcast({type:"session.start",at:Date.now(),sessionId:"task12-perf",screenId:"00000000-0000-0000-0000-000000000001"});
    hub.broadcast({type:"state.change",at:Date.now(),from:"waking",to:"listening",turn:0});
    await show(page,task12Card("region_shipments","normal"));
    const active=await sample();
    const p95=(values:number[])=>values.sort((a,b)=>a-b)[Math.floor(values.length*.95)]??0;
    const record={viewport,metric:"summed JS + Canvas CPU cost of RAF callbacks per timestamp; excludes compositor/GPU",baselineFrames:baseline.length,overlayFrames:active.length,baselineP95:p95(baseline),overlayP95:p95(active),incrementP95:Math.max(0,p95(active)-p95(baseline))};
    evidence.push({performance:record}); expect(active.length).toBeGreaterThan(30);expect(record.incrementP95).toBeLessThanOrEqual(8);
  }
});
