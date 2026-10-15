import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { startVoiceHub, type VoiceHubServer } from "../services/voice-orchestrator/src/ws/ws-server";
let hub: VoiceHubServer;
test.beforeAll(async () => { hub = await startVoiceHub({ host: "127.0.0.1", port: 0, onMessage: (conn, raw) => { if (JSON.parse(raw).type === "console.hello") conn.role = "screen"; } }); });
test.afterAll(async () => { await hub.close(); });
async function verifyVoiceEntry(page: Page) {
  await expect.poll(() => hub.counts().screens).toBe(1);
  hub.broadcast({ type: "session.start", at: Date.now(), sessionId: "nexus-check" });
  hub.broadcast({ type: "state.change", at: Date.now(), from: "waking", to: "listening", turn: 0 });
  await expect(page.locator(".overlay-root")).toHaveAttribute("data-phase", "on");
  await page.keyboard.press("Escape");
  await expect(page.locator(".overlay-root")).toBeHidden();
}
const evidence = path.resolve(process.env.NEXUS_EVIDENCE_DIR ?? ".review/nexus-p2-a");
mkdirSync(evidence, { recursive: true });
async function audit(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  if (await page.locator(".nexus-money-hero").count()) await expect(page.locator(".nexus-money-hero")).toHaveAttribute("data-fit-ellipsis", "false");
  await expect(page.locator('.nexus-money[data-fit-ellipsis="true"]')).toHaveCount(0);
  const result = await page.evaluate(() => {
    const root = document.querySelector("#screen-stage")!.getBoundingClientRect();
    const failures: string[] = [];
    for (const node of document.querySelectorAll("#screen-stage *")) {
      if (node.closest("svg") || node.tagName === "BUTTON") continue;
      const el = node as HTMLElement, style = getComputedStyle(el);
      const direct = [...el.childNodes].some(c => c.nodeType === Node.TEXT_NODE && c.textContent?.trim());
      if (!direct) continue;
      const rect = el.getBoundingClientRect();
      if (rect.left < root.left - 1 || rect.right > root.right + 1 || rect.top < root.top - 1 || rect.bottom > root.bottom + 1) failures.push(`outside: ${el.textContent}`);
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) failures.push(`overflow: ${el.textContent} ${el.clientWidth}x${el.clientHeight}/${el.scrollWidth}x${el.scrollHeight}`);
      const islandCaption = el.matches(".nexus-islands > p, .nexus-province-label");
      if (islandCaption && (parseFloat(style.fontSize) !== 14 || style.color !== "rgb(138, 147, 160)")) failures.push("island caption exception invalid");
      const localSubtitle = el.matches(".nexus-local-units");
      if (localSubtitle && (style.fontSize !== "13px" || style.color !== "rgb(238, 125, 44)" || style.opacity !== "0.85" || style.whiteSpace !== "nowrap" || style.webkitTextStrokeWidth !== "2px" || style.webkitTextStrokeColor !== "rgb(17, 21, 27)" || style.paintOrder !== "stroke")) failures.push("local subtitle style");
      if (parseFloat(style.fontSize) < (localSubtitle ? 13 : islandCaption ? 14 : 16)) failures.push(`font: ${el.textContent}`);
      if (el.classList.contains("nexus-money") && style.textOverflow === "ellipsis") failures.push(`ellipsis: ${el.textContent}`);
      const panel = el.closest('[data-screen-panel]');
      if (panel && !el.closest('.nexus-map') && !el.classList.contains("nexus-feed-index")) {
        const box = panel.getBoundingClientRect();
        if (rect.top < box.top - 1 || rect.bottom > box.bottom + 1) failures.push(`panel clipping: ${el.textContent}`);
      }
    }
    const inset = document.querySelector('.nexus-islands')?.getBoundingClientRect();
    return { failures, root: { width: root.width, height: root.height }, inset: inset ? { left: inset.left, top: inset.top, right: inset.right, bottom: inset.bottom } : null, animations: document.querySelector('#screen-stage')?.getAnimations({ subtree: true }).length };
  });
  writeFileSync(path.join(evidence, `${name}-audit.json`), JSON.stringify(result, null, 2));
  await page.screenshot({ path: path.join(evidence, `${name}.png`) });
  expect(result.failures).toEqual([]); expect(result.animations).toBe(0);
  if (result.inset) { expect(result.inset.bottom).toBeLessThanOrEqual(page.viewportSize()!.height); expect(result.inset.right).toBeLessThanOrEqual(page.viewportSize()!.width); }
}
test.beforeEach(async ({ request }) => { await request.get("http://127.0.0.1:3199/control?reset=1"); });
test("native mock and fixture, route linkage, and stale/unavailable transitions", async ({ page }) => {
  await page.goto(`/screen/sales?source=mock&voiceLive=1&lite=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);
  await expect(page.locator('#screen-stage')).toHaveAttribute('data-layout','led-1792x832');
  await audit(page, "1792-mock");
  await verifyVoiceEntry(page);
  await page.goto(`/screen/sales?voiceLive=1&lite=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);
  await expect(page.getByText("展厅演示数据")).toBeVisible();
  await audit(page, "1792-fixture");
  const row = page.locator('.nexus-feed-item').nth(2), key = await row.getAttribute('data-route-key');
  await row.click();
  await expect(page.locator(`.nexus-map-layer-0 [data-route-keys~="${key}"]`)).toHaveAttribute('data-route-bright', 'true');
  await expect(row).toHaveAttribute('aria-pressed','true');
  await verifyVoiceEntry(page);
  await page.clock.install({ time: new Date() });
  await page.clock.setFixedTime(new Date(Date.now() + 11 * 60_000));
  await expect(page.getByText(/数据更新于/)).toBeVisible();
  await audit(page, "1792-stale-10min");
  await verifyVoiceEntry(page);
  await page.clock.setFixedTime(new Date(Date.now() + 25 * 60 * 60_000));
  await expect(page.locator('.nexus-unavailable')).toHaveText("数据暂不可用");
  await audit(page, "1792-unavailable-24h");
  await verifyVoiceEntry(page);
});
test("backup 16x9 and 4x3 profiles retain full inset and readable data", async ({ page }) => {
  for (const [layout, width, height] of [["16x9",1920,1080],["4x3",1600,1200]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`/screen/sales?layout=${layout}&voiceLive=1&lite=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);
    await expect(page.locator('.nexus-islands-svg')).toBeVisible();
    await expect(page.locator('.nexus-money[data-fit-ellipsis="true"]')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    const box = await page.locator('.nexus-islands').boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(height); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await audit(page, `${width}-${layout}-fixture`);
    await verifyVoiceEntry(page);
  }
});
test("negative/null/no-target and overrun-large-money fixtures are readable", async ({ page, request }) => {
  await request.get("http://127.0.0.1:3199/control?negative=1");
  await page.goto(`/screen/sales?voiceLive=1&lite=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);
  await expect(page.locator('.nexus-money-hero')).toHaveText("数据待核对");
  await expect(page.locator(".nexus-unset").filter({ hasText: "未设定" })).toBeVisible();
  await audit(page, "1792-negative-null-no-target");
  await verifyVoiceEntry(page);
  await request.get("http://127.0.0.1:3199/control?reset=1&exceeded=1");
  await page.reload();
  await expect(page.getByText("1234.5%")).toBeVisible();
  await expect(page.locator('.nexus-overrun-triangle')).toBeVisible();
  await audit(page, "1792-exceeded-large-money");
  await verifyVoiceEntry(page);
});
test("60-second refresh retains the whole last successful snapshot offline", async ({ page, request }) => {
  await page.clock.install({ time: new Date() });
  await page.goto('/screen/sales');
  await expect(page.locator('.nexus-money-hero')).toHaveAttribute('data-fit-ellipsis', 'false');
  const first = await page.locator('.nexus-money-hero').textContent();
  await request.get('http://127.0.0.1:3199/control?offline=1');
  const requestDone = page.waitForResponse(r => r.request().method() === 'POST');
  await page.clock.runFor(60_100); await requestDone;
  await expect(page.locator('.nexus-money-hero')).toHaveText(first!);
  await request.get('http://127.0.0.1:3199/control?reset=1&negative=1');
  const replaced = page.waitForResponse(r => r.request().method() === 'POST');
  await page.clock.runFor(60_000); await replaced;
  await expect(page.locator('.nexus-money-hero')).toHaveText('数据待核对');
});

test("A5–A7 sanitized visual fields replay: full regions, grey target and city collision rules", async ({ page, request }) => {
  await request.get('http://127.0.0.1:3199/control?sanitizedVisual=1');
  for (const [layout, width, height] of [["led-1792x832",1792,832],["16x9",1920,1080],["4x3",1600,1200]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`/screen/sales?layout=${layout}`);
    await audit(page, `${width}-sanitized-fields-replay`);
    // 80 real shipments: local ones draw no line, the rest merge into 37 destination lines.
    await expect(page.locator('[data-route-baseline="true"]')).toHaveCount(37);
    await expect(page.locator('.nexus-ruler-fill')).toHaveCount(0);
    expect(await page.locator('.nexus-ruler-empty').evaluate(el => ({ text: el.textContent, color: getComputedStyle(el).color, border: getComputedStyle(el).borderTopColor }))).toEqual({ text: "", color: "rgb(138, 147, 160)", border: "rgb(138, 147, 160)" });
    expect(await page.locator('.nexus-unset').allTextContents()).toEqual(['未设定', '—']);
    expect(await page.locator('.nexus-unset').evaluateAll(els => els.every(el => getComputedStyle(el).color === 'rgb(138, 147, 160)'))).toBe(true);
    expect(await page.locator('.nexus-feed-region').allTextContents()).toEqual(['东北 · 辽宁省','华东 · 江苏省','华东 · 江苏省','华东 · 江苏省 · 南通市','华东 · 浙江省 · 绍兴市']);
    const failures = await page.evaluate(() => {
      const errors: string[] = [];
      for (const row of document.querySelectorAll('.nexus-feed-bottom')) {
        if (row.scrollWidth > row.clientWidth + 1) errors.push('feed overflow');
        const rects = [...row.children].map(el => el.getBoundingClientRect());
        if (rects.some(r => r.top !== rects[0].top)) errors.push('feed wrapped');
      }
      const labels = [...document.querySelectorAll('.nexus-city-label, .nexus-local-units')];
      const factory = document.querySelector('.nexus-factory-label')!;
      const provinces = [...document.querySelectorAll('.nexus-province-label')];
      for (const p of provinces) {
        if (Number(p.getAttribute('data-visible-fraction')) <= .6 || getComputedStyle(p).fontSize !== '14px' || getComputedStyle(p).color !== 'rgb(138, 147, 160)') errors.push('province rule');
        const a = p.getBoundingClientRect();
        for (const other of [...labels, factory, ...provinces.filter(q => q !== p)]) { const b = other.getBoundingClientRect(); if(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) errors.push('province collision'); }
      }
      if (factory.textContent !== '山东滕州') errors.push('factory missing');
      const subtitle = document.querySelector('.nexus-local-units')!;
      const a = subtitle.getBoundingClientRect(), f = factory.getBoundingClientRect();
      if (Math.abs(a.left - f.left) > .1 || a.top < f.bottom || a.top - f.bottom > 4) errors.push('subtitle alignment');
      const origin = document.querySelector<SVGCircleElement>('.nexus-origin-breath')!;
      const point = new DOMPoint(origin.cx.baseVal.value, origin.cy.baseVal.value).matrixTransform(origin.getScreenCTM()!);
      const nearestX = Math.max(a.left - point.x, 0, point.x - a.right);
      const nearestY = Math.max(a.top - point.y, 0, point.y - a.bottom);
      const scale = document.querySelector('#screen-stage')!.getBoundingClientRect().width / (document.querySelector('#screen-stage') as HTMLElement).offsetWidth;
      if (Math.hypot(nearestX, nearestY) <= 44 * scale) errors.push('subtitle covers maximum halo or route origin');
      for (let i = 0; i < labels.length; i++) {
        if (labels[i].matches('.nexus-city-label') && (labels[i].textContent!.endsWith('市') || getComputedStyle(labels[i]).fontSize !== '16px')) errors.push('city format');
        const a = labels[i].getBoundingClientRect();
        for (const other of [...labels.slice(i + 1), factory]) {
          const b = other.getBoundingClientRect();
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) errors.push('city collision');
        }
      }
      return errors;
    });
    expect(failures).toEqual([]);
  }
});

