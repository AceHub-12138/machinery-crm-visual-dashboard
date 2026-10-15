import { test, expect, type Page } from "@playwright/test";
import { startVoiceHub, type VoiceHubServer } from "../services/voice-orchestrator/src/ws/ws-server";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(readFileSync(new URL("../services/voice-orchestrator/fixtures/public-sales-screen.json", import.meta.url), "utf8"));
import { validatePublicPayload } from "../src/lib/voice/public-payload";
import { fromPublicSalesScreenPayload } from "../src/lib/public-screen-payload";
import { buildIntentAnswer } from "../src/lib/voice/intent-answers";
import { task12Card } from "./task12-fixtures";
import { auditText } from "./layout-audit";
import type { AnswerCardData } from "../src/lib/voice/session-machine";

let hub: VoiceHubServer;
test.beforeAll(async () => {
  hub = await startVoiceHub({ host: "127.0.0.1", port: 0, onMessage: (conn, raw) => {
    if (JSON.parse(raw).type === "console.hello") conn.role = "screen";
  } });
});
test.afterAll(async () => { await hub?.close(); });
async function open(page: Page) {
  await page.goto(`/screen/sales?voiceLive=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);
  await expect.poll(() => hub.counts().screens).toBe(1);
  await page.mouse.click(40, 40);
  hub.broadcast({ type: "session.start", at: Date.now(), sessionId: "screen-data-check" });
  hub.broadcast({ type: "state.change", at: Date.now(), from: "waking", to: "listening", turn: 0 });
}
async function show(page: Page, card: AnswerCardData) {
  hub.broadcast({ type: "state.change", at: Date.now(), from: "listening", to: "thinking", turn: 0 });
  hub.broadcast({ type: "answer.delta", at: Date.now(), seq: 0, text: card.spoken, full: true, card });
  hub.broadcast({ type: "state.change", at: Date.now(), from: "thinking", to: "answering", turn: 0 });
  await expect(page.locator(`[data-card-kind="${card.kind}"] .overlay-card-body`)).toBeVisible();
}
test("missing targets and rates above 999 remain valid visible cards", async ({ page }) => {
  await open(page);
  const p = validatePublicPayload(structuredClone(fixture));
  p.collection.targetConfigured = false; p.collection.targetAmount = "0";
  for (const intent of ["sales_progress", "target_rate"] as const) {
    await show(page, buildIntentAnswer(intent, p).card);
    await expect(page.locator(".overlay-card-data")).toContainText("目标未设置");
    await expect(page.locator('[role="progressbar"], .overlay-ring-track')).toHaveCount(0);
    await expect(page.locator(".overlay-card-data")).not.toContainText("0%");
  }
  p.collection.targetConfigured = true; p.collection.targetAmount = "1000"; p.collection.targetRate = 1234.5;
  for (const intent of ["sales_progress", "target_rate"] as const) {
    const answer = buildIntentAnswer(intent, p); expect(answer.spoken).toContain("1234.5%");
    await show(page, answer.card);
    await expect(page.locator(".overlay-card-data")).toContainText(">999%");
  }
});
test("unresolved regions and full totals fit both viewports while points stay samples", async ({ page }) => {
  const p = validatePublicPayload(structuredClone(fixture));
  p.delivery.unresolvedRegionTotals = { shipmentCount: 2, unitCount: 7 };
  p.delivery.summary.unitCount += 7; p.delivery.summary.shipmentCount += 2;
  p.delivery.routes = p.delivery.routes.slice(0, 1);
  const card = buildIntentAnswer("region_shipments", validatePublicPayload(p)).card;
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport); await open(page); await show(page, card);
    await expect(page.locator(".overlay-card-data")).toContainText("地区待确认 · 7 台 / 2 单");
    await expect(page.locator(".overlay-card-data")).toContainText("仅标注部分地点");
    await expect(page.locator(".overlay-map-point")).toHaveCount(1);
    const spills = await page.locator(".overlay-card-data").evaluate(el => {
      const box = el.getBoundingClientRect();
      return [...el.querySelectorAll<HTMLElement>("*")].filter(node => !node.closest(".sr-only") && !(node instanceof SVGElement) && node.childElementCount === 0 && node.textContent?.trim()).filter(node => node.scrollWidth > node.clientWidth + 1 || node.getBoundingClientRect().bottom > box.bottom + 1).map(node => node.textContent);
    });
    expect(spills).toEqual([]);
    expect(await auditText(page,".overlay-card-data")).toEqual([]);
    const width = await page.locator(".overlay-card-row-mini > i").first().evaluate(el => el.style.width);
    expect(width).toBe("100%");
  }
});
test("shipment page freezes at playback end instead of resetting or cycling", async ({ page }) => {
  await open(page); await show(page, task12Card("upcoming_shipments", "long"));
  await expect(page.locator(".overlay-shipments-block")).toHaveAttribute("data-page", "2", { timeout: 6000 });
  hub.broadcast({ type: "state.change", at: Date.now(), from: "answering", to: "followup", turn: 0 });
  await expect(page.locator(".overlay-en")).toHaveText("Awaiting");
  const pageAtEnd = await page.locator(".overlay-shipments-block").getAttribute("data-page");
  await page.clock.install(); await page.clock.fastForward(12000);
  await expect(page.locator(".overlay-shipments-block")).toHaveAttribute("data-page", pageAtEnd!);
});


test("negative amount, count and units retain a visible pending card and safe speech", async ({ page }) => {
  await open(page);
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    for (const intent of ["sales_progress", "new_customers", "region_shipments"] as const) {
      const p = validatePublicPayload(structuredClone(fixture));
      p.kpis.periodUnpaidAmount = "-98765"; p.kpis.periodNewCustomers = -98765;
      p.delivery.summary.unitCount = -98765;
      const answer = buildIntentAnswer(intent, p);
      expect(answer.spoken).toContain("先生，数据待核对。");
      await show(page, answer.card);
      await expect(page.locator(".overlay-card-body")).toContainText("数据待核对");
      await expect(page.locator(".overlay-card-body")).not.toContainText("98765");
      const spills = await page.locator(".overlay-card-body").evaluate(el => [...el.querySelectorAll<HTMLElement>("*")].filter(node => !node.closest(".sr-only") && node.childElementCount === 0 && node.textContent?.trim() && node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
      expect(spills).toEqual([]);
      expect(await auditText(page,".overlay-card-body")).toEqual([]);
    }
  }
});


test("negative metrics stay pending after a screen refresh at both sizes", async ({ page, request }) => {
  const { nexusPayload, setNexusPayload, SCREEN_VIEWPORTS, screenUrl } = await import('./nexus-test-data');
  const { auditText: auditNexusText } = await import('./nexus-layout-audit');
  await page.clock.install();
  for (const viewport of SCREEN_VIEWPORTS) {
    const normal = nexusPayload(); await setNexusPayload(request, normal);
    await page.setViewportSize(viewport); await page.goto(screenUrl(viewport.width));
    await expect(page.locator('.nexus-money-hero')).toHaveAttribute('data-fit-ellipsis', 'false');
    const negative = nexusPayload();
    negative.kpis.periodContractAmount = '-987654.32'; negative.kpis.periodPaidAmount = '-987654.32';
    negative.kpis.periodNewContracts = -7; negative.kpis.totalCustomers = -7;
    negative.collection.totalPaidAmount = '-987654.32'; negative.collection.totalUnpaidAmount = '-987654.32';
    negative.delivery.summary.todayDue = -7; negative.delivery.summary.unitCount = -7;
    negative.delivery.summary.shipmentCount = -7; negative.delivery.summary.regionCount = 1;
    negative.delivery.regionUnits = [{ province: '山东省', unitCount: -7, shipmentCount: -7 }];
    negative.delivery.unresolvedRegionTotals = { unitCount: 0, shipmentCount: 0 };
    await setNexusPayload(request, negative);
    const response = page.waitForResponse(r => r.request().method() === 'POST');
    await page.clock.runFor(60_100); await response;
    for (const selector of ['.nexus-contract','.nexus-operations','.nexus-collection','.nexus-alerts']) {
      await expect(page.locator(selector)).toContainText('数据待核对'); await expect(page.locator(selector)).not.toContainText('-987654.32');
    }
    const primary = page.locator('.nexus-money-hero'); await expect(primary).toHaveText('数据待核对');
    const measured = await primary.evaluate(el => { const css=getComputedStyle(el), range=document.createRange(); range.selectNodeContents(el); const rects=[...range.getClientRects()].filter(r=>r.width), box=el.getBoundingClientRect();return {font:parseFloat(css.fontSize),nowrap:css.whiteSpace,singleLine:Math.max(...rects.map(r=>r.top))<Math.min(...rects.map(r=>r.bottom)),contained:rects.every(r=>r.left>=box.left-1 && r.right<=box.right+1)}; });
    expect(measured.font).toBeGreaterThanOrEqual(24); expect(measured.nowrap).toBe('nowrap'); expect(measured.singleLine).toBe(true); expect(measured.contained).toBe(true);
    expect(await auditNexusText(page)).toEqual([]);
  }
});
