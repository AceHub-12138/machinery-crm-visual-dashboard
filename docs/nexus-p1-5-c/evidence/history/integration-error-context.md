# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p1-5-c.spec.ts >> rapid engine and mode switches dispose old GSAP hosts/scenes
- Location: e2e/p1-5-c.spec.ts:36:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('.nexus-motion-debug')
Expected: "baseline"
Received: "candidate"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" locator('.nexus-motion-debug') with timeout 5000ms
  - waiting for locator('.nexus-motion-debug')
    3 × locator resolved to <aside aria-label="动效调试" data-clock="8371" data-level="normal" data-paused="false" data-state="AMBIENT" class="nexus-motion-debug" data-quality-state="normal" data-pulse-due-in="149599.5" data-quality-automation="candidate" data-quality-target="59.880239520962">…</aside>
      - unexpected value "candidate"
    2 × locator resolved to <aside aria-label="动效调试" data-level="normal" data-paused="false" data-state="AMBIENT" class="nexus-motion-debug" data-quality-state="normal" data-clock="8488.099999999627" data-quality-automation="candidate" data-quality-target="59.880239520962" data-pulse-due-in="149482.40000000037">…</aside>
      - unexpected value "candidate"
    - locator resolved to <aside aria-label="动效调试" data-level="normal" data-paused="false" data-state="AMBIENT" class="nexus-motion-debug" data-quality-state="normal" data-clock="9004.299999999814" data-quality-automation="candidate" data-pulse-due-in="148966.2000000002" data-quality-target="59.880239520962">…</aside>
    - unexpected value "candidate"
    - locator resolved to <aside aria-label="动效调试" data-level="normal" data-paused="false" data-state="AMBIENT" class="nexus-motion-debug" data-quality-state="normal" data-clock="9504.299999999814" data-quality-automation="candidate" data-pulse-due-in="148466.2000000002" data-quality-target="59.880239520962">…</aside>
    - unexpected value "candidate"
    - locator resolved to <aside aria-label="动效调试" data-level="normal" data-paused="false" data-state="AMBIENT" class="nexus-motion-debug" data-quality-state="normal" data-clock="10004.399999999907" data-quality-automation="candidate" data-pulse-due-in="147966.1000000001" data-quality-target="59.880239520962">…</aside>
    - unexpected value "candidate"
    - locator resolved to <aside aria-label="动效调试" data-level="normal" data-paused="false" data-state="AMBIENT" class="nexus-motion-debug" data-quality-state="normal" data-clock="10521.099999999627" data-quality-automation="candidate" data-quality-target="59.880239520962" data-pulse-due-in="147449.40000000037">…</aside>
    - unexpected value "candidate"
    - locator resolved to <aside aria-label="动效调试" data-level="normal" data-paused="false" data-state="AMBIENT" class="nexus-motion-debug" data-quality-state="normal" data-clock="11054.299999999814" data-quality-automation="candidate" data-pulse-due-in="146916.2000000002" data-quality-target="59.880239520962">…</aside>
    - unexpected value "candidate"
    - locator resolved to <aside aria-label="动效调试" data-level="normal" data-paused="false" data-state="AMBIENT" class="nexus-motion-debug" data-quality-state="normal" data-clock="11554.299999999814" data-quality-automation="candidate" data-pulse-due-in="146416.2000000002" data-quality-target="59.880239520962">…</aside>
    - unexpected value "candidate"
    - locator resolved to <aside aria-label="动效调试" data-level="normal" data-paused="false" data-state="AMBIENT" class="nexus-motion-debug" data-quality-state="normal" data-clock="12054.299999999814" data-quality-automation="candidate" data-pulse-due-in="145916.2000000002" data-quality-target="59.880239520962">…</aside>
    - unexpected value "candidate"
    - locator resolved to <aside aria-label="动效调试" data-level="normal" data-paused="false" data-state="AMBIENT" class="nexus-motion-debug" data-quality-state="normal" data-clock="12554.299999999814" data-quality-automation="candidate" data-pulse-due-in="145416.2000000002" data-quality-target="59.880239520962">…</aside>
    - unexpected value "candidate"
    - locator resolved to <aside aria-label="动效调试" data-level="normal" data-paused="false" data-state="AMBIENT" class="nexus-motion-debug" data-quality-state="normal" data-clock="13054.399999999907" data-quality-automation="candidate" data-pulse-due-in="144916.1000000001" data-quality-target="59.880239520962">…</aside>
    - unexpected value "candidate"

