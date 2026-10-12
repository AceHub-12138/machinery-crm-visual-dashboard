import { test, expect } from "@playwright/test";
import { longScreenPayload } from "./fixtures/long-strings";
import { auditText } from "./layout-audit";
for(const reduced of ["reduce","no-preference"] as const) test(`reminder pages ${reduced}`,async({page})=>{
  await page.emulateMedia({reducedMotion:reduced});await page.clock.install();
  await page.route("**/api/screen/crm",route=>route.fulfill({json:longScreenPayload(987654321,15)}));
  await page.goto("/screen/sales?fit=1");await page.clock.fastForward(60001);
  const group=page.locator('[data-reminder="overdue"]');
  await expect(group).toContainText("+13");await expect(group.locator("li")).toHaveCount(2);
  await expect(group).toHaveAttribute("data-page","1");
  expect(await group.locator("li [title]").count()).toBe(4);
  await page.clock.fastForward(8001);
  await expect(group).toHaveAttribute("data-page",reduced==="reduce" ? "1" : "2");
  expect(await auditText(page)).toEqual([]);
});
