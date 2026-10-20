import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => { await request.get('http://127.0.0.1:3199/control?reset=1'); });

for (const engine of ['legacy', 'gsap']) test(`historical external URL falls back to protected baseline: ${engine}`, async ({ page }) => {
  await page.goto(`/screen/sales?debug=1&motion=${engine}&qualityExperiment=external`);
  const stage = page.locator('#screen-stage'), debug = page.locator('.nexus-motion-debug');
  await expect(stage).toHaveAttribute('data-motion-engine', engine);
  await expect(debug).toHaveAttribute('data-quality-automation', 'baseline');
  await page.getByRole('button', { name: '强制低档' }).click();
  await expect(stage).toHaveAttribute('data-motion-level', 'low');
  await page.getByRole('button', { name: '触发共振' }).click();
  await expect(stage).not.toHaveAttribute('data-motion-state', 'PULSE');
  await page.getByRole('button', { name: '恢复自动档' }).click();
  await expect(stage).toHaveAttribute('data-motion-level', 'normal');
  await page.getByRole('button', { name: '模拟小川唤醒' }).click();
  await expect(debug).toHaveAttribute('data-paused', 'true');
  await page.getByRole('button', { name: '模拟小川退出' }).click();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(debug).toHaveAttribute('data-paused', 'true');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(stage).toHaveAttribute('data-motion-level', 'static');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(stage).toHaveAttribute('data-motion-level', 'normal');
  if (engine === 'gsap') {
    const audit = JSON.parse((await page.locator('[data-gsap-audit]').textContent())!);
    expect(audit.liveScenes).toBe(1); expect(audit.rootAnimations).toBe(0);
  }
});

test('default debug route retains the P1.4 automatic quality policy', async ({ page }) => {
  await page.goto('/screen/sales?debug=1&motion=legacy');
  await expect(page.locator('.nexus-motion-debug')).toHaveAttribute('data-quality-automation', 'baseline');
});
