import { test, expect } from '@playwright/test';
import { auditText, auditPanels } from './nexus-layout-audit';
import { longNexusPayload, setNexusPayload, settle } from './nexus-test-data';
test('12 deliveries retain exactly the latest five records in the NEXUS feed', async ({ page, request }) => {
  const p = longNexusPayload(683927.41, 12);
  await setNexusPayload(request, p); await page.goto('/screen/sales'); await settle(page);
  const rows = page.locator('.nexus-feed-item'); await expect(rows).toHaveCount(5);
  expect(await rows.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-route-key')))).toEqual(['long-11','long-10','long-09','long-08','long-07']);
  const expected = p.delivery.routes.slice(-5).reverse();
  for (let i = 0; i < 5; i++) {
    await expect(rows.nth(i)).toContainText(expected[i].equipmentModel);
    await expect(rows.nth(i)).toContainText(`${expected[i].unitCount} 台`);
    await rows.nth(i).click(); await expect(rows.nth(i)).toHaveAttribute('aria-pressed', 'true');
  }
  const boxes = await rows.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().toJSON()));
  for (let i = 1; i < boxes.length; i++) { expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].right); }
  expect(boxes.map(b => b.width)).toEqual([331.1875,331.203125,331.203125,331.203125,331.203125]);
  expect(await auditText(page)).toEqual([]); expect(await auditPanels(page)).toEqual([]);
});
