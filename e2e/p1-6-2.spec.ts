import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { startVoiceHub, type VoiceHubServer } from "../services/voice-orchestrator/src/ws/ws-server";
import type { AnswerCardData } from "../src/lib/voice/session-machine";
const pcm = [0, 1].map(index => readFileSync(`docs/nexus-p1-6/audio/${index}.pcm`));
const first = "本期新增客户十二家。", second = "客户总数为一百二十家。";
const card: AnswerCardData = { kind: "brief", title: "读屏与可见正文隔离验收", lines: [], spoken: first + second };
let hub: VoiceHubServer, failed = false, turn = 0;
const reports: string[] = [];
const emit = (event: object) => hub.broadcast({ at: Date.now(), ...event });
const state = (from: string, to: string) => emit({ type: "state.change", from, to, turn });
test.beforeAll(async () => {
  hub = await startVoiceHub({ host: "127.0.0.1", port: 0,
    onHttpRequest: (req, res) => {
      res.setHeader("access-control-allow-origin", String(req.headers.origin ?? "*"));
      res.setHeader("access-control-expose-headers", "x-sample-rate,x-channels,x-sample-format");
      const index = Number(/\/voice\/audio\/[^/]+\/(\d+)$/.exec(req.url ?? "")?.[1]);
      if (failed || !pcm[index]) { res.writeHead(503); res.end(); return; }
      res.writeHead(200, { "content-type": "audio/pcm", "x-sample-rate": "24000", "x-channels": "1", "x-sample-format": "s16le" }); res.end(pcm[index]);
    },
    onMessage: (conn, raw) => {
      const event = JSON.parse(raw); if (event.type === "console.hello") conn.role = "screen";
      if (event.type.startsWith("playback.")) reports.push(event.type);
      if (event.type === "playback.drained") state("answering", "followup");
    },
  });
});
test.afterAll(async () => { await hub.close(); });
test.beforeEach(() => { failed = false; turn = 0; reports.length = 0; });
declare global { interface Window { p162Notices: Array<{ text: string; at: number }> } }
async function open(page: Page, mode: string, reduced = false, owner = true) {
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await page.addInitScript(() => {
    window.p162Notices = [];
    new MutationObserver(records => {
      for (const region of document.querySelectorAll(".overlay-card [aria-live]")) {
        if (records.some(record => record.target === region || region.contains(record.target))) window.p162Notices.push({ text: region.textContent ?? "", at: performance.now() });
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.goto(`/screen/sales?voiceLive=1&xiaochuanMotion=${mode}&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);
  await expect.poll(() => hub.counts().screens).toBe(1); await page.mouse.click(40, 40);
  emit({ type: "session.start", sessionId: "p162-a11y", ...(owner ? {} : { screenId: "00000000-0000-4000-8000-999999999999" }) }); state("waking", "listening");
  await expect(page.locator(".overlay-root")).toHaveAttribute("data-motion", mode);
}
async function answer(page: Page, value = card, speech = false) {
  state("listening", "thinking"); turn++;
  emit({ type: "answer.delta", seq: 0, full: true, text: value.spoken, card: value, ...(speech ? { speech: { turnId: `00000000-0000-4000-8000-${String(turn).padStart(12, "0")}`, sentences: [{ index: 0, displayStart: 0, displayEnd: first.length }, { index: 1, displayStart: first.length, displayEnd: card.spoken.length }] } } : {}) });
  state("thinking", "answering"); await expect(page.locator(".overlay-root")).toHaveAttribute("data-state", "answering");
}
async function notices(page: Page) { return page.evaluate(() => window.p162Notices.filter(item => item.text).map(item => item.text)); }
for (const mode of ["legacy", "gsap"]) {
  test(`${mode} visible full text and complete-sentence compatibility notifications stay independent`, async ({ page }) => {
    await open(page, mode); await answer(page);
    if (mode === "gsap") await expect(page.locator(".overlay-card-spoken")).toHaveText(card.spoken, { timeout: 1000 });
    await expect(page.locator(".overlay-card [aria-live]")).toHaveText(first);
    await expect(page.locator(".overlay-card [aria-live]")).toHaveText(second);
    expect(await notices(page)).toEqual([first, second]);
  });
  for (const reduced of [false, true]) test(`${mode} PCM completion owns notifications with reduced=${reduced}`, async ({ page }) => {
    await open(page, mode, reduced); await answer(page, card, true);
    await expect(page.locator(".overlay-sentence-active")).toHaveText(first);
    expect(await notices(page)).toEqual([]);
    await expect(page.locator(".overlay-sentence-active")).toHaveText(second, { timeout: 7000 });
    await expect(page.locator(".overlay-card [aria-live]")).toHaveText(first);
    await expect.poll(() => reports.includes("playback.drained"), { timeout: 10000 }).toBe(true);
    await expect(page.locator(".overlay-card [aria-live]")).toHaveText(second);
    expect(await notices(page)).toEqual([first, second]);
  });
  test(`${mode} interruption, replacement and folding never republish the old answer`, async ({ page }) => {
    await open(page, mode); await answer(page); state("answering", "listening");
    await page.waitForTimeout(300);
    const next: AnswerCardData = { kind: "brief", title: "新回答", lines: [], spoken: "这是新的完整回答。下一句也必须等到时机。" };
    const before = (await notices(page)).length;
    await answer(page, next); await expect(page.locator(".overlay-card [aria-live]")).toHaveText("这是新的完整回答。");
    state("answering", "closing"); await expect(page.locator(".overlay-root")).toHaveCount(0);
    await page.waitForTimeout(700);
    expect((await notices(page)).slice(before)).toEqual(["这是新的完整回答。"]);
  });
  test(`${mode} unavailable audio keeps safe complete notifications and reduced text access`, async ({ page }) => {
    failed = true; await open(page, mode); await answer(page, card, true);
    await expect(page.locator(".overlay-audio-notice")).toContainText("查看卡片");
    await expect(page.locator(".overlay-card [aria-live]")).toHaveText(first);
    await expect(page.locator(".overlay-card [aria-live]")).toHaveText(second);
    expect(await notices(page)).toEqual([first, second]);
  });
  test(`${mode} passive screen with metadata but no local PCM retains safe accessibility`, async ({ page }) => {
    await open(page, mode, false, false); await answer(page, card, true);
    await expect(page.locator(".overlay-card [aria-live]")).toHaveText(first);
    await expect(page.locator(".overlay-card [aria-live]")).toHaveText(second);
    expect(await notices(page)).toEqual([first, second]);
    expect(reports.includes("playback.started")).toBe(false);
  });
}
