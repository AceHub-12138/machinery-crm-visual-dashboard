# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: voice-cards.spec.ts >> overlay RAF callback CPU increment stays within 8ms at both resolutions
- Location: e2e/voice-cards.spec.ts:131:1

# Error details

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 8
Received:    9.600000001490116
```

# Test source

```ts
  57  |     const dataSpills=data ? Array.from(el.querySelectorAll<HTMLElement>(".overlay-card-data *"))
  58  |       .filter(node=>!node.closest(".sr-only") && !(node instanceof SVGElement) && node.textContent?.trim() && node.childElementCount===0)
  59  |       .filter(node=>{const r=node.getBoundingClientRect();return r.y<data.y-1 || r.bottom>data.bottom+1;})
  60  |       .map(node=>({class:node.className,text:node.textContent?.slice(0,40)})) : [];
  61  |     return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,bottom:rect.bottom,spills,dataSpills,sections};
  62  |   });
  63  | }
  64  | for (const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:3840,height:2160}]) {
  65  |   for (const variant of ["normal","long"] as const) {
  66  |     for (const intent of CARD_INTENTS) test(`${viewport.width} ${variant} ${intent}`,async({page})=>{
  67  |       await page.setViewportSize(viewport); await open(page);
  68  |       const card=task12Card(intent,variant); await show(page,card);
  69  |       const measured=await bounds(page); evidence.push({viewport,variant,intent,kind:card.kind,...measured});
  70  |       expect(measured.bottom).toBeLessThanOrEqual(1020*viewport.height/1080+1);
  71  |       expect(measured.x).toBeGreaterThanOrEqual(0); expect(measured.x+measured.width).toBeLessThanOrEqual(viewport.width+1);
  72  |       expect(measured.spills).toEqual([]);
  73  |       expect(measured.dataSpills).toEqual([]);
  74  |       expect(await auditText(page, ".overlay-root")).toEqual([]);
  75  |       expect(await auditPanels(page)).toEqual([]);
  76  |       for(const section of measured.sections) expect(section.bottom).toBeLessThanOrEqual(measured.bottom+1);
  77  |       expect(measured.bottom - measured.sections.find(s=>s.class==="overlay-followups")!.bottom).toBeGreaterThanOrEqual((card.kind === "brief" ? 29 : 59)*viewport.height/1080);
  78  |       expect(measured.sections.find(s=>s.class==="overlay-spoken-section")!.height).toBeCloseTo(170*viewport.height/1080,0);
  79  |       const tier=card.kind==="brief" ? "s" : ["region","customers-shipments"].includes(card.kind) ? "l" : "m";
  80  |       await expect(page.locator(".overlay-card")).toHaveAttribute("data-tier",tier);
  81  |       const expectedSize={s:{height:360,data:0},m:{height:620,data:202},l:{height:720,data:302}}[tier];
  82  |       expect(measured.height).toBeCloseTo(expectedSize.height*viewport.height/1080,0);
  83  |       if(card.kind!=="brief")expect(measured.sections.find(s=>s.class==="overlay-card-data")!.height).toBeCloseTo(expectedSize.data*viewport.height/1080,0);
  84  |       expect(await page.locator(".overlay-card-body").count()).toBe(1);
  85  |       expect(await page.locator(".overlay-card-spoken").count()).toBe(1);
  86  |       if(card.kind==="region")expect(await page.locator(".overlay-map-point").count()).toBe(card.mapPoints?.length);
  87  |       if(viewport.width===1920 && variant==="normal") await page.screenshot({path:join(output,`实现_${CARD_INTENTS.indexOf(intent)+1}_${card.kind}.png`)});
  88  |     });
  89  |   }
  90  | }
  91  | test("zero values, 180% and no duplicate brief body",async({page})=>{
  92  |   test.setTimeout(90000);
  93  |   await open(page);
  94  |   for(const intent of CARD_INTENTS) {
  95  |     const card=task12Card(intent,"zero"); await show(page,card); expect((await bounds(page)).spills).toEqual([]);
  96  |   }
  97  |   for(const intent of ["sales_progress","target_rate"] as const){
  98  |     const card=task12Card(intent,"exceeded"); await show(page,card);
  99  |     await expect(page.locator(".overlay-card-data")).toContainText("180%");
  100 |     expect(await page.locator(".overlay-card-data").innerText()).not.toContain("距目标还差");
  101 |   }
  102 |   const brief=task12Card("unanswerable","normal"); await show(page,brief);
  103 |   await expect(page.locator(".overlay-card-spoken")).toHaveText(displaySpoken(brief.spoken));
  104 |   expect((await page.locator(".overlay-card-body").innerText()).split(displaySpoken(brief.spoken)).length-1).toBe(1);
  105 | });
  106 | test("15 shipments slide at 4s with five slots and three dots",async({page})=>{
  107 |   await open(page); await show(page,task12Card("upcoming_shipments","long"));
  108 |   expect(await page.locator(".overlay-shipment-page").count()).toBe(3);
  109 |   for(const rows of await page.locator(".overlay-shipment-page").all()) expect(await rows.locator('[role="row"]').count()).toBeLessThanOrEqual(5);
  110 |   await expect(page.locator(".overlay-shipments-block")).toHaveAttribute("data-page","2",{timeout:5500});
  111 |   await expect(page.locator(".overlay-shipments-block")).toHaveAttribute("data-page","3",{timeout:5500});
  112 | });
  113 |
  114 | test("demo automatically completes launch, answer and withdrawal for seven cards",async({page})=>{
  115 |   test.setTimeout(90000);
  116 |   await page.clock.install();
  117 |   await page.goto("/screen/sales?voiceDemo=1&lite=1");
  118 |   const kinds=["target-progress","completion-ring","region","customers-shipments","customer-kpi","followup-buckets","collection-split"];
  119 |   for(const kind of kinds){
  120 |     await page.clock.fastForward(2200); await expect(page.locator('.overlay-en')).toHaveText('Waking');
  121 |     await page.clock.fastForward(900); await expect(page.locator('.overlay-en')).toHaveText('Listening');
  122 |     await page.clock.fastForward(2800); await expect(page.locator('.overlay-en')).toHaveText('Thinking');
  123 |     await page.clock.fastForward(1700); await expect(page.locator('[data-card-kind]')).toHaveAttribute('data-card-kind',kind);
  124 |     await page.clock.fastForward(10000); await expect(page.locator('.overlay-en')).toHaveText('Awaiting');
  125 |     await page.clock.fastForward(17200); await expect(page.locator('.overlay-en')).toHaveText('Closing');
  126 |     await page.clock.fastForward(800); await expect(page.locator('[data-card-kind]')).toHaveCount(0);
  127 |     await page.clock.fastForward(520); await expect(page.locator('.overlay-root')).toHaveCount(0);
  128 |   }
  129 | });
  130 |
  131 | test("overlay RAF callback CPU increment stays within 8ms at both resolutions",async({page})=>{
  132 |   await page.emulateMedia({reducedMotion:"no-preference"});
  133 |   test.setTimeout(60000);
  134 |   for(const viewport of [{width:1920,height:1080},{width:1280,height:720}]) {
  135 |     await page.setViewportSize(viewport);
  136 |     await page.addInitScript(()=>{
  137 |       const native=window.requestAnimationFrame.bind(window);
  138 |       const frames=new Map<number,number>();
  139 |       Object.assign(window,{task12Frames:frames});
  140 |       window.requestAnimationFrame=(callback)=>native(now=>{const start=performance.now(); try{callback(now);} finally {frames.set(now,(frames.get(now)??0)+performance.now()-start);}});
  141 |     });
  142 |     await page.goto(`/screen/sales?voiceLive=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);
  143 |     await expect.poll(()=>hub.counts().screens).toBe(1);
  144 |     const sample=async()=>{
  145 |       await page.evaluate(()=>((window as unknown as {task12Frames:Map<number,number>}).task12Frames).clear());
  146 |       await page.waitForTimeout(2500);
  147 |       return page.evaluate(()=>[...(window as unknown as {task12Frames:Map<number,number>}).task12Frames.values()]);
  148 |     };
  149 |     const baseline=await sample();
  150 |     await page.mouse.click(40,40);
  151 |     hub.broadcast({type:"session.start",at:Date.now(),sessionId:"task12-perf",screenId:"00000000-0000-0000-0000-000000000001"});
  152 |     hub.broadcast({type:"state.change",at:Date.now(),from:"waking",to:"listening",turn:0});
  153 |     await show(page,task12Card("region_shipments","normal"));
  154 |     const active=await sample();
  155 |     const p95=(values:number[])=>values.sort((a,b)=>a-b)[Math.floor(values.length*.95)]??0;
  156 |     const record={viewport,metric:"summed JS + Canvas CPU cost of RAF callbacks per timestamp; excludes compositor/GPU",baselineFrames:baseline.length,overlayFrames:active.length,baselineP95:p95(baseline),overlayP95:p95(active),incrementP95:Math.max(0,p95(active)-p95(baseline))};
> 157 |     evidence.push({performance:record}); expect(active.length).toBeGreaterThan(30);expect(record.incrementP95).toBeLessThanOrEqual(8);
      |                                                                                                                ^ Error: expect(received).toBeLessThanOrEqual(expected)
  158 |   }
  159 | });
  160 |
  161 | for(const [reason,en,zh] of [["no-data","No Data","暂无数据"],["offline","Offline","网络中断"],["asr-miss","Pardon","没听清"],["interrupted","Interrupted","已打断"]] as const) test(`presentation reason ${reason} preserves lifecycle`,async({page})=>{
  162 |   await open(page);
  163 |   hub.broadcast({type:"state.change",at:Date.now(),from:"listening",to:"thinking",turn:0,question:"异常标签验收",reason});
  164 |   await expect(page.locator(".overlay-en")).toHaveText(en);
  165 |   await expect(page.locator(".overlay-status")).toContainText(zh);
  166 |   await expect(page.locator(".overlay-status")).toHaveAttribute("data-tone","warn");
  167 |   if(reason==="asr-miss") await expect(page.locator(".overlay-partial")).toHaveText("没听清，请再说一次");
  168 |   await page.screenshot({path:join(output,`status-${reason}.png`)});
  169 | });
  170 | test("reduced motion renders whole answer and announces complete sentences",async({page})=>{
  171 |   await page.emulateMedia({reducedMotion:"reduce"});
  172 |   await open(page);
  173 |   const card=task12Card("unanswerable","normal");
  174 |   await show(page,card);
  175 |   await expect(page.locator(".overlay-card [aria-live]")).toHaveText(displaySpoken(card.spoken));
  176 |   await expect(page.locator(".overlay-card")).not.toHaveAttribute("role","status");
  177 |   expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==="running").length)).toBe(0);
  178 |   await page.screenshot({path:join(output,"reduced-motion.png")});
  179 | });
  180 | test("debug hints appear only with debug query",async({page})=>{
  181 |   await open(page);
  182 |   await expect(page.locator(".overlay-hint")).toHaveCount(0);
  183 |   await page.goto(`/screen/sales?voiceDemo=1&debug=1&lite=1`);
  184 |   await expect(page.locator(".overlay-hint")).toBeVisible();
  185 | });
  186 |
  187 | test("service degradation has its own status",async({page})=>{
  188 |   await open(page);
  189 |   hub.broadcast({type:"error",at:Date.now(),code:"llm_unavailable",message:"服务暂不可用"});
  190 |   hub.broadcast({type:"state.change",at:Date.now(),from:"listening",to:"error-fallback",turn:0});
  191 |   await expect(page.locator(".overlay-en")).toHaveText("Degraded");
  192 |   await expect(page.locator(".overlay-status")).toContainText("服务降级");
  193 |   await page.screenshot({path:join(output,"status-degraded.png")});
  194 | });
  195 | test("normal motion live region never announces a partial sentence",async({page})=>{
  196 |   await page.emulateMedia({reducedMotion:"no-preference"}); await open(page);
  197 |   const card={kind:"brief" as const,title:"读屏验收",lines:[],spoken:"第一句完整。第二句话包含更多的内容，需要等待完整出现后才能播报给读屏用户。"};
  198 |   hub.broadcast({type:"state.change",at:Date.now(),from:"listening",to:"thinking",turn:0,question:"读屏验收"});
  199 |   hub.broadcast({type:"answer.delta",at:Date.now(),seq:0,text:card.spoken,full:true,card});
  200 |   hub.broadcast({type:"state.change",at:Date.now(),from:"thinking",to:"answering",turn:0});
  201 |   await expect(page.locator(".overlay-card [aria-live]")).toHaveText("第一句完整。");
  202 |   await expect(page.locator(".overlay-card [aria-live]")).toHaveText("第二句话包含更多的内容，需要等待完整出现后才能播报给读屏用户。");
  203 | });
  204 |
  205 | for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:3840,height:2160}]) test(`300 character answer pages without hidden text ${viewport.width}`,async({page})=>{
  206 |   await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:"reduce"});await open(page);
  207 |   const text=LONG_ANSWER.slice(0,300);
  208 |   const card={kind:"brief" as const,title:"长回答分页验收",spoken:text,lines:[text]};await show(page,card);
  209 |   const section=page.locator('.overlay-spoken-section');
  210 |   const count=Number(await section.getAttribute('data-pages'));expect(count).toBeGreaterThan(1);
  211 |   for(let i=0;i<count;i++) {
  212 |     expect(await auditText(page,'.overlay-root')).toEqual([]);
  213 |     const starts=await page.locator('.overlay-card-spoken').evaluate(el=>{
  214 |       const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const starts=new Map<number,{x:number,char:string}>();
  215 |       const origin=el.getBoundingClientRect();const scale=origin.width/(el as HTMLElement).clientWidth;const line=parseFloat(getComputedStyle(el).lineHeight)*scale;
  216 |       for(let n=walker.nextNode();n;n=walker.nextNode())for(let j=0;j<(n.textContent?.length??0);j++){
  217 |         const char=n.textContent![j];if(!char.trim())continue;const r=document.createRange();r.setStart(n,j);r.setEnd(n,j+1);const box=r.getBoundingClientRect();const row=Math.round((box.top-origin.top)/line);
  218 |         if(!starts.has(row)||box.left<starts.get(row)!.x)starts.set(row,{x:box.left,char});
  219 |       }
  220 |       return [...starts.values()].map(s=>s.char);
  221 |     });
  222 |     expect(starts.length).toBeLessThanOrEqual(3);expect(starts.every(c=>!/[，。、％！？；：）】》」』]/u.test(c))).toBe(true);
  223 |     await page.getByRole('button',{name:'下一页播报'}).click();
  224 |   }
  225 | });
  226 |
  227 | test("single province 100% and large row counts remain contained",async({page})=>{
  228 |   await open(page);
  229 |   const base=task12Card("region_shipments","normal");if(base.kind!=="region")throw new Error("region fixture required");
  230 |   const card={...base,title:"单省边界验收",summaryText:"单省发运",spoken:"单省发运布局验收。",rows:[{region:"内蒙古自治区",units:999999999,shipments:999999999,sharePercent:100}],other:{regions:0,units:0}};
  231 |   await show(page,card);expect((await bounds(page)).spills).toEqual([]);expect(await auditText(page,".overlay-root")).toEqual([]);
  232 |   await page.addStyleTag({content:'.overlay-region-row > em { width:50px !important; }'});
  233 |   await expect(page.locator(".overlay-region-row > em")).toHaveCSS("width","50px");
  234 |   expect((await auditText(page,".overlay-root")).some(f=>f.kind==="overflow" && f.cls==="EM")).toBe(true);
  235 | });
  236 |
```
