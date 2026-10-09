import { test, expect, type Page } from "@playwright/test";
import { startVoiceHub, type VoiceHubServer } from "../services/voice-orchestrator/src/ws/ws-server";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(readFileSync(new URL("../services/voice-orchestrator/fixtures/public-sales-screen.json", import.meta.url), "utf8"));
import { validatePublicPayload } from "../src/lib/voice/public-payload";
import { buildIntentAnswer } from "../src/lib/voice/intent-answers";
import { task12Card } from "./task12-fixtures";
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
  await expect(page.locator(`[data-card-kind="${card.kind}"] .overlay-card-data`)).toBeVisible();
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
    await expect(page.locator(".overlay-card-data")).toContainText("点位为样本");
    await expect(page.locator(".overlay-map-point")).toHaveCount(1);
    const spills = await page.locator(".overlay-card-data").evaluate(el => {
      const box = el.getBoundingClientRect();
      return [...el.querySelectorAll<HTMLElement>("*")].filter(node => !(node instanceof SVGElement) && node.childElementCount === 0 && node.textContent?.trim()).filter(node => node.scrollWidth > node.clientWidth + 1 || node.getBoundingClientRect().bottom > box.bottom + 1).map(node => node.textContent);
    });
    expect(spills).toEqual([]);
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
