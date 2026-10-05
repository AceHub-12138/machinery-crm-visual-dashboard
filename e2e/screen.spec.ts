import { test, expect, type Page } from "@playwright/test";

const layout = {
  kpi: [14, 102, 360, 838], map: [388, 102, 880, 838],
  collection: [1282, 102, 624, 441], reminders: [1282, 557, 624, 383],
  delivery: [14, 954, 1892, 112],
};
async function assertLayout(page: Page) {
  const stage = await page.locator("#screen-stage").boundingBox();
  expect(stage).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  for (const [panel, [x, y, width, height]] of Object.entries(layout)) {
    expect(await page.locator(`[data-screen-panel="${panel}"]`).boundingBox(), panel).toEqual({ x, y, width, height });
  }
}

test("1920×1080 面板尺寸、间距和首屏内容回归", async ({ page }, testInfo) => {
  await page.goto("/screen/sales?fit=0");
  await expect(page.getByRole("heading", { name: "经营指挥舱" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await assertLayout(page);
  await page.evaluate(() => document.querySelectorAll("svg").forEach((svg) => svg.pauseAnimations()));
  await page.screenshot({ path: testInfo.outputPath("screen-sales.png"), animations: "disabled" });
});

test("公开 API 与首屏 HTML 不携带客户、跟进、业务员及详细地址", async ({ request }) => {
  for (const url of ["/api/screen/crm", "/screen/sales?voiceDemo=1"]) {
    const response = await request.get(url);
    expect(response.ok()).toBe(true);
    expect(await response.text()).not.toMatch(/companyName|recentFollows|salesUserName|上海精工传动|紫竹科学园区/);
  }
});

test("列宽改变 5px 会被几何验收发现", async ({ page }) => {
  await page.goto("/screen/sales?fit=0");
  await assertLayout(page);
  await page.addStyleTag({ content: "#screen-stage > .grid { grid-template-columns: 365px 880px minmax(0,1fr) !important; }" });
  await expect(assertLayout(page)).rejects.toThrow();
});

test("1280×720 自适应保持完整画布", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/screen/sales");
  await expect.poll(async () => (await page.locator("#screen-stage").boundingBox())?.width).toBe(1280);
  const bounds = await page.locator("#screen-stage").boundingBox();
  expect(bounds?.height).toBe(720);
  expect(bounds?.x).toBe(0);
  expect(bounds?.y).toBe(0);
});
