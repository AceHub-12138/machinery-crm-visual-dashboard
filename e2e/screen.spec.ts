import { test, expect, type Page } from '@playwright/test';
import { nexusPayload, setNexusPayload, settle } from './nexus-test-data';
async function assertLayout(page: Page) {
  expect(await page.locator('#screen-stage').boundingBox()).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  const grid = await page.locator('.nexus-grid').evaluate(el => { const s = getComputedStyle(el); return { columns: s.gridTemplateColumns, columnGap: s.columnGap, rowGap: s.rowGap }; });
  expect(grid).toEqual({ columns: '470px 808px 470px', columnGap: '58px', rowGap: '16px' });
  for (const [selector, x, y, width, height] of [['.nexus-left',28,80,470,788],['.nexus-map-cell',556,80,808,788],['.nexus-right',1422,80,470,788],['.nexus-feed-cell',28,884,1864,180]] as const) expect(await page.locator(selector).boundingBox(), selector).toEqual({ x,y,width,height });
}
test.beforeEach(async ({ request }) => { await setNexusPayload(request, nexusPayload()); });
test('1920×1080 面板尺寸、间距和首屏内容回归', async ({ page }, info) => {
  await page.goto('/screen/sales?layout=16x9&fit=0'); await settle(page); await assertLayout(page);
  await expect(page.getByRole('heading', { name: '最新发货动态' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('screen-sales.png'), animations: 'disabled' });
});
test("公开 API 与首屏 HTML 不携带客户、跟进、业务员及详细地址", async ({ request }) => {
  for (const url of ["/api/screen/crm", "/screen/sales?voiceDemo=1"]) {
    const response = await request.get(url);
    expect(response.ok()).toBe(true);
    expect(await response.text()).not.toMatch(/companyName|recentFollows|salesUserName|上海精工传动|紫竹科学园区/);
  }
});

test('列宽改变 5px 会被几何验收发现', async ({ page }) => {
  await page.goto('/screen/sales?layout=16x9&fit=0'); await settle(page); await assertLayout(page);
  await page.addStyleTag({ content: '#screen-stage .nexus-grid { grid-template-columns: 475px 808px 470px !important; }' });
  await expect(assertLayout(page)).rejects.toThrow();
});
test('1280×720 自适应保持完整画布', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 }); await page.goto('/screen/sales?layout=16x9'); await settle(page);
  expect(await page.locator('#screen-stage').boundingBox()).toEqual({ x:0,y:0,width:1280,height:720 });
});
test('China occupies at least 75% of map width and lower-right HUD stays within 22%', async ({ page }) => {
  await page.goto('/screen/sales'); await settle(page);
  const m = await page.locator('.nexus-map').evaluate(el => {
    const panel=el.getBoundingClientRect(), frame=el.querySelector('.nexus-map-frame')!.getBoundingClientRect(), hud=el.querySelector('.nexus-islands')!.getBoundingClientRect();
    return { ratio: frame.width/panel.width, hudRatio:hud.width/panel.width, inside:frame.left>=panel.left && frame.right<=panel.right && hud.left>=panel.left && hud.right<=panel.right };
  });
  expect(m.ratio).toBeGreaterThanOrEqual(.75); expect(m.hudRatio).toBeLessThanOrEqual(.22); expect(m.inside).toBe(true);
});