test("map frame stays in its column, 24px from panels, and below all headings", async ({ page, request }) => {
  await request.get('http://127.0.0.1:3199/control?sanitizedVisual=1');
  for (const [layout, width, height] of [["led-1792x832",1792,832],["16x9",1920,1080],["4x3",1600,1200]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`/screen/sales?layout=${layout}`);
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => {
      const frame = document.querySelector('.nexus-map-frame')!.getBoundingClientRect();
      const cell = document.querySelector('.nexus-map-cell')!.getBoundingClientRect();
      const heading = document.querySelector('.nexus-map-heading')!.getBoundingClientRect();
      const failures: string[] = [];
      if (frame.left < cell.left + 24 || frame.right > cell.right - 24 || frame.bottom > cell.bottom - 24) failures.push('column clearance');
      if (frame.top < heading.bottom) failures.push('map heading overlap');
      for (const el of document.querySelectorAll('.nexus-panel, .nexus-feed, .nexus-header, .nexus-title')) {
        const box = el.getBoundingClientRect();
        const dx = Math.max(box.left - frame.right, frame.left - box.right);
        const dy = Math.max(box.top - frame.bottom, frame.top - box.bottom);
        const title = el.matches('.nexus-title');
        if (title ? dx < 0 && dy < 0 : Math.max(dx, dy) < 24) failures.push(`overlap/clearance: ${el.textContent}`);
      }
      for (const svg of document.querySelectorAll('.nexus-map-frame > svg')) {
        const box = svg.getBoundingClientRect();
        if (box.left < frame.left || box.right > frame.right || box.top < frame.top || box.bottom > frame.bottom) failures.push('map layer outside frame');
      }
      const svg = document.querySelector<SVGSVGElement>('.nexus-map-layer-0')!;
      for (const dot of svg.querySelectorAll<SVGCircleElement>('.nexus-city-dot, .nexus-origin-breath')) {
        const point = new DOMPoint(dot.cx.baseVal.value, dot.cy.baseVal.value).matrixTransform(svg.getScreenCTM()!);
        if (Math.hypot((point.x - frame.left - frame.width / 2) / (frame.width / 2), (point.y - frame.top - frame.height / 2) / (frame.height / 2)) > .68) failures.push('endpoint outside 0.68 ellipse');
      }
      const national = document.querySelector('.nexus-minimap svg')!;
      if (!national.querySelector('[data-minimap-taiwan]') || national.querySelectorAll('[data-national-polygon]').length < 100) failures.push('national islands absent');
      if (!national.querySelector('[data-minimap-viewport]')) failures.push('viewport box absent');
      return { failures, frame: { left: frame.left, top: frame.top, width: frame.width, height: frame.height }, column: { left: cell.left, right: cell.right }, headingBottom: heading.bottom };
    });
    writeFileSync(path.join(evidence, `${width}-map-frame-audit.json`), JSON.stringify(result, null, 2));
    expect(result.failures).toEqual([]);
    await expect(page.locator('.nexus-islands-svg')).toBeVisible();
  }
});

