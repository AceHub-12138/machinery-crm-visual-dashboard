import { test, expect } from '@playwright/test';
import { LONG_MODEL } from './fixtures/long-strings';
import { auditText, auditPanels } from './nexus-layout-audit';
import { longNexusPayload, nexusPayload, setNexusPayload, SCREEN_VIEWPORTS, screenUrl, settle } from './nexus-test-data';
for (const viewport of SCREEN_VIEWPORTS) {
  test(`${viewport.width} base content has no clipping or overlapping panels`, async ({ page, request }) => {
    await page.setViewportSize(viewport); await setNexusPayload(request, nexusPayload());
    await page.goto(screenUrl(viewport.width)); await settle(page);
    expect(await auditText(page)).toEqual([]); expect(await auditPanels(page)).toEqual([]);
  });
  for (const [amount, expected] of [[987654321, '¥9.88亿'], [123456789.5, '¥1.23亿'], [0, '¥0'], [-1234567, '数据待核对']] as const) test(`${viewport.width} long strings amount ${amount}`, async ({ page, request }) => {
    await page.setViewportSize(viewport); await setNexusPayload(request, longNexusPayload(amount));
    await page.goto(screenUrl(viewport.width)); await page.evaluate(() => document.fonts.ready);
    const hero = page.locator('.nexus-money-hero');
    if (amount < 0) await expect(hero).toHaveText(expected);
    else { await expect(hero).toHaveText(expected); await expect(hero).toHaveAttribute('data-fit-ellipsis', 'false'); }
    await expect(page.locator('.nexus-model')).toHaveText(Array(5).fill(LONG_MODEL));
    expect(await auditText(page)).toEqual([]); expect(await auditPanels(page)).toEqual([]);
  });
  test(`${viewport.width} maximum digit count with thousands separators stays on one line`, async ({ page, request }) => {
    const p = nexusPayload(); p.kpis.totalCustomers = 9999999999; p.kpis.periodContractAmount = '99999999.99';
    await page.setViewportSize(viewport); await setNexusPayload(request, p); await page.goto(screenUrl(viewport.width)); await settle(page);
    const number = page.locator('.nexus-metrics > div').nth(1).locator('.nexus-customer-count');
    await expect(number).toHaveText('9,999,999,999'); await expect(number).toHaveAttribute('data-fit-ellipsis','false');
    await expect(page.locator('.nexus-money-hero')).toHaveText('¥10,000.0万');
    await expect(page.locator('.nexus-money-hero')).toHaveAttribute('data-fit-ellipsis', 'false');
    const lines = await number.evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); const rects = [...range.getClientRects()].filter(r => r.width); return { one: Math.max(...rects.map(r => r.top)) < Math.min(...rects.map(r => r.bottom)), contained: el.scrollWidth <= el.clientWidth + 1 }; });
    expect(lines).toEqual({ one: true, contained: true });
    expect(await auditText(page)).toEqual([]); expect(await auditPanels(page)).toEqual([]);
  });
}
test("audit detects visible, inline and fixed overflow; accepts only compensated clipping", async ({page}) => {
  await page.goto("/screen/sales");
  await page.evaluate(()=>{
    const root=document.createElement("div");root.id="audit-probe";root.style.cssText="position:fixed;left:20px;top:20px;width:100px;font-size:20px";
    root.innerHTML='<div style="width:30px;overflow:visible;white-space:nowrap"><span>这是故意撑破的文字</span></div><div style="position:fixed;width:30px;overflow:hidden;white-space:nowrap">固定位置溢出</div><div hidden>隐藏文字不能误报</div><span class="sr-only">读屏专用文字</span><div class="clip-1" title="合法补偿的长文字" style="width:30px">合法补偿的长文字</div><div class="clip-1" style="width:30px">没有补偿的长文字</div><div style="width:30px"><span title="行内伪裁剪" aria-label="行内伪裁剪" style="display:inline;width:30px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">行内伪裁剪</span></div>';
    document.body.append(root);
  });
  const findings=await auditText(page,"#audit-probe");
  expect(findings.some(f=>f.text.includes("故意撑破"))).toBe(true);
  expect(findings.some(f=>f.text.includes("固定位置"))).toBe(true);
  expect(findings.some(f=>f.text.includes("没有补偿"))).toBe(true);
  expect(findings.some(f=>f.text.includes("行内伪裁剪"))).toBe(true);
  expect(findings.some(f=>f.text.includes("隐藏") || f.text.includes("读屏") || f.text.includes("合法补偿"))).toBe(false);
});
test("audit detects a panel overlap without changing its size assertion", async({page})=>{
  await page.goto("/screen/sales");
  await page.addStyleTag({content:'[data-screen-panel="map"] { transform:translateX(-80px); }'});
  expect(await auditPanels(page)).toContain("kpi overlaps map");
});
