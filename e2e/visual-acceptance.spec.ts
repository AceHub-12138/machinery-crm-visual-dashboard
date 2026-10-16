import {test,expect,type Page} from "@playwright/test";
import {readFileSync} from "node:fs";
import {mkdir} from "node:fs/promises";
import {startVoiceHub,type VoiceHubServer} from "../services/voice-orchestrator/src/ws/ws-server";
import {buildIntentAnswer} from "../src/lib/voice/intent-answers";
import {validatePublicPayload} from "../src/lib/voice/public-payload";
import {displaySpoken} from "../src/lib/voice/card-presentation";
import {PROTECTED_WORDS} from "../src/lib/text-layout";
import type {AnswerCardData} from "../src/lib/voice/session-machine";
import {auditText,auditPanels} from "./layout-audit";
const fixture=JSON.parse(readFileSync(new URL("../services/voice-orchestrator/fixtures/public-sales-screen.json",import.meta.url),"utf8"));
let hub:VoiceHubServer;
test.beforeAll(async()=>{hub=await startVoiceHub({host:"127.0.0.1",port:0,onMessage:(conn,raw)=>{if(JSON.parse(raw).type==="console.hello")conn.role="screen";}});await mkdir("test-results/visual-acceptance",{recursive:true});});
test.afterAll(async()=>{await hub.close();});
async function open(page:Page){await page.goto(`/screen/sales?voiceLive=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);await expect.poll(()=>hub.counts().screens).toBe(1);await page.mouse.click(40,40);hub.broadcast({type:"session.start",at:Date.now(),sessionId:"visual-check"});hub.broadcast({type:"state.change",at:Date.now(),from:"waking",to:"listening",turn:0});await expect(page.locator(".overlay-root")).toHaveAttribute("data-phase","on");}
async function show(page:Page,card:AnswerCardData){hub.broadcast({type:"state.change",at:Date.now(),from:"listening",to:"thinking",turn:0});hub.broadcast({type:"answer.delta",at:Date.now(),seq:0,text:card.spoken,full:true,card});hub.broadcast({type:"state.change",at:Date.now(),from:"thinking",to:"answering",turn:0});await expect(page.locator(".overlay-card-body")).toHaveAttribute("data-spoken-complete","true");await expect(page.locator(".overlay-card-title")).toHaveAttribute("data-measured","true");await expect(page.locator(".overlay-card-spoken")).toHaveAttribute("data-measured","true");await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));}
test("unsupported answer uses a warning and one service title",async({page})=>{
  await open(page);const card=buildIntentAnswer("unanswerable",validatePublicPayload(fixture)).card;await show(page,card);
  await expect(page.locator(".overlay-status")).toHaveAttribute("data-tone","warn");await expect(page.locator(".overlay-en")).toHaveText("Unsupported");await expect(page.locator(".overlay-status")).not.toContainText("播报中");
  await expect(page.locator(".overlay-card-title")).toHaveText("小川");await expect(page.locator(".overlay-card-subtitle")).toHaveCount(0);
  expect((await page.locator(".overlay-card-header").innerText()).match(/小川/gu)).toHaveLength(1);
  await expect(page.locator(".overlay-card-spoken")).toHaveText(displaySpoken(card.spoken));
  await page.screenshot({path:"test-results/visual-acceptance/unsupported.png"});
});
for(const reason of ["no-data","offline"] as const)test(`large next-step guide ${reason}`,async({page})=>{
  await page.setViewportSize({width:1280,height:720});await open(page);
  hub.broadcast({type:"state.change",at:Date.now(),from:"listening",to:"thinking",turn:0,reason});
  const guide=page.locator(".overlay-next-step");await expect(guide).toHaveText(reason==="no-data" ? "当前暂无可展示的数据，请稍后重试" : "网络连接中断，请检查网络后重试");
  expect(await guide.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(30);expect(await auditText(page,".overlay-root")).toEqual([]);
  await page.screenshot({path:`test-results/visual-acceptance/guide-${reason}.png`});
});
async function collectPages(page:Page,title:boolean,full:string){
  const element=page.locator(title ? ".overlay-card-title" : ".overlay-card-spoken");
  const counter=page.locator(title ? ".overlay-card-title" : ".overlay-spoken-section");
  const pages=Number(await counter.getAttribute(title ? "data-title-pages" : "data-pages"));expect(pages).toBeGreaterThan(1);
  let reconstructed="",offset=0;
  for(let i=0;i<pages;i++){
    const fragment=await element.innerText();expect(fragment).not.toContain("…");reconstructed+=fragment;offset+=fragment.length;
    for(const word of PROTECTED_WORDS){let at=full.indexOf(word);while(at>=0){expect(offset>at && offset<at+word.length,`${word} must not split between pages`).toBe(false);at=full.indexOf(word,at+word.length);}}
    expect(await auditText(page,".overlay-card")).toEqual([]);
    await page.getByRole("button",{name:title ? "下一页标题" : "下一页播报"}).click();
  }
  expect(reconstructed).toBe(full);
}
for(const viewport of [{width:1280,height:720},{width:1920,height:1080},{width:3840,height:2160}])test(`intact words and full two-line titles ${viewport.width}`,async({page})=>{
  await page.setViewportSize(viewport);await open(page);
  const title="区域交付与距离目标的进度汇总，".repeat(10);const spoken="各区域交付正在推进，距离目标仍有计划内的差额。请结合区域台账查看距离与设备型号，数字不作推测。".repeat(7);
  await show(page,{kind:"brief",title,spoken,lines:[]});
  expect(await page.locator(".overlay-card-title").evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(20);
  expect(await page.locator(".overlay-card-title").evaluate(el=>el.scrollHeight)).toBeLessThanOrEqual(45);
  expect(await page.locator(".overlay-card-title").evaluate(el=>el.scrollHeight)).toBeGreaterThanOrEqual(42);
  const lineCount=await page.locator(".overlay-card-title").evaluate(el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const rows:number[]=[];for(let n=walker.nextNode();n;n=walker.nextNode()){const range=document.createRange();range.selectNodeContents(n);for(const rect of range.getClientRects())if(rect.width>0 && !rows.some(y=>Math.abs(y-rect.top)<1))rows.push(rect.top);}return rows.length;});expect(lineCount).toBe(2);
  const wordBreaks=await page.locator(".overlay-card-title, .overlay-card-spoken").evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).wordBreak));expect(wordBreaks).toEqual(["normal","normal"]);
  await collectPages(page,true,title);await collectPages(page,false,displaySpoken(spoken));expect(await auditPanels(page)).toEqual([]);
  await page.screenshot({path:`test-results/visual-acceptance/long-title-${viewport.width}.png`});
});
test("word audit detects an unwrapped renderer splitting 区域 and 距离",async({page})=>{
  await page.goto("/screen/sales");await page.evaluate(()=>{const probe=document.createElement("p");probe.id="word-probe";probe.dataset.wordAudit="";probe.textContent="区域距离";probe.style.cssText="position:fixed;top:20px;left:20px;width:25px;font-size:24px;line-height:1.5;word-break:break-all;overflow-wrap:anywhere;text-wrap:wrap";document.body.append(probe);});
  for(const lineHeight of [1,1.5]) {
    await page.locator("#word-probe").evaluate((el,height)=>{(el as HTMLElement).style.lineHeight=String(height);},lineHeight);
    const findings=await auditText(page,"#word-probe");for(const word of ["区域","距离"])expect(findings.some(f=>f.kind==="word-split" && f.text===word)).toBe(true);
  }
});
for(const empty of [false,true])test(`public contract tail ${empty ? "empty" : "masked"}`,async({page,request},testInfo)=>{
  const {setNexusPayload,settle}=await import("./nexus-test-data");
  const {auditText:auditNexusText}=await import("./nexus-layout-audit");
  const p=validatePublicPayload(structuredClone(fixture));
  for(const rows of [p.delivery.reminders.today,p.delivery.reminders.sevenDays,p.delivery.reminders.overdue,p.delivery.milestones])for(const row of rows)row.contractNumber=empty ? null : "****0123";
  try {
    // NEXUS renders summary alerts, not the retired ReminderRail list. Inject at
    // the local public fixture server used by SSR and the refresh Server Action.
    await setNexusPayload(request,p);await page.goto("/screen/sales");await settle(page);
    const screen=page.locator("#screen-stage"),alerts=screen.locator(".nexus-alert-grid > div");
    await expect(alerts).toHaveCount(3);
    for(const [i,count] of [p.delivery.summary.overdueDue,p.delivery.summary.todayDue,p.delivery.summary.sevenDayDue].entries())await expect(alerts.nth(i).locator("strong")).toHaveText(`${count} 单`);
    await expect(screen.locator("[data-contract-tail]")).toHaveCount(0);
    for(const text of ["尾号","0123","****0123"])await expect(screen).not.toContainText(text);
    expect(await auditNexusText(page)).toEqual([]);
    await page.screenshot({path:testInfo.outputPath("nexus-contract-privacy.png")});

    await open(page);const card=buildIntentAnswer("upcoming_shipments",p).card;await show(page,card);
    const rows=page.locator(".overlay-shipment-row"),tails=rows.locator("[data-contract-tail]");
    expect(card.kind).toBe("customers-shipments");
    if(card.kind!=="customers-shipments")throw new Error("Expected shipment card");
    expect(card.rows.length).toBeGreaterThan(0);
    await expect(rows).toHaveCount(card.rows.length);
    await expect(page.locator(".overlay-card")).not.toContainText("****0123");
    if(empty){await expect(rows.locator("small")).toHaveCount(0);await expect(tails).toHaveCount(0);await expect(page.locator(".overlay-card")).not.toContainText("尾号");}
    else{
      // Explicit count prevents an empty locator from vacuously passing privacy checks.
      await expect(tails).toHaveCount(card.rows.length);
      for(const tail of await tails.all())await expect(tail).toHaveText("尾号 0123");
      await page.evaluate(()=>document.fonts.load('600 20px "Rajdhani"'));
      const metrics=await rows.locator(".contract-tail-digits").first().evaluate(el=>{const css=getComputedStyle(el);const row=el.closest(".overlay-shipment-row")!;const widths=[...el.querySelectorAll("span")].map(digit=>digit.getBoundingClientRect().width);return {family:css.fontFamily,size:parseFloat(css.fontSize),rowSize:parseFloat(getComputedStyle(row).fontSize),tabular:css.fontVariantNumeric,widths,ellipsis:css.textOverflow};});
      expect(metrics.widths).toHaveLength(4);expect(metrics.family).toContain("Rajdhani");expect(metrics.size).toBe(metrics.rowSize);expect(metrics.tabular).toContain("tabular-nums");expect(metrics.ellipsis).not.toBe("ellipsis");expect(Math.max(...metrics.widths)-Math.min(...metrics.widths)).toBeLessThan(.1);
    }
    expect(await auditText(page,".overlay-card")).toEqual([]);
    await page.screenshot({path:testInfo.outputPath("voice-contract-privacy.png")});
  } finally {await request.get("http://127.0.0.1:3199/control?reset=1");}
});
for (const viewport of [{width:1280,height:720},{width:1792,height:832},{width:1920,height:1080},{width:3840,height:2160}]) test(`map labels remain clear of HUD ${viewport.width}`, async ({ page, request }) => {
  const { nexusPayload, setNexusPayload, screenUrl, settle } = await import('./nexus-test-data');
  const { auditText: auditNexusText } = await import('./nexus-layout-audit');
  await page.setViewportSize(viewport); await setNexusPayload(request, nexusPayload()); await page.goto(screenUrl(viewport.width)); await settle(page);
  const result = await page.evaluate(() => {
    const labels=[...document.querySelectorAll('.nexus-city-label, .nexus-province-label, .nexus-factory-label, .nexus-local-units')];
    const hud=document.querySelector('.nexus-islands')!.getBoundingClientRect(), failures:string[]=[];
    const overlap=(a:DOMRect,b:DOMRect)=>a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
    labels.forEach((label,i)=>{const box=label.getBoundingClientRect(); if(overlap(box,hud))failures.push('hud');for(const other of labels.slice(i+1))if(overlap(box,other.getBoundingClientRect()))failures.push('label');});
    return { failures, cityCount:document.querySelectorAll('.nexus-city-label').length, factory:document.querySelector('.nexus-factory-label')?.textContent, local:document.querySelector('.nexus-local-units')?.textContent };
  });
  expect(result.failures).toEqual([]); expect(result.cityCount).toBeGreaterThan(0); expect(result.factory).toBe('山东滕州'); expect(result.local).toBe('本地 9 台');
  expect(await auditNexusText(page)).toEqual([]);
});
test("negative primary money has one large pending readout", async ({ page, request }) => {
  const { nexusPayload, setNexusPayload } = await import('./nexus-test-data');
  const { auditText: auditNexusText } = await import('./nexus-layout-audit');
  try {
  const p=nexusPayload(); p.kpis.periodContractAmount='-1234567'; await setNexusPayload(request,p); await page.goto('/screen/sales'); await page.evaluate(()=>document.fonts.ready);
  const primary=page.locator('.nexus-money-hero'); await expect(primary).toHaveText('数据待核对');
  expect((await page.locator('.nexus-contract').innerText()).match(/数据待核对/gu)).toHaveLength(1);
  expect(await primary.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(24);
  expect(await auditNexusText(page)).toEqual([]);
  } finally { await request.get('http://127.0.0.1:3199/control?reset=1'); }
});
test("SVG note has an effective 20px design font and a tiny SVG font fails audit",async({page})=>{
  await open(page);await show(page,buildIntentAnswer("region_shipments",validatePublicPayload(fixture)).card);
  const note=page.locator("[data-readable-svg]");await expect(note).toHaveAttribute("data-svg-measured","true");await expect(note).toHaveText("仅标注部分地点");expect(await auditText(page,".overlay-card")).toEqual([]);
  await page.addStyleTag({content:"[data-readable-svg] {font-size:1px!important}"});
  expect((await auditText(page,".overlay-card")).some(f=>f.kind==="font" && f.text==="仅标注部分地点")).toBe(true);
});
