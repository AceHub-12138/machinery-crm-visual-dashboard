import { test, expect } from "@playwright/test";
import { auditText, auditPanels } from "./layout-audit";
import { longScreenPayload } from "./fixtures/long-strings";
for (const viewport of [{width:1280,height:720},{width:1920,height:1080},{width:3840,height:2160}]) {
  test(`${viewport.width} base content has no clipping or overlapping panels`, async ({page}, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/screen/sales?fit=1");
    await page.evaluate(()=>document.fonts.ready);
    expect(await auditText(page)).toEqual([]);
    expect(await auditPanels(page)).toEqual([]);
    if(viewport.width===1920) await page.screenshot({path:info.outputPath("default-screen.png")});
  });
  for(const amount of [987654321,123456789.5,0,-1234567]) test(`${viewport.width} long strings amount ${amount}`, async ({page}) => {
    await page.setViewportSize(viewport);
    await page.clock.install();
    await page.route("**/api/screen/crm", route=>route.fulfill({json:longScreenPayload(amount,60)}));
    await page.goto("/screen/sales?fit=1");
    await page.clock.fastForward(60001);
    await expect(page.locator(".kpi-hero")).toContainText(amount===987654321 ? "9.88" : amount===123456789.5 ? "1.23" : amount===0 ? "¥0" : "-123.5");
    await page.evaluate(()=>document.fonts.ready);
    expect(await auditText(page)).toEqual([]);
    expect(await auditPanels(page)).toEqual([]);
  });
}
test("audit detects visible, inline and fixed overflow; accepts only compensated clipping", async ({page}) => {
  await page.goto("/screen/sales");
  await page.evaluate(()=>{
    const root=document.createElement("div");root.id="audit-probe";root.style.cssText="position:fixed;left:20px;top:20px;width:100px;font-size:20px";
    root.innerHTML='<div style="width:30px;overflow:visible;white-space:nowrap"><span>这是故意撑破的文字</span></div><div style="position:fixed;width:30px;overflow:hidden;white-space:nowrap">固定位置溢出</div><div hidden>隐藏文字不能误报</div><span class="sr-only">读屏专用文字</span><div class="clip-1" title="合法补偿的长文字" style="width:30px">合法补偿的长文字</div><div class="clip-1" style="width:30px">没有补偿的长文字</div>';
    document.body.append(root);
  });
  const findings=await auditText(page,"#audit-probe");
  expect(findings.some(f=>f.text.includes("故意撑破"))).toBe(true);
  expect(findings.some(f=>f.text.includes("固定位置"))).toBe(true);
  expect(findings.some(f=>f.text.includes("没有补偿"))).toBe(true);
  expect(findings.some(f=>f.text.includes("隐藏") || f.text.includes("读屏") || f.text.includes("合法补偿"))).toBe(false);
});
test("audit detects a panel overlap without changing its size assertion", async({page})=>{
  await page.goto("/screen/sales");
  await page.addStyleTag({content:'[data-screen-panel="map"] { transform:translateX(-20px); }'});
  expect(await auditPanels(page)).toContain("kpi overlaps map");
});
