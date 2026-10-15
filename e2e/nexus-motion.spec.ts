import { test, expect } from '@playwright/test';
import { startVoiceHub, type VoiceHubServer } from '../services/voice-orchestrator/src/ws/ws-server';
let hub: VoiceHubServer;
test.beforeAll(async () => { hub = await startVoiceHub({ host: '127.0.0.1', port: 0, onMessage: (conn, raw) => { if (JSON.parse(raw).type === 'console.hello') conn.role = 'screen'; } }); });
test.afterAll(async () => { await hub.close(); });
test.beforeEach(async ({ request }) => { await request.get('http://127.0.0.1:3199/control?reset=1'); });
test('SSR first paint declares normal money size before measurement', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1792, height: 832 } });
  const page = await context.newPage(); await page.goto(`${baseURL}/screen/sales`);
  expect(await page.locator('.nexus-money-hero').evaluate(el => getComputedStyle(el).fontSize)).toBe('72px');
  expect(await page.locator('.nexus-money-number').first().evaluate(el => getComputedStyle(el).fontSize)).toBe('72px');
  await context.close();
});
test('intro, real-key carousel linkage, one loop, reduced-motion and teardown', async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-14T02:30:00Z") }); await page.clock.pauseAt(new Date("2026-10-14T02:30:00Z")); await page.addInitScript(() => { Math.random = () => .5; });
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window), pending = new Set<number>();
    let max = 0;
    window.requestAnimationFrame = fn => { const id = request(time => { pending.delete(id); fn(time); }); pending.add(id); max = Math.max(max, pending.size); return id; };
    window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
    Object.assign(window, { motionLoopAudit: () => ({ max, pending: pending.size }) });
  });
  await page.goto('/screen/sales?debug=1');
  await expect(page.locator('.nexus-money-hero')).toHaveAttribute('data-fit-ellipsis', 'false');
  await page.clock.runFor(2600); await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-state', 'AMBIENT');
  await page.clock.runFor(11_000);
  const selected = page.locator('.nexus-feed-item[aria-pressed="true"]'); await expect(selected).toHaveCount(1);
  const key = await selected.getAttribute('data-route-key'); await expect(page.locator(`.nexus-map-layer-0 [data-route-keys~="${key}"]`)).toHaveCount(1); await expect(page.locator(`.nexus-map-layer-0 [data-route-keys~="${key}"]`)).toHaveAttribute('data-route-bright', 'true');
  await page.clock.runFor(2100); await expect(page.locator(`.nexus-map-layer-0 [data-route-keys~="${key}"] .nexus-city-active`)).toHaveAttribute('opacity', '0');
  expect(await page.evaluate(() => (window as unknown as { motionLoopAudit: () => {max:number} }).motionLoopAudit().max)).toBe(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-level', 'static');
  expect(await page.evaluate(() => (window as unknown as { motionLoopAudit: () => {pending:number} }).motionLoopAudit().pending)).toBe(0);
  await page.getByRole('button', { name: '触发共振' }).click(); await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-state', 'AMBIENT');
  await page.goto('about:blank');
});
test('pulse storyboard: map 0–1.5s, routes near→far 1.5–3s, full hold ≥3.4s with ≤5 ripples, smooth 6.5–10s return, text fixed, cancellation and voice priority', async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-14T02:30:00Z") }); await page.clock.pauseAt(new Date("2026-10-14T02:30:00Z")); await page.addInitScript(() => { Math.random = () => .5; });
  await page.goto(`/screen/sales?debug=1&voiceLive=1&lite=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);
  await page.clock.runFor(2700); await expect.poll(() => hub.counts().screens).toBe(1);
  const before = await page.locator('.nexus-money-hero').boundingBox(), text = await page.locator('.nexus-money-hero').textContent();
  const lines = await page.locator('.nexus-map-layer-0 [data-city-key]').count();
  await page.getByRole('button', { name: '触发共振' }).click(); await page.clock.runFor(1400);
  await expect(page.locator('.nexus-map-layer-0 [data-route-bright="true"]')).toHaveCount(0);
  expect(Number(await page.locator('#screen-stage').evaluate(el => getComputedStyle(el).getPropertyValue('--pulse-map')))).toBeGreaterThan(.14);
  await page.clock.runFor(800);
  const staged = await page.locator('.nexus-map-layer-0 [data-city-key]').evaluateAll(nodes => nodes.map(n => ({ bright: n.getAttribute('data-route-bright') === 'true', order: Number(n.getAttribute('data-route-order')) })));
  const lit = staged.filter(r => r.bright), dark = staged.filter(r => !r.bright);
  expect(lit.length).toBeGreaterThan(0); expect(dark.length).toBeGreaterThan(0);
  expect(Math.max(...lit.map(r => r.order))).toBeLessThan(Math.min(...dark.map(r => r.order)));
  const samples: { t: number; full: boolean; opacity: number; bright: number; ripples: number }[] = [];
  for (let t = 2250; t <= 10_300; t += 50) {
    await page.clock.runFor(50);
    samples.push({ t, ...await page.locator('#screen-stage').evaluate(stage => {
      const lights = [...stage.querySelectorAll('.nexus-map-layer-0 .nexus-route-light')];
      return { full: lights.every(n => n.getAttribute('opacity') === '1'), opacity: Number(lights[0].getAttribute('opacity')),
        bright: stage.querySelectorAll('.nexus-map-layer-0 [data-route-bright="true"]').length,
        ripples: [...stage.querySelectorAll('.nexus-map-layer-0 .nexus-city-ripple')].filter(n => Number(n.getAttribute('opacity')) > 0).length };
    }) });
    if (t === 5000) {
      expect(await page.locator('.nexus-money-hero').boundingBox()).toEqual(before); await expect(page.locator('.nexus-money-hero')).toHaveText(text!);
      await expect(page.locator('.nexus-map-layer-0 [data-route-bright="true"]')).toHaveCount(lines);
      expect(await page.locator('.nexus-map-layer-0 [data-pulse-ripple="true"] .nexus-city-ripple').evaluateAll(nodes => nodes.filter(n => Number(n.getAttribute('opacity')) > .7).length)).toBe(5);
      expect(await page.locator('.nexus-map-layer-0 [data-pulse-ripple="false"] .nexus-city-ripple').evaluateAll(nodes => nodes.every(n => n.getAttribute('opacity') === '0'))).toBe(true);
    }
  }
  const full = samples.filter(s => s.full);
  expect(full[0].t).toBeLessThanOrEqual(3100);
  expect(full[full.length - 1].t - full[0].t).toBeGreaterThanOrEqual(3400);
  expect(Math.max(...samples.map(s => s.ripples))).toBeLessThanOrEqual(5);
  const decay = samples.filter(s => s.t > full[full.length - 1].t && s.t <= 10_000);
  expect(decay.length).toBeGreaterThan(50);
  for (let i = 1; i < decay.length; i++) { expect(decay[i].opacity).toBeLessThanOrEqual(decay[i - 1].opacity); expect(decay[i - 1].opacity - decay[i].opacity).toBeLessThanOrEqual(.05); }
  expect(decay.some(s => s.opacity > 0 && s.opacity < 1)).toBe(true);
  await expect(page.locator('.nexus-map-layer-0 [data-route-bright="true"]')).toHaveCount(0);
  hub.broadcast({ type: 'session.start', at: Date.now(), sessionId: 'motion-priority' });
  hub.broadcast({ type: 'state.change', at: Date.now(), from: 'waking', to: 'listening', turn: 0 });
  await expect(page.locator('.overlay-root')).toHaveAttribute('data-phase', 'enter');
  await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-paused', 'true');
  await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-state', 'AMBIENT');
  await page.clock.runFor(300); expect(await page.locator('.nexus-route-light').first().evaluate(el => getComputedStyle(el).opacity)).toBe('0');
  await page.keyboard.press('Escape'); await page.clock.runFor(2000);
  await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-paused', 'false');
  await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-state', 'AMBIENT');
  await page.getByRole('button', { name: '触发共振' }).click(); await page.clock.runFor(5000);
  await page.getByRole('button', { name: '取消共振' }).click();
  // CSS compositor time is real, independently of Playwright's virtual rAF clock.
  await page.clock.runFor(140); await expect(page.locator('#screen-stage')).toHaveAttribute('data-motion-reset', 'true');
  await page.clock.runFor(160); await expect(page.locator('#screen-stage')).toHaveAttribute('data-motion-reset', 'false');
  await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-state', 'AMBIENT');
});
test('manual degradation disables particles and pulse and permits one flight', async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-14T02:30:00Z") }); await page.clock.pauseAt(new Date("2026-10-14T02:30:00Z")); await page.addInitScript(() => { Math.random = () => .5; }); await page.goto('/screen/sales?debug=1'); await page.clock.runFor(2600);
  await page.getByRole('button', { name: '强制低档' }).click(); await page.getByRole('button', { name: '触发共振' }).click();
  await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-state', 'DEGRADED');
  await page.clock.runFor(9000);
  expect(await page.locator('.nexus-particles').evaluate(el => getComputedStyle(el).visibility)).toBe('hidden');
  await expect(page.locator('.nexus-route-traveler[opacity="1"]')).toHaveCount(1);
  await page.getByRole('button', { name: '恢复自动档' }).click(); await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-level', 'normal');
});
test('unchanged snapshots leave numbers static and debug is absent in production playback', async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-14T02:30:00Z") }); await page.clock.pauseAt(new Date("2026-10-14T02:30:00Z")); await page.addInitScript(() => { Math.random = () => .5; }); await page.goto('/screen/sales'); await page.clock.runFor(2600);
  await expect(page.locator('.nexus-motion-debug')).toHaveCount(0);
  const numbers = await page.locator('[data-motion-number]').allTextContents();
  await page.clock.runFor(65_000); expect(await page.locator('[data-motion-number]').allTextContents()).toEqual(numbers);
  await expect(page.locator('[data-motion-number-active="true"]')).toHaveCount(0);
});
test('carousel visits all five keys across the minute snapshot refresh', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-14T02:30:00Z') }); await page.clock.pauseAt(new Date('2026-10-14T02:30:00Z'));
  await page.addInitScript(() => { Math.random = () => .5; }); await page.goto('/screen/sales?debug=1');
  const keys = await page.locator('.nexus-feed-item').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-route-key')));
  expect(keys).toHaveLength(5);
  await page.clock.runFor(13_600);
  const seen = [await page.locator('.nexus-feed-item[aria-pressed="true"]').getAttribute('data-route-key')];
  for (let i = 1; i < 5; i++) { await page.clock.runFor(13_500); seen.push(await page.locator('.nexus-feed-item[aria-pressed="true"]').getAttribute('data-route-key')); }
  expect(seen).toEqual(keys);
});
test('actual numeric snapshot change has one bounded tween and correct final measurement', async ({ page, request }) => {
  await page.clock.install({ time: new Date('2026-10-14T02:30:00Z') }); await page.clock.pauseAt(new Date('2026-10-14T02:30:00Z'));
  await page.goto('/screen/sales?debug=1'); await page.clock.runFor(2600);
  const old = await page.locator('.nexus-money-number').first().textContent();
  await request.get('http://127.0.0.1:3199/control?exceeded=1');
  const response = page.waitForResponse(r => r.request().method() === 'POST'); await page.clock.runFor(57_450); await response;
  // A unit change remounts instead of mixing the old 万 suffix with the new 亿 value.
  await expect(page.locator('.nexus-money-number').first()).not.toHaveText(old!);
  const rate = page.locator('.nexus-contract-stats > div:nth-child(2) [data-motion-number]');
  await expect(rate).toHaveAttribute('data-motion-number-active', 'true');
  await page.clock.runFor(400);
  const middle = Number((await rate.textContent())!.replace('%', ''));
  expect(middle).toBeGreaterThan(85.7); expect(middle).toBeLessThan(1234.5);
  await page.clock.runFor(700); await expect(page.locator('[data-motion-number-active="true"]')).toHaveCount(0);
  await expect(page.locator('.nexus-money-hero')).toHaveAttribute('data-fit-ellipsis', 'false');
  await expect(page.getByText('1234.5%')).toBeVisible();
  const text = await page.locator('.nexus-money-hero').textContent(); await page.clock.runFor(5000);
  await expect(page.locator('.nexus-money-hero')).toHaveText(text!);
});
