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


test("negative metrics stay pending after a screen refresh at both sizes", async ({ page }) => {
  const p = validatePublicPayload(structuredClone(fixture));
  p.kpis.periodContractAmount = "-98765"; p.kpis.periodNewContracts = -98765; p.kpis.totalCustomers = -98765;
  p.collection.totalPaidAmount = "-98765"; p.collection.totalUnpaidAmount = "-98765";
  p.delivery.summary.unitCount = -98765; p.delivery.summary.shipmentCount = -98765; p.delivery.summary.regionCount = 1;
  p.delivery.regionUnits = [{ province: "山东省", unitCount: -98765, shipmentCount: -98765 }];
  p.delivery.unresolvedRegionTotals = { unitCount: 0, shipmentCount: 0 };
  p.delivery.summary.todayDue = -98765; p.delivery.milestones[0].unitCount = -98765;
  const screen = fromPublicSalesScreenPayload(p);
  await page.route("**/api/screen/crm", route => route.fulfill({ json: screen }));
  await page.clock.install();
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 3840, height: 2160 }]) {
    await page.setViewportSize(viewport); await page.goto("/screen/sales");
    await expect(page.getByRole("heading", { name: "经营指挥舱" })).toBeVisible();
    await expect(page.locator("#screen-stage")).toHaveAttribute("style", /scale/);
    await page.clock.fastForward(61_000);
    await expect(page.locator("[data-screen-panel=kpi]")).toContainText("数据待核对");
    for (const panel of ["kpi", "map", "collection", "reminders", "delivery"]) {
      await expect(page.locator(`[data-screen-panel=${panel}]`)).toContainText("数据待核对");
      await expect(page.locator(`[data-screen-panel=${panel}]`)).not.toContainText("98765");
    }
    await expect(page.locator(".collection-track")).toHaveCount(0);
    for(const selector of [".kpi-hero .fit-text", ".ring-box .fit-text"]) {
      const pending=page.locator(selector);await expect(pending).toHaveText("数据待核对");
      const measure=await pending.evaluate(el=>{
        const css=getComputedStyle(el);const range=document.createRange();range.selectNodeContents(el);
        const rects=[...range.getClientRects()].filter(r=>r.width>0);const box=el.getBoundingClientRect();
        return {font:parseFloat(css.fontSize),nowrap:css.whiteSpace,singleLine:Math.max(...rects.map(r=>r.top))<Math.min(...rects.map(r=>r.bottom)),contained:rects.every(r=>r.left>=box.left-1 && r.right<=box.right+1)};
      });
      expect(measure.font).toBeGreaterThanOrEqual(18);expect(measure.nowrap).toBe("nowrap");expect(measure.singleLine).toBe(true);expect(measure.contained).toBe(true);
    }
    const spills = await page.locator("#screen-stage").evaluate(el => [...el.querySelectorAll<HTMLElement>("p, span")].filter(node => !node.closest(".sr-only") && node.childElementCount === 0 && node.textContent?.includes("数据待核对") && node.scrollWidth > node.clientWidth + 1).map(node => ({text: node.textContent, className: node.className})));
    expect(spills).toEqual([]);
    expect(await auditText(page,"#screen-stage")).toEqual([]);
    await page.screenshot({ path: `docs/screen-data-repair-evidence/screen-negative-${viewport.width}.png`, animations: "disabled" });
  }
});
