import { test, expect } from "@playwright/test";
import { longScreenPayload } from "./fixtures/long-strings";
import { auditText, auditPanels } from "./layout-audit";
test("12 deliveries paginate evenly across a 112px timeline without losing rows",async({page})=>{
  await page.clock.install();await page.route("**/api/screen/crm",route=>route.fulfill({json:longScreenPayload(987654321,12)}));
  await page.goto("/screen/sales?fit=1");await page.clock.fastForward(60001);
  const strip=page.locator('[data-screen-panel="delivery"]');
  await expect(strip).toContainText("12 单");expect((await strip.boundingBox())?.height).toBe(112);
  const seen:number[]=[];
  for(const count of [5,5,2]) {
    await expect(strip.locator('.milestone-node')).toHaveCount(count);seen.push(await strip.locator('.milestone-node').count());
    const boxes=await strip.locator('.milestone-node').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));
    for(let i=1;i<boxes.length;i++) { expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i-1].right); expect(boxes[i].width).toBeCloseTo(boxes[0].width,0); }
    expect(await auditText(page)).toEqual([]);expect(await auditPanels(page)).toEqual([]);
    await page.getByRole('button',{name:'下一页交付里程碑'}).click();
  }
  expect(seen.reduce((sum,n)=>sum+n,0)).toBe(12);
});