```

```yaml
- complementary "动效调试":
  - paragraph: 状态 AMBIENT · 共振 0%
  - paragraph: FPS 60.0 · 档位 normal · 显著 4/8
  - paragraph: 页面 true · 小川 false
  - paragraph: 数据时间 2026-10-20T00:53:59.648Z
  - paragraph: GSAP
  - link "切换 Legacy":
    - /url: /screen/sales?debug=1&motion=legacy&qualityExperiment=candidate
  - text: ·
  - link "切换 GSAP":
    - /url: /screen/sales?debug=1&motion=gsap
  - button "重启入场"
  - button "触发共振"
  - button "取消共振"
  - button "强制低档" [disabled]
  - button "恢复自动档" [disabled]
  - button "模拟小川唤醒"
  - button "导出性能日志"
  - button "重新校准刷新率"
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | const permitted=process.env.NEXUS_QUALITY_PERMISSION!=='denied';
  3  | test.beforeEach(async ({request})=>{await request.get('http://127.0.0.1:3199/control?reset=1');});
  4  | for(const mode of ['candidate','shadow','external','invalid',''] as const) test(`server permission resolves ${mode||'default'}`,async({page})=>{
  5  |   await page.goto(`/screen/sales?debug=1&qualityExperiment=${mode}`);
  6  |   const expected=permitted&&(mode==='candidate'||mode==='shadow')?mode:'baseline';
  7  |   await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-quality-automation',expected);
  8  |   await expect(page.locator('#screen-stage')).toHaveAttribute('data-motion-engine','legacy');
  9  |   await expect(page.getByRole('button',{name:'强制低档'})).toBeEnabled({enabled:expected!=='candidate'});
  10 | });
  11 | for(const engine of ['legacy','gsap']) for(const mode of ['candidate','shadow']) test(`${engine} ${mode} lifecycle and quality rollback`, async({page})=>{
  12 |   test.skip(!permitted,'permission-denied matrix only exercises access checks');
  13 |   await page.goto(`/screen/sales?debug=1&motion=${engine}&qualityExperiment=${mode}`);
  14 |   const debug=page.locator('.nexus-motion-debug');
  15 |   await expect(debug).toHaveAttribute('data-quality-automation',mode); await expect(debug).toHaveAttribute('data-paused','false');
  16 |   const audit=async()=>JSON.parse((await page.locator('[data-gsap-audit]').textContent())!);
  17 |   for(const kind of ['hidden','voice','reduced']) {
  18 |     if(kind==='hidden') await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  19 |     if(kind==='voice') await page.getByRole('button',{name:'模拟小川唤醒'}).click();
  20 |     if(kind==='reduced') await page.emulateMedia({reducedMotion:'reduce'});
  21 |     await expect(debug).toHaveAttribute('data-paused','true');
  22 |     if(engine==='gsap') expect((await audit()).activeListeners).toBe(0);
  23 |     if(kind==='hidden') await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  24 |     if(kind==='voice') await page.getByRole('button',{name:'模拟小川退出'}).click();
  25 |     if(kind==='reduced') await page.emulateMedia({reducedMotion:'no-preference'});
  26 |     await expect(debug).toHaveAttribute('data-paused','false');
  27 |     if(engine==='gsap') {await expect.poll(async()=>(await audit()).activeListeners).toBe(1);expect((await audit()).liveScenes).toBe(1);}
  28 |   }
  29 |   await page.getByRole('button',{name:'重新校准刷新率'}).click();
  30 |   await expect(debug).toHaveAttribute('data-paused','false');
  31 |   await expect.poll(async()=>JSON.parse((await page.locator('[data-quality-log]').textContent())!).some((d:{reason:string})=>d.reason==='reference-recalibrated')).toBe(true);
  32 |   const numbers=await page.locator('[data-motion-number]').allTextContents();
  33 |   await page.waitForTimeout(1200);expect(await page.locator('[data-motion-number]').allTextContents()).toEqual(numbers);
  34 |   await page.goto(`/screen/sales?debug=1&motion=${engine}`);await expect(debug).toHaveAttribute('data-quality-automation','baseline');
  35 | });
  36 | test('rapid engine and mode switches dispose old GSAP hosts/scenes',async({page})=>{
  37 |   test.skip(!permitted);
  38 |   await page.goto('/screen/sales?debug=1&motion=gsap&qualityExperiment=candidate');
  39 |   for(let i=0;i<8;i++){
  40 |     await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-paused','false');
  41 |     await page.getByRole('link',{name:'切换 Legacy',exact:true}).click();await expect(page.locator('#screen-stage')).toHaveAttribute('data-motion-engine','legacy');
  42 |     await page.getByRole('link',{name:'切换 GSAP',exact:true}).click();await expect(page.locator('#screen-stage')).toHaveAttribute('data-motion-engine','gsap');
  43 |   }
  44 |   await expect.poll(async()=>JSON.parse((await page.locator('[data-gsap-audit]').textContent())!).activeListeners).toBe(1);
  45 |   const a=JSON.parse((await page.locator('[data-gsap-audit]').textContent())!);expect(a.liveScenes).toBe(1);expect(a.rootAnimations).toBe(0);expect(a.liveTimelines).toBe(Number(await page.locator('#screen-stage').getAttribute('data-gsap-timelines')));
  46 |   // Same-engine client navigation must recreate its Director when its permission/mode changes.
  47 |   await page.evaluate(()=>{const a=document.querySelector('a[href*="motion=gsap"]') as HTMLAnchorElement;a.href='/screen/sales?debug=1&motion=gsap';a.click();});
> 48 |   await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-quality-automation','baseline');
     |                                                     ^ Error: expect(locator).toHaveAttribute(expected) failed
  49 | });
  50 |
```