test("P2 A native fixture screenshot and side-by-side design comparison", async ({ page, browser }) => {
  await page.goto("/screen/sales");
  await audit(page, "1792-fixture-final");
  await expect(page.locator(".nexus-seven-day")).toHaveText("7 日内待发 5 单");
  expect(await page.locator(".nexus-money-hero").evaluate(el => getComputedStyle(el).fontFamily)).not.toMatch(/Mono|Consolas|monospace/);
  await expect(page.locator('.nexus-model')).toHaveCount(5);
  for (const model of await page.locator('.nexus-model').all()) {
    const style = await model.evaluate(el => ({ size: getComputedStyle(el).fontSize, color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopWidth }));
    expect(style).toEqual({ size: "28px", color: "rgb(255, 255, 255)", background: "rgba(0, 0, 0, 0)", border: "0px" });
  }
  expect(await page.locator('[data-route-baseline="true"]').evaluateAll(els => els.every(el => el.getAttribute("stroke-opacity") === "0.4"))).toBe(true);
  await expect(page.locator('.nexus-money-hero')).toHaveText('¥68.4万');
  await expect(page.locator('.nexus-dial-progress')).toHaveAttribute('data-collection-rate', '69.9');
  expect(await page.locator('.nexus-islands-svg').evaluate(el => getComputedStyle(el).width)).toBe('110px');
  // Both panels are generated from the in-repository synthetic fixtures.
  const first = await page.screenshot();
  await page.goto('/screen/sales?source=mock'); await page.evaluate(() => document.fonts.ready);
  const second = await page.screenshot();
  const comparison = await browser.newPage({ viewport: { width: 3600, height: 900 }, deviceScaleFactor: 1 });
  await comparison.setContent(`<html lang="zh"><body style="margin:0;background:#111;color:white;display:flex;gap:8px"><section><h1>模拟共享快照回归</h1><img width="1792" height="832" src="data:image/png;base64,${first.toString('base64')}"></section><section><h1>内置模拟数据回归</h1><img width="1792" height="832" src="data:image/png;base64,${second.toString('base64')}"></section></body></html>`);
  await comparison.locator('img').last().evaluate(async el => { await (el as HTMLImageElement).decode(); });
  await comparison.screenshot({ path: path.join(evidence, 'nexus-synthetic-comparison.png') });
  await comparison.close();
});
