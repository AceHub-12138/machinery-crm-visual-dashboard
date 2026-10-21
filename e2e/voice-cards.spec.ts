import { test, expect, type Page } from "./xiaochuan-test";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { startVoiceHub, type VoiceHubServer } from "../services/voice-orchestrator/src/ws/ws-server";
import { isValidAnswerCard } from "../src/lib/voice/protocol";
import type { AnswerCardData } from "../src/lib/voice/session-machine";
import { displaySpoken } from "../src/lib/voice/card-presentation";
import { auditText, auditPanels } from "./layout-audit";
import { LONG_ANSWER } from "./fixtures/long-strings";
import { CARD_INTENTS, task12Card } from "./task12-fixtures";
let hub: VoiceHubServer;
const evidence: unknown[]=[];
const output = join(process.cwd(),"test-results/design-polish");
test.beforeAll(async () => {
  hub = await startVoiceHub({host:"127.0.0.1",port:0,onMessage:(conn,raw)=>{const ev=JSON.parse(raw); if(ev.type==="console.hello")conn.role="screen";}});
  await mkdir(output,{recursive:true});
});
test.afterAll(async()=>{await hub?.close(); await writeFile(join(output,"voice-cards-calibration.json"),JSON.stringify(evidence,null,2)+"\n");});
async function open(page: Page) {
  await page.goto(`/screen/sales?voiceLive=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);
  await expect.poll(()=>hub.counts().screens).toBe(1);
  await page.mouse.click(40,40);
  hub.broadcast({type:"session.start",at:Date.now(),sessionId:"task12-layout",screenId:"00000000-0000-0000-0000-000000000001"});
  hub.broadcast({type:"state.change",at:Date.now(),from:"waking",to:"listening",turn:0});
  await expect(page.locator(".overlay-root")).toHaveAttribute("data-phase","on");
}
async function show(page:Page, card:AnswerCardData) {
  expect(isValidAnswerCard(card)).toBe(true);
  hub.broadcast({type:"state.change",at:Date.now(),from:"listening",to:"thinking",turn:0,question:"布局验收"});
  hub.broadcast({type:"answer.delta",at:Date.now(),seq:0,text:card.spoken,full:true,card});
  hub.broadcast({type:"state.change",at:Date.now(),from:"thinking",to:"answering",turn:0});
  await expect(page.locator(`[data-card-kind="${card.kind}"] .overlay-card-body`)).toBeVisible();
  await expect(page.locator(".overlay-card-body")).toHaveAttribute("data-spoken-complete","true",{timeout:12000});
  await expect(page.locator(".overlay-card-spoken")).toHaveAttribute("data-measured","true");
  const pages=Number(await page.locator(".overlay-spoken-section").getAttribute("data-pages"));
  if(pages===1) await expect(page.locator(".overlay-card-spoken")).toHaveText(displaySpoken(card.spoken));
  else {
    const fragments=new Map<number,string>();
    for(let i=0;i<pages;i++) {
      const index=Number(await page.locator(".overlay-spoken-section").getAttribute("data-page"));
      fragments.set(index,await page.locator(".overlay-card-spoken").innerText());
      await page.getByRole("button",{name:"下一页播报"}).click();
    }
    expect([...fragments].sort((a,b)=>a[0]-b[0]).map(([,text])=>text).join("")).toBe(displaySpoken(card.spoken));
  }
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
for (const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:3840,height:2160}]) {
  for (const variant of ["normal","long"] as const) {
    for (const intent of CARD_INTENTS) test(`${viewport.width} ${variant} ${intent}`,async({page})=>{
      await page.setViewportSize(viewport); await open(page);
      const card=task12Card(intent,variant); await show(page,card);
      const measured=await bounds(page); evidence.push({viewport,variant,intent,kind:card.kind,...measured});
      expect(measured.bottom).toBeLessThanOrEqual(1020*viewport.height/1080+1);
      expect(measured.x).toBeGreaterThanOrEqual(0); expect(measured.x+measured.width).toBeLessThanOrEqual(viewport.width+1);
      expect(measured.spills).toEqual([]);
      expect(measured.dataSpills).toEqual([]);
      expect(await auditText(page, ".overlay-root")).toEqual([]);
      expect(await auditPanels(page)).toEqual([]);
      for(const section of measured.sections) expect(section.bottom).toBeLessThanOrEqual(measured.bottom+1);
      expect(measured.bottom - measured.sections.find(s=>s.class==="overlay-followups")!.bottom).toBeGreaterThanOrEqual((card.kind === "brief" ? 29 : 59)*viewport.height/1080);
      expect(measured.sections.find(s=>s.class==="overlay-spoken-section")!.height).toBeCloseTo(170*viewport.height/1080,0);
      const tier=card.kind==="brief" ? "s" : ["region","customers-shipments"].includes(card.kind) ? "l" : "m";
      await expect(page.locator(".overlay-card")).toHaveAttribute("data-tier",tier);
      const expectedSize={s:{height:360,data:0},m:{height:620,data:202},l:{height:720,data:302}}[tier];
      expect(measured.height).toBeCloseTo(expectedSize.height*viewport.height/1080,0);
      if(card.kind!=="brief")expect(measured.sections.find(s=>s.class==="overlay-card-data")!.height).toBeCloseTo(expectedSize.data*viewport.height/1080,0);
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
  await page.emulateMedia({reducedMotion:"no-preference"});
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

for(const [reason,en,zh] of [["no-data","No Data","暂无数据"],["offline","Offline","网络中断"],["asr-miss","Pardon","没听清"],["interrupted","Interrupted","已打断"]] as const) test(`presentation reason ${reason} preserves lifecycle`,async({page})=>{
  await open(page);
  hub.broadcast({type:"state.change",at:Date.now(),from:"listening",to:"thinking",turn:0,question:"异常标签验收",reason});
  await expect(page.locator(".overlay-en")).toHaveText(en);
  await expect(page.locator(".overlay-status")).toContainText(zh);
  await expect(page.locator(".overlay-status")).toHaveAttribute("data-tone","warn");
  if(reason==="asr-miss") await expect(page.locator(".overlay-partial")).toHaveText("没听清，请再说一次");
  await page.screenshot({path:join(output,`status-${reason}.png`)});
});
test("reduced motion renders whole answer and announces complete sentences",async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await open(page);
  const card=task12Card("unanswerable","normal");
  await show(page,card);
  await expect(page.locator(".overlay-card [aria-live]")).toHaveText(displaySpoken(card.spoken));
  await expect(page.locator(".overlay-card")).not.toHaveAttribute("role","status");
  expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==="running").length)).toBe(0);
  await page.screenshot({path:join(output,"reduced-motion.png")});
});
test("debug hints appear only with debug query",async({page})=>{
  await open(page);
  await expect(page.locator(".overlay-hint")).toHaveCount(0);
  await page.goto(`/screen/sales?voiceDemo=1&debug=1&lite=1`);
  await expect(page.locator(".overlay-hint")).toBeVisible();
});

test("service degradation has its own status",async({page})=>{
  await open(page);
  hub.broadcast({type:"error",at:Date.now(),code:"llm_unavailable",message:"服务暂不可用"});
  hub.broadcast({type:"state.change",at:Date.now(),from:"listening",to:"error-fallback",turn:0});
  await expect(page.locator(".overlay-en")).toHaveText("Degraded");
  await expect(page.locator(".overlay-status")).toContainText("服务降级");
  await page.screenshot({path:join(output,"status-degraded.png")});
});
test("normal motion live region never announces a partial sentence",async({page})=>{
  await page.emulateMedia({reducedMotion:"no-preference"}); await open(page);
  const card={kind:"brief" as const,title:"读屏验收",lines:[],spoken:"第一句完整。第二句话包含更多的内容，需要等待完整出现后才能播报给读屏用户。"};
  hub.broadcast({type:"state.change",at:Date.now(),from:"listening",to:"thinking",turn:0,question:"读屏验收"});
  hub.broadcast({type:"answer.delta",at:Date.now(),seq:0,text:card.spoken,full:true,card});
  hub.broadcast({type:"state.change",at:Date.now(),from:"thinking",to:"answering",turn:0});
  await expect(page.locator(".overlay-card [aria-live]")).toHaveText("第一句完整。");
  await expect(page.locator(".overlay-card [aria-live]")).toHaveText("第二句话包含更多的内容，需要等待完整出现后才能播报给读屏用户。");
});

for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:3840,height:2160}]) test(`300 character answer pages without hidden text ${viewport.width}`,async({page})=>{
  await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:"reduce"});await open(page);
  const text=LONG_ANSWER.slice(0,300);
  const card={kind:"brief" as const,title:"长回答分页验收",spoken:text,lines:[text]};await show(page,card);
  const section=page.locator('.overlay-spoken-section');
  const count=Number(await section.getAttribute('data-pages'));expect(count).toBeGreaterThan(1);
  for(let i=0;i<count;i++) {
    expect(await auditText(page,'.overlay-root')).toEqual([]);
    const starts=await page.locator('.overlay-card-spoken').evaluate(el=>{
      const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const starts=new Map<number,{x:number,char:string}>();
      const origin=el.getBoundingClientRect();const scale=origin.width/(el as HTMLElement).clientWidth;const line=parseFloat(getComputedStyle(el).lineHeight)*scale;
      for(let n=walker.nextNode();n;n=walker.nextNode())for(let j=0;j<(n.textContent?.length??0);j++){
        const char=n.textContent![j];if(!char.trim())continue;const r=document.createRange();r.setStart(n,j);r.setEnd(n,j+1);const box=r.getBoundingClientRect();const row=Math.round((box.top-origin.top)/line);
        if(!starts.has(row)||box.left<starts.get(row)!.x)starts.set(row,{x:box.left,char});
      }
      return [...starts.values()].map(s=>s.char);
    });
    expect(starts.length).toBeLessThanOrEqual(3);expect(starts.every(c=>!/[，。、％！？；：）】》」』]/u.test(c))).toBe(true);
    await page.getByRole('button',{name:'下一页播报'}).click();
  }
});

test("single province 100% and large row counts remain contained",async({page})=>{
  await open(page);
  const base=task12Card("region_shipments","normal");if(base.kind!=="region")throw new Error("region fixture required");
  const card={...base,title:"单省边界验收",summaryText:"单省发运",spoken:"单省发运布局验收。",rows:[{region:"内蒙古自治区",units:999999999,shipments:999999999,sharePercent:100}],other:{regions:0,units:0}};
  await show(page,card);expect((await bounds(page)).spills).toEqual([]);expect(await auditText(page,".overlay-root")).toEqual([]);
  await page.addStyleTag({content:'.overlay-region-row > em { width:50px !important; }'});
  await expect(page.locator(".overlay-region-row > em")).toHaveCSS("width","50px");
  expect((await auditText(page,".overlay-root")).some(f=>f.kind==="overflow" && f.cls==="EM")).toBe(true);
});
