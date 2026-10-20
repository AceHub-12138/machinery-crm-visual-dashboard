# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: gsap-poc.spec.ts >> GSAP interruption, restart, visibility, reduced motion, single RAF and client engine switching
- Location: e2e/gsap-poc.spec.ts:15:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

  Object {
    "max": 1,
-   "pending": 1,
+   "pending": 0,
  }
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - main [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e6]:
        - img "大川机床 DACHUAN MACHINE" [ref=e7]
        - generic [ref=e8]:
          - heading "销售经营中心" [level=1] [ref=e9]
          - paragraph [ref=e10]: 统计周期：2026 年 9 月
      - generic [ref=e11]:
        - paragraph [ref=e12]: 数据驱动 · 精密运营 · 客户成长 · 大川智造
        - generic [ref=e13]:
          - generic [ref=e14]: ◉ 小川 · STANDBY
          - time [ref=e15]: 2026-10-20 13:06:45
    - generic [ref=e16]:
      - generic [ref=e17]:
        - generic [ref=e18]:
          - heading "本月合同额 人民币口径" [level=2] [ref=e19]:
            - text: 本月合同额
            - generic [aria-hidden] [ref=e21]: ›
            - generic [ref=e22]: 人民币口径
          - generic "¥68.4万" [ref=e23]:
            - generic [ref=e24]: ¥
            - generic [ref=e25]: "68.4"
            - generic [ref=e26]: 万
          - generic [ref=e27]:
            - meter "月度目标达成" [ref=e28]
            - generic "合同目标刻度" [ref=e31]:
              - generic [ref=e32]: "0"
              - generic [ref=e33]: ¥750.0万
              - generic [ref=e34]: ¥1,500.0万
          - generic [ref=e35]:
            - generic [ref=e36]:
              - paragraph [ref=e37]: 月度目标
              - generic "¥1,500.0万" [ref=e38]:
                - generic [ref=e39]: ¥
                - generic [ref=e40]: 1,500.0
                - generic [ref=e41]: 万
            - generic [ref=e42]:
              - paragraph [ref=e43]: 达成
              - generic "85.7%" [ref=e44]
            - generic [ref=e45]:
              - paragraph [ref=e46]: 新签
              - strong [ref=e47]: 18 份
        - generic [ref=e48]:
          - heading "经营关键指标" [level=2] [ref=e49]:
            - text: 经营关键指标
            - generic [aria-hidden] [ref=e51]: ›
          - generic [ref=e52]:
            - generic [ref=e53]:
              - paragraph [ref=e64]: 实际回款
              - generic "¥742.0万" [ref=e65]:
                - generic [ref=e66]: ¥
                - generic [ref=e67]: "742.0"
                - generic [ref=e68]: 万
            - generic [ref=e69]:
              - paragraph [ref=e79]: 客户总数
              - strong [ref=e80]:
                - generic "286" [ref=e81]
              - paragraph [ref=e82]: 新增 18
            - generic [ref=e83]:
              - paragraph [ref=e92]: 本期发货
              - strong [ref=e93]: 18 台
              - paragraph [ref=e94]: 7 日内待发 5 单
      - generic [ref=e96]:
        - generic [ref=e97]:
          - heading "业务覆盖" [level=2] [ref=e98]:
            - text: 业务覆盖
            - generic [aria-hidden] [ref=e100]: ›
          - paragraph [ref=e101]:
            - text: 覆盖
            - strong [ref=e102]: "12"
            - text: 个省 ｜ 本期
            - strong [ref=e103]: "18"
            - text: 台
        - generic:
          - generic: 北京
          - generic: 山西
          - generic: 内蒙古
          - generic: 辽宁
          - generic: 福建
          - generic: 湖南
          - generic: 广西
          - generic: 海南
          - generic: 四川
          - generic: 贵州
          - generic: 云南
          - generic: 西藏
          - generic: 甘肃
          - generic: 青海
          - generic: 宁夏
          - generic: 新疆
          - generic: 台湾
          - generic: 上海
          - generic: 苏州
          - generic: 青岛
          - generic: 武汉
          - generic: 成都
          - generic: 沈阳
          - generic: 广州
          - generic: 西安
          - generic: 哈尔滨
          - strong: 山东滕州
        - generic [ref=e106]:
          - button "上海 2 台" [ref=e107] [cursor=pointer]
          - button "苏州 1 台" [ref=e108] [cursor=pointer]
          - button "宁波 2 台" [ref=e109] [cursor=pointer]
          - button "青岛 1 台" [ref=e110] [cursor=pointer]
          - button "武汉 1 台" [ref=e111] [cursor=pointer]
          - button "成都 1 台" [ref=e112] [cursor=pointer]
          - button "沈阳 2 台" [ref=e113] [cursor=pointer]
          - button "广州 3 台" [ref=e114] [cursor=pointer]
          - button "西安 1 台" [ref=e115] [cursor=pointer]
          - button "郑州 1 台" [ref=e116] [cursor=pointer]
          - button "长沙 2 台" [ref=e117] [cursor=pointer]
          - button "哈尔滨 1 台" [ref=e118] [cursor=pointer]
        - complementary [ref=e119]:
          - img "全国地图（含台湾及南海诸岛）" [ref=e120]
          - paragraph [ref=e400]: 南海诸岛
      - generic [ref=e401]:
        - generic [ref=e402]:
          - heading "合同与回款 人民币口径" [level=2] [ref=e403]:
            - text: 合同与回款
            - generic [aria-hidden] [ref=e405]: ›
            - generic [ref=e406]: 人民币口径
          - generic [ref=e407]:
            - generic [ref=e409]:
              - paragraph [ref=e410]: 累计回款率
              - strong [ref=e411]: 69.9%
            - generic [ref=e412]:
              - generic [ref=e413]:
                - paragraph [ref=e414]: 已收
                - generic "¥6,123.9万" [ref=e415]:
                  - generic [ref=e416]: ¥
                  - generic [ref=e417]: 6,123.9
                  - generic [ref=e418]: 万
              - generic [ref=e419]:
                - paragraph [ref=e420]: 未收
                - generic "¥2,641.5万" [ref=e421]:
                  - generic [ref=e422]: ¥
                  - generic [ref=e423]: 2,641.5
                  - generic [ref=e424]: 万
        - generic [ref=e425]:
          - heading "发货预警" [level=2] [ref=e426]:
            - text: 发货预警
            - generic [aria-hidden] [ref=e428]: ›
          - generic [ref=e429]:
            - generic [ref=e430]:
              - paragraph [ref=e434]: 逾期待发
              - strong [ref=e435]: 3 单
            - generic [ref=e436]:
              - paragraph [ref=e441]: 今日应发
              - strong [ref=e442]: 2 单
            - generic [ref=e443]:
              - paragraph [ref=e447]: 7 日内待发
              - strong [ref=e448]: 5 单
      - region "交付里程碑" [ref=e450]:
        - heading "最新发货动态" [level=2] [ref=e451]:
          - text: 最新发货动态
          - generic [aria-hidden] [ref=e453]: ›
        - generic [ref=e454]:
          - button "01 BK5032轮廓示意图 BK5032 09-13 2 台 东北 · 辽宁省" [ref=e455] [cursor=pointer]:
            - generic [ref=e456]: "01"
            - img "BK5032轮廓示意图" [ref=e457]
            - generic "BK5032" [ref=e467]
            - generic [ref=e468]:
              - time [ref=e469]: 09-13
              - generic [ref=e470]: 2 台
              - generic [ref=e471]: 东北 · 辽宁省
          - button "02 B5032轮廓示意图 B5032 09-11 2 台 华东 · 浙江省" [ref=e472] [cursor=pointer]:
            - generic [ref=e473]: "02"
            - img "B5032轮廓示意图" [ref=e474]
            - generic "B5032" [ref=e484]
            - generic [ref=e485]:
              - time [ref=e486]: 09-11
              - generic [ref=e487]: 2 台
              - generic [ref=e488]: 华东 · 浙江省
          - button "03 BK5030轮廓示意图 BK5030 09-10 2 台 华中 · 湖南省" [ref=e489] [cursor=pointer]:
            - generic [ref=e490]: "03"
            - img "BK5030轮廓示意图" [ref=e491]
            - generic "BK5030" [ref=e501]
            - generic [ref=e502]:
              - time [ref=e503]: 09-10
              - generic [ref=e504]: 2 台
              - generic [ref=e505]: 华中 · 湖南省
          - button "04 BK5030轮廓示意图 BK5030 09-08 2 台 华东 · 上海市" [ref=e506] [cursor=pointer]:
            - generic [ref=e507]: "04"
            - img "BK5030轮廓示意图" [ref=e508]
            - generic "BK5030" [ref=e518]
            - generic [ref=e519]:
              - time [ref=e520]: 09-08
              - generic [ref=e521]: 2 台
              - generic [ref=e522]: 华东 · 上海市
          - button "05 YK5120轮廓示意图 YK5120 09-04 1 台 华东 · 江苏省" [ref=e523] [cursor=pointer]:
            - generic [ref=e524]: "05"
            - img "YK5120轮廓示意图" [ref=e525]
            - generic "YK5120" [ref=e535]
            - generic [ref=e536]:
              - time [ref=e537]: 09-04
              - generic [ref=e538]: 1 台
              - generic [ref=e539]: 华东 · 江苏省
  - complementary "动效调试" [ref=e540]:
    - paragraph [ref=e541]: 状态 AMBIENT · 共振 0%
    - paragraph [ref=e542]: FPS 60.5 · 档位 normal · 显著 4/8
    - paragraph [ref=e543]: 页面 true · 小川 false
    - paragraph [ref=e544]: 数据时间 2026-10-20T05:06:33.814Z
    - paragraph [ref=e545]: GSAP
    - link "切换 Legacy" [ref=e546] [cursor=pointer]:
      - /url: /screen/sales?debug=1&motion=legacy
    - text: ·
    - link "切换 GSAP" [ref=e547] [cursor=pointer]:
      - /url: /screen/sales?debug=1&motion=gsap
    - link "回到 Baseline" [ref=e548] [cursor=pointer]:
      - /url: /screen/sales?debug=1&motion=gsap
    - button "重启入场" [ref=e549] [cursor=pointer]
    - button "触发共振" [ref=e550] [cursor=pointer]
    - button "取消共振" [active] [ref=e551] [cursor=pointer]
    - button "强制低档" [ref=e552] [cursor=pointer]
    - button "恢复自动档" [ref=e553] [cursor=pointer]
    - button "模拟小川唤醒" [ref=e554] [cursor=pointer]
    - button "导出性能日志" [ref=e555] [cursor=pointer]
  - alert [ref=e556]
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import { mkdirSync, writeFileSync } from 'node:fs';
  3   | import path from 'node:path';
  4   | const output = path.resolve('.review/gsap-poc/functional'); mkdirSync(output, { recursive: true });
  5   | test.beforeEach(async ({ request }) => { await request.get('http://127.0.0.1:3199/control?reset=1'); });
  6   | async function auditLoop(page: import('@playwright/test').Page) {
  7   |   await page.addInitScript(() => {
  8   |     Math.random = () => .5;
  9   |     const request = requestAnimationFrame.bind(window), cancel = cancelAnimationFrame.bind(window), pending = new Set<number>(); let max = 0;
  10  |     window.requestAnimationFrame = fn => { const id = request(t => { pending.delete(id); fn(t); }); pending.add(id); max = Math.max(max, pending.size); return id; };
  11  |     window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
  12  |     Object.assign(window, { loopAudit: () => ({ pending: pending.size, max }) });
  13  |   });
  14  | }
  15  | test('GSAP interruption, restart, visibility, reduced motion, single RAF and client engine switching', async ({ page }) => {
  16  |   await page.clock.install(); await page.clock.pauseAt(new Date()); await auditLoop(page);
  17  |   await page.goto('/screen/sales?debug=1&motion=gsap'); await page.clock.runFor(100);
  18  |   const root = page.locator('#screen-stage'), debug = page.locator('.nexus-motion-debug');
  19  |   await expect(root).toHaveAttribute('data-motion-engine', 'gsap'); await page.clock.runFor(2700);
  20  |   await page.getByRole('button', { name: '重启入场' }).click(); await page.clock.runFor(300);
  21  |   expect(Number(await root.evaluate(el => getComputedStyle(el).getPropertyValue('--intro-feed')))).toBe(0);
  22  |   await page.getByRole('button', { name: '模拟小川唤醒' }).click(); await page.clock.runFor(300);
  23  |   await expect(debug).toHaveAttribute('data-paused', 'true');
  24  |   expect(await root.evaluate(el => getComputedStyle(el).getPropertyValue('--intro-feed'))).toBe('1');
  25  |   await page.getByRole('button', { name: '模拟小川退出' }).click();
  26  |   await page.getByRole('button', { name: '重启入场' }).click(); await page.clock.runFor(2400);
  27  |   await expect(debug).toHaveAttribute('data-state', 'AMBIENT');
  28  |   await page.getByRole('button', { name: '触发共振' }).click(); await page.clock.runFor(5000);
  29  |   expect(await page.locator('.nexus-route-light').first().getAttribute('opacity')).toBe('1');
  30  |   await page.getByRole('button', { name: '取消共振' }).click(); await page.clock.runFor(300);
  31  |   await expect(page.locator('.nexus-route-light').first()).toHaveAttribute('opacity', '0');
  32  |   await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  33  |   await expect(debug).toHaveAttribute('data-paused', 'true');
  34  |   await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  35  |   await page.emulateMedia({ reducedMotion: 'reduce' }); await page.clock.runFor(300);
  36  |   await expect(debug).toHaveAttribute('data-level', 'static');
  37  |   expect(await page.evaluate(() => (window as unknown as { loopAudit: () => { pending: number } }).loopAudit().pending)).toBe(0);
  38  |   await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.clock.runFor(1000);
  39  |   const loops = await page.evaluate(() => (window as unknown as { loopAudit: () => { pending: number; max: number } }).loopAudit());
> 40  |   expect(loops).toEqual({ pending: 1, max: 1 });
      |                 ^ Error: expect(received).toEqual(expected) // deep equality
  41  |   // Next Link uses actual React unmounts, retaining the JS module for leak detection.
  42  |   for (let i = 0; i < 5; i++) {
  43  |     await page.getByRole('link', { name: '切换 Legacy', exact: true }).click();
  44  |     await expect(root).toHaveAttribute('data-motion-engine', 'legacy');
  45  |     await page.getByRole('link', { name: '切换 GSAP', exact: true }).click();
  46  |     await expect(root).toHaveAttribute('data-motion-engine', 'gsap'); await page.clock.runFor(2400);
  47  |     await expect(root).toHaveAttribute('data-gsap-timelines', /^\d+$/);
  48  |     const audit = JSON.parse((await page.locator('[data-gsap-audit]').textContent())!);
  49  |     expect(audit.liveScenes).toBe(1); expect(audit.rootAnimations).toBe(0); expect(audit.liveTimelines).toBe(Number(await root.getAttribute('data-gsap-timelines')));
  50  |   }
  51  |   writeFileSync(path.join(output, 'lifecycle.json'), JSON.stringify({ loops, switches: 10, timelines: await root.getAttribute('data-gsap-timelines') }, null, 2));
  52  | });
  53  | for (const width of [1920, 3840]) test(`stationary geometry and pixels compare at ${width}`, async ({ page }) => {
  54  |   await page.setViewportSize({ width, height: width * 9 / 16 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  55  |   const results = [];
  56  |   for (const engine of ['legacy', 'gsap']) {
  57  |     await page.goto(`/screen/sales?layout=16x9&motion=${engine}`); await page.evaluate(() => document.fonts.ready);
  58  |     await expect(page.locator('#screen-stage')).toHaveAttribute('data-motion-level', 'static');
  59  |     await expect(page.locator('.nexus-clock-row time')).toHaveText(/\d{4}-\d{2}-\d{2} /);
  60  |     await page.addStyleTag({ content: '.nexus-clock-row time { visibility:hidden }' });
  61  |     await page.screenshot({ path: path.join(output, `static-${width}-${engine}.png`) });
  62  |     results.push(await page.locator('#screen-stage').evaluate(root => ({
  63  |       text: root.textContent?.replace(/\d{2}:\d{2}:\d{2}/g, 'CLOCK'),
  64  |       boxes: [...root.querySelectorAll('[data-screen-panel],.nexus-money-hero,.nexus-feed-index,.nexus-machine-thumbnail,.nexus-currency')].map(el => ({ cls: el.className, rect: el.getBoundingClientRect().toJSON() })),
  65  |       map: [...root.querySelectorAll('.nexus-map-frame path,.nexus-map-labels span,.nexus-minimap path')].map(el => ({ text: el.textContent, d: el.getAttribute('d'), left: getComputedStyle(el).left, top: getComputedStyle(el).top })),
  66  |     })));
  67  |   }
  68  |   expect(results[1]).toEqual(results[0]);
  69  |   writeFileSync(path.join(output, `static-${width}.json`), JSON.stringify(results, null, 2));
  70  | });
  71  | test('GSAP twelve complete virtual resonance cycles and snapshot refreshes remain bounded', async ({ page }) => {
  72  |   test.setTimeout(240_000);
  73  |   await page.clock.install(); await page.clock.pauseAt(new Date()); await auditLoop(page);
  74  |   await page.goto('/screen/sales?debug=1&motion=gsap'); await page.clock.runFor(100); await expect(page.locator('#screen-stage')).toHaveAttribute('data-motion-engine', 'gsap');
  75  |   await page.clock.runFor(2500);
  76  |   const initial = Number(await page.locator('#screen-stage').getAttribute('data-gsap-timelines'));
  77  |   // Full virtual RAF execution; this is state regression, not a wall-time soak.
  78  |   for (let i = 0; i < 12; i++) {
  79  |     await page.getByRole('button', { name: '触发共振' }).click(); await page.clock.runFor(10_500);
  80  |     await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-state', 'AMBIENT');
  81  |     await expect(page.locator('#screen-stage')).toHaveAttribute('data-gsap-timelines', String(initial));
  82  |   }
  83  |   writeFileSync(path.join(output, 'cycles.json'), JSON.stringify({ kind: 'virtual-clock', cycles: 12, simulatedActiveMs: 126000, timelines: initial }));
  84  | });
  85  |
  86  | for (const width of [1920, 3840]) for (const engine of ['legacy', 'gsap']) test(`controlled visual ${engine} ${width}: normal-level intro and pulse checkpoints`, async ({ page }) => {
  87  |   await page.setViewportSize({ width, height: width * 9 / 16 });
  88  |   await page.clock.install({ time: new Date('2026-10-16T08:00:00Z') }); await page.clock.pauseAt(new Date('2026-10-16T08:00:00Z'));
  89  |   await page.addInitScript(() => { Math.random = () => .5; });
  90  |   await page.goto(`/screen/sales?layout=16x9&motion=${engine}&debug=1`); await page.clock.runFor(100);
  91  |   await expect(page.locator('#screen-stage')).toHaveAttribute('data-motion-engine', engine);
  92  |   await page.evaluate(() => document.fonts.ready);
  93  |   await page.addStyleTag({ content: '.nexus-motion-debug { display:none!important } .nexus-clock-row time { visibility:hidden }' });
  94  |   const frames: unknown[] = [];
  95  |   async function record(name: string) {
  96  |     const audit = await page.locator('#screen-stage').evaluate(root => ({ state: root.getAttribute('data-motion-state'), level: root.getAttribute('data-motion-level'),
  97  |       intro: Object.fromEntries(['background', 'map', 'panels', 'feed'].map(k => [k, Number(getComputedStyle(root).getPropertyValue(`--intro-${k}`))])),
  98  |       lights: [...root.querySelectorAll('.nexus-route-light')].map(n => Number(n.getAttribute('opacity'))),
  99  |       mapPulse: Number(getComputedStyle(root).getPropertyValue('--pulse-map')),
  100 |     }));
  101 |     expect(audit.level).toBe('normal'); frames.push({ name, ...audit });
  102 |     await page.screenshot({ path: path.join(output, `controlled-${engine}-${width}-${name}.png`) });
  103 |     return audit;
  104 |   }
  105 |   await page.getByRole('button', { name: '重启入场', includeHidden: true }).evaluate(el => (el as HTMLElement).click());
  106 |   await page.clock.runFor(600); await record('intro-600');
  107 |   await page.clock.runFor(900); await record('intro-1500');
  108 |   await page.clock.runFor(800); await record('intro-end');
  109 |   await page.getByRole('button', { name: '触发共振', includeHidden: true }).evaluate(el => (el as HTMLElement).click());
  110 |   await page.clock.runFor(1400); const early = await record('pulse-1400'); expect(early.state).toBe('PULSE'); expect(early.lights.every(n => n === 0)).toBe(true);
  111 |   await page.clock.runFor(800); const staged = await record('pulse-2200'); expect(staged.lights.some(n => n > 0)).toBe(true); expect(staged.lights.some(n => n === 0)).toBe(true);
  112 |   await page.clock.runFor(2800); const full = await record('pulse-5000'); expect(full.state).toBe('PULSE'); expect(full.lights.every(n => n === 1)).toBe(true);
  113 |   await page.clock.runFor(3500); const fade = await record('pulse-8500'); expect(fade.lights.every(n => n > 0 && n < 1)).toBe(true);
  114 |   await page.clock.runFor(1800); const end = await record('pulse-end'); expect(end.state).toBe('AMBIENT'); expect(end.lights.every(n => n === 0)).toBe(true);
  115 |   writeFileSync(path.join(output, `controlled-${engine}-${width}.json`), JSON.stringify(frames, null, 2));
  116 | });
  117 |
```
