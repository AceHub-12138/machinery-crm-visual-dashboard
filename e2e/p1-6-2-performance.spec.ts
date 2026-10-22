/* eslint-disable @typescript-eslint/no-explicit-any -- isolated timing probe, not application APIs */
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { startVoiceHub, type VoiceHubServer } from "../services/voice-orchestrator/src/ws/ws-server";
import { task12Card } from "./task12-fixtures";
import { PARTICLE_BUDGET, DPR_CAP, RESOLUTION_SCALE } from "../src/lib/voice/params";
let hub: VoiceHubServer;
test.beforeAll(async () => { hub = await startVoiceHub({ host: "127.0.0.1", port: 0, onMessage: (conn, raw) => { if (JSON.parse(raw).type === "console.hello") conn.role = "screen"; } }); });
test.afterAll(async () => { await hub.close(); });
const root = process.env.P162_PERF_ROOT ?? path.resolve(".review/p1-6-2/performance"), label = process.env.P162_PERF_LABEL ?? "control";
for (const round of [1, 2, 3].filter(value => !process.env.P162_ROUND || value === Number(process.env.P162_ROUND))) for (const width of [1920, 1280]) for (const mode of (round % 2 ? ["legacy", "gsap"] : ["gsap", "legacy"])) {
  test(`${round} ${width} ${mode} matched phase`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: width * 9 / 16 }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
    await context.addInitScript(() => {
      let seed = 713; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const native = requestAnimationFrame.bind(window);
      const probe: any = { callbacks: [], frames: [], visualCompleteAt: null, registrations: [] };
      Object.assign(window, { __p162Raf: probe });
      window.requestAnimationFrame = callback => {
        const at = performance.now();
        const id = native(timestamp => {
          const start = performance.now();
          try { callback(timestamp); } finally { probe.callbacks.push({ timestamp, start, ms: performance.now() - start, queueMs: start - timestamp }); }
        });
        probe.registrations.push(performance.now() - at); return id;
      };
      let last = 0;
      const observe = (now: number) => { if (last) probe.frames.push({ at: now, ms: now - last }); last = now;
        if (!probe.visualCompleteAt && document.querySelector('.overlay-card-body[data-spoken-complete="true"]')) probe.visualCompleteAt = performance.now();
        native(observe);
      }; native(observe);
    });
    const page = await context.newPage();
    await page.goto(`/screen/sales?voiceLive=1&xiaochuanMotion=${mode}&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);
    await expect.poll(() => hub.counts().screens).toBe(1); await page.waitForTimeout(1000);
    const cdp = await context.newCDPSession(page); await cdp.send("Performance.enable");
    const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(item => [item.name, item.value]));
    const windows: any[] = [];
    const sample = async (name: string, duration: number) => {
      const before = await metrics(), start = await page.evaluate(() => performance.now());
      await page.waitForTimeout(duration); const end = await page.evaluate(() => performance.now()), after = await metrics();
      windows.push({ name, start, end, before, after });
    };
    await sample("baseline", 2500);
    hub.broadcast({ type: "session.start", at: Date.now(), sessionId: "p162-perf" });
    hub.broadcast({ type: "state.change", at: Date.now(), from: "waking", to: "listening", turn: 0 });
    await expect(page.locator(".overlay-root")).toHaveAttribute("data-motion", mode);
    if (process.env.P162_EARLY !== "1") await page.waitForTimeout(1000);
    const fixture = task12Card("region_shipments", "normal");
    hub.broadcast({ type: "state.change", at: Date.now(), from: "listening", to: "thinking", turn: 0 });
    hub.broadcast({ type: "answer.delta", at: Date.now(), seq: 0, text: fixture.spoken, full: true, card: fixture });
    hub.broadcast({ type: "state.change", at: Date.now(), from: "thinking", to: "answering", turn: 0 });
    await expect(page.locator(".overlay-card")).toHaveCount(1);
    const launchAt = Number(await page.locator(".overlay-card").getAttribute("data-launch-at"));
    await sample("transient", 2500);
    const steadyAt = launchAt + Math.max(3500, 650 + fixture.spoken.length / 26 * 1000 + 1000);
    await page.waitForTimeout(Math.max(0, steadyAt - await page.evaluate(() => performance.now())));
    await sample("settled", 2500);
    const raw = await page.evaluate(() => ({ raf: (window as any).__p162Raf, profile: (window as any).__p162Profile ?? null,
      dpr: devicePixelRatio, canvas: [...document.querySelectorAll("canvas")].map(c => ({ width: c.width, height: c.height })) }));
    expect(Boolean(raw.profile)).toBe(process.env.P162_EXPECT_PROFILE === "1");
    const session = await browser.newBrowserCDPSession(); const gpu = await session.send("SystemInfo.getInfo"); await session.detach();
    const file = path.join(root, label, `r${round}-${width}-${mode}.json`); mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ round, width, mode, label, launchAt, earlyAnswer: process.env.P162_EARLY === "1", fixture, seed: 713, windows,
      browser: browser.version(), gpu, constants: { PARTICLE_BUDGET, DPR_CAP, RESOLUTION_SCALE, tickerCapHz: 60 }, raw }));
    expect(raw.raf.callbacks.filter((sample: any) => sample.start >= windows[2].start && sample.start < windows[2].end).length).toBeGreaterThan(30);
    await context.close();
  });
}
