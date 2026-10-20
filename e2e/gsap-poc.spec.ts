import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const output = path.resolve('.review/gsap-poc/functional'); mkdirSync(output, { recursive: true });
test.beforeEach(async ({ request }) => { await request.get('http://127.0.0.1:3199/control?reset=1'); });
async function auditLoop(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    Math.random = () => .5;
    const request = requestAnimationFrame.bind(window), cancel = cancelAnimationFrame.bind(window), pending = new Set<number>(); let max = 0;
    window.requestAnimationFrame = fn => { const id = request(t => { pending.delete(id); fn(t); }); pending.add(id); max = Math.max(max, pending.size); return id; };
    window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
    Object.assign(window, { loopAudit: () => ({ pending: pending.size, max }) });
  });
}
test('GSAP interruption, restart, visibility, reduced motion, single RAF and client engine switching', async ({ page }) => {
  await page.clock.install(); await page.clock.pauseAt(new Date()); await auditLoop(page);
  await page.goto('/screen/sales?debug=1&motion=gsap'); await page.clock.runFor(100);
  const root = page.locator('#screen-stage'), debug = page.locator('.nexus-motion-debug');
  await expect(root).toHaveAttribute('data-motion-engine', 'gsap'); await page.clock.runFor(2700);
  await page.getByRole('button', { name: '重启入场' }).click(); await page.clock.runFor(300);
  expect(Number(await root.evaluate(el => getComputedStyle(el).getPropertyValue('--intro-feed')))).toBe(0);
  await page.getByRole('button', { name: '模拟小川唤醒' }).click(); await page.clock.runFor(300);
  await expect(debug).toHaveAttribute('data-paused', 'true');
  expect(await root.evaluate(el => getComputedStyle(el).getPropertyValue('--intro-feed'))).toBe('1');
  await page.getByRole('button', { name: '模拟小川退出' }).click();
  await page.getByRole('button', { name: '重启入场' }).click(); await page.clock.runFor(2400);
  await expect(debug).toHaveAttribute('data-state', 'AMBIENT');
  await page.getByRole('button', { name: '触发共振' }).click(); await page.clock.runFor(5000);
  expect(await page.locator('.nexus-route-light').first().getAttribute('opacity')).toBe('1');
  await page.getByRole('button', { name: '取消共振' }).click(); await page.clock.runFor(300);
  await expect(page.locator('.nexus-route-light').first()).toHaveAttribute('opacity', '0');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(debug).toHaveAttribute('data-paused', 'true');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.clock.runFor(300);
  await expect(debug).toHaveAttribute('data-level', 'static');
  expect(await page.evaluate(() => (window as unknown as { loopAudit: () => { pending: number } }).loopAudit().pending)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Media-query change is asynchronous to the CDP command. Preserve the original
  // 1000ms RAF assertion, but begin its measurement after the environment resumes.
  const immediate = await page.evaluate(() => ({ loops: (window as unknown as { loopAudit: () => unknown }).loopAudit(), paused: document.querySelector('.nexus-motion-debug')?.getAttribute('data-paused') }));
  await expect(debug).toHaveAttribute('data-paused', 'false');
  const beforeUpdates = JSON.parse((await page.locator('[data-gsap-audit]').textContent())!).listenerUpdates;
  await page.clock.runFor(1000);
  const afterUpdates = JSON.parse((await page.locator('[data-gsap-audit]').textContent())!).listenerUpdates;
  expect(afterUpdates - beforeUpdates).toBeGreaterThan(30);
  const loops = await page.evaluate(() => (window as unknown as { loopAudit: () => { pending: number; max: number } }).loopAudit());
  expect(loops).toEqual({ pending: 1, max: 1 });
  // Next Link uses actual React unmounts, retaining the JS module for leak detection.
  for (let i = 0; i < 5; i++) {
    await page.getByRole('link', { name: '切换 Legacy', exact: true }).click();
    await expect(root).toHaveAttribute('data-motion-engine', 'legacy');
    await page.getByRole('link', { name: '切换 GSAP', exact: true }).click();
    await expect(root).toHaveAttribute('data-motion-engine', 'gsap'); await page.clock.runFor(2400);
    await expect(root).toHaveAttribute('data-gsap-timelines', /^\d+$/);
    const audit = JSON.parse((await page.locator('[data-gsap-audit]').textContent())!);
    expect(audit.liveScenes).toBe(1); expect(audit.rootAnimations).toBe(0); expect(audit.liveTimelines).toBe(Number(await root.getAttribute('data-gsap-timelines')));
  }
  writeFileSync(path.join(output, 'lifecycle.json'), JSON.stringify({ immediate, listenerGrowth: afterUpdates - beforeUpdates, loops, switches: 10, timelines: await root.getAttribute('data-gsap-timelines') }, null, 2));
});
for (const width of [1920, 3840]) test(`stationary geometry and pixels compare at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: width * 9 / 16 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const results = [];
  for (const engine of ['legacy', 'gsap']) {
    await page.goto(`/screen/sales?layout=16x9&motion=${engine}`); await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('#screen-stage')).toHaveAttribute('data-motion-level', 'static');
    await expect(page.locator('.nexus-clock-row time')).toHaveText(/\d{4}-\d{2}-\d{2} /);
    await page.addStyleTag({ content: '.nexus-clock-row time { visibility:hidden }' });
    await page.screenshot({ path: path.join(output, `static-${width}-${engine}.png`) });
    results.push(await page.locator('#screen-stage').evaluate(root => ({
      text: root.textContent?.replace(/\d{2}:\d{2}:\d{2}/g, 'CLOCK'),
      boxes: [...root.querySelectorAll('[data-screen-panel],.nexus-money-hero,.nexus-feed-index,.nexus-machine-thumbnail,.nexus-currency')].map(el => ({ cls: el.className, rect: el.getBoundingClientRect().toJSON() })),
      map: [...root.querySelectorAll('.nexus-map-frame path,.nexus-map-labels span,.nexus-minimap path')].map(el => ({ text: el.textContent, d: el.getAttribute('d'), left: getComputedStyle(el).left, top: getComputedStyle(el).top })),
    })));
  }
  expect(results[1]).toEqual(results[0]);
  writeFileSync(path.join(output, `static-${width}.json`), JSON.stringify(results, null, 2));
});
test('GSAP twelve complete virtual resonance cycles and snapshot refreshes remain bounded', async ({ page }) => {
  test.setTimeout(240_000);
  await page.clock.install(); await page.clock.pauseAt(new Date()); await auditLoop(page);
  await page.goto('/screen/sales?debug=1&motion=gsap'); await page.clock.runFor(100); await expect(page.locator('#screen-stage')).toHaveAttribute('data-motion-engine', 'gsap');
  await page.clock.runFor(2500);
  const initial = Number(await page.locator('#screen-stage').getAttribute('data-gsap-timelines'));
  // Full virtual RAF execution; this is state regression, not a wall-time soak.
  for (let i = 0; i < 12; i++) {
    await page.getByRole('button', { name: '触发共振' }).click(); await page.clock.runFor(10_500);
    await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-state', 'AMBIENT');
    await expect(page.locator('#screen-stage')).toHaveAttribute('data-gsap-timelines', String(initial));
  }
  writeFileSync(path.join(output, 'cycles.json'), JSON.stringify({ kind: 'virtual-clock', cycles: 12, simulatedActiveMs: 126000, timelines: initial }));
});

for (const width of [1920, 3840]) for (const engine of ['legacy', 'gsap']) test(`controlled visual ${engine} ${width}: normal-level intro and pulse checkpoints`, async ({ page }) => {
  await page.setViewportSize({ width, height: width * 9 / 16 });
  await page.clock.install({ time: new Date('2026-10-16T08:00:00Z') }); await page.clock.pauseAt(new Date('2026-10-16T08:00:00Z'));
  await page.addInitScript(() => { Math.random = () => .5; });
  await page.goto(`/screen/sales?layout=16x9&motion=${engine}&debug=1`); await page.clock.runFor(100);
  await expect(page.locator('#screen-stage')).toHaveAttribute('data-motion-engine', engine);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: '.nexus-motion-debug { display:none!important } .nexus-clock-row time { visibility:hidden }' });
  const frames: unknown[] = [];
  async function record(name: string) {
    const audit = await page.locator('#screen-stage').evaluate(root => ({ state: root.getAttribute('data-motion-state'), level: root.getAttribute('data-motion-level'),
      intro: Object.fromEntries(['background', 'map', 'panels', 'feed'].map(k => [k, Number(getComputedStyle(root).getPropertyValue(`--intro-${k}`))])),
      lights: [...root.querySelectorAll('.nexus-route-light')].map(n => Number(n.getAttribute('opacity'))),
      mapPulse: Number(getComputedStyle(root).getPropertyValue('--pulse-map')),
    }));
    expect(audit.level).toBe('normal'); frames.push({ name, ...audit });
    await page.screenshot({ path: path.join(output, `controlled-${engine}-${width}-${name}.png`) });
    return audit;
  }
  await page.getByRole('button', { name: '重启入场', includeHidden: true }).evaluate(el => (el as HTMLElement).click());
  await page.clock.runFor(600); await record('intro-600');
  await page.clock.runFor(900); await record('intro-1500');
  await page.clock.runFor(800); await record('intro-end');
  await page.getByRole('button', { name: '触发共振', includeHidden: true }).evaluate(el => (el as HTMLElement).click());
  await page.clock.runFor(1400); const early = await record('pulse-1400'); expect(early.state).toBe('PULSE'); expect(early.lights.every(n => n === 0)).toBe(true);
  await page.clock.runFor(800); const staged = await record('pulse-2200'); expect(staged.lights.some(n => n > 0)).toBe(true); expect(staged.lights.some(n => n === 0)).toBe(true);
  await page.clock.runFor(2800); const full = await record('pulse-5000'); expect(full.state).toBe('PULSE'); expect(full.lights.every(n => n === 1)).toBe(true);
  await page.clock.runFor(3500); const fade = await record('pulse-8500'); expect(fade.lights.every(n => n > 0 && n < 1)).toBe(true);
  await page.clock.runFor(1800); const end = await record('pulse-end'); expect(end.state).toBe('AMBIENT'); expect(end.lights.every(n => n === 0)).toBe(true);
  writeFileSync(path.join(output, `controlled-${engine}-${width}.json`), JSON.stringify(frames, null, 2));
});
