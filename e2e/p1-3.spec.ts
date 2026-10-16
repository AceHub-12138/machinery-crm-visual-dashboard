import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startVoiceHub, type VoiceHubServer } from '../services/voice-orchestrator/src/ws/ws-server';
import { task12Card } from './task12-fixtures';
import { nexusPayload, longNexusPayload, SCREEN_VIEWPORTS, screenUrl, setNexusPayload, settle } from './nexus-test-data';
import { auditText } from './nexus-layout-audit';

const baseline = process.env.P13_BASELINE === '1';
const output = path.resolve('.review/p1-3', baseline ? 'before' : 'after');
mkdirSync(output, { recursive: true });
let hub: VoiceHubServer;
test.beforeAll(async () => { hub = await startVoiceHub({ host: '127.0.0.1', port: 0, onMessage: (conn, raw) => { if (JSON.parse(raw).type === 'console.hello') conn.role = 'screen'; } }); });
test.afterAll(async () => { await hub?.close(); });

async function record(page: Page, name: string) {
  const result = await page.evaluate(() => {
    const box = (el: Element | null) => el ? el.getBoundingClientRect().toJSON() : null;
    const selectors = ['.overlay-card-body', '.overlay-card-header', '.overlay-card-data', '.overlay-shipment-badges', '.overlay-pages-window', '.overlay-shipment-caption', '.overlay-shipments-block > p', '.overlay-shipments-block > .overlay-page-dots', '.overlay-spoken-section', '.overlay-spoken-heading', '.overlay-followups', '.overlay-audio-notice', '.nexus-feed', '.nexus-feed > .nexus-title', '.nexus-feed-grid', '.nexus-feed-index'];
    const rects = Object.fromEntries(selectors.map(s => [s, box(document.querySelector(s))]));
    const violations: string[] = [];
    const gap = (first: string, second: string, minimum = 0) => {
      const a = rects[first], b = rects[second];
      if (a && b && b.top < a.bottom + minimum - .5) violations.push(`${first} -> ${second}: gap ${b.top - a.bottom}`);
    };
    const card = document.querySelector<HTMLElement>('.overlay-card');
    const scale = card ? card.getBoundingClientRect().width / card.offsetWidth : 1;
    gap('.overlay-card-header', '.overlay-card-data', 8 * scale);
    gap('.overlay-card-data', '.overlay-spoken-section', 12 * scale);
    gap('.overlay-shipments-block > p', '.overlay-spoken-section', 12 * scale);
    gap('.overlay-shipments-block > p', '.overlay-shipments-block > .overlay-page-dots', 4 * scale);
    gap('.overlay-spoken-section', '.overlay-followups', 8 * scale);
    gap('.nexus-feed > .nexus-title', '.nexus-feed-index', 4 * (document.querySelector('#screen-stage')!.getBoundingClientRect().width / (document.querySelector('#screen-stage') as HTMLElement).offsetWidth));
    const intersect = (a: DOMRect, b: DOMRect) => a.left < b.right - .5 && a.right > b.left + .5 && a.top < b.bottom - .5 && a.bottom > b.top + .5;
    const data = document.querySelector('.overlay-card-data')?.getBoundingClientRect();
    const body = document.querySelector('.overlay-card-body')?.getBoundingClientRect();
    for (const node of document.querySelectorAll<HTMLElement>('.overlay-shipment-page[aria-hidden="false"] [role="row"], .overlay-shipments-block > p, .overlay-shipments-block > .overlay-page-dots, .overlay-card-header, .overlay-spoken-section, .overlay-followups')) {
      const r = node.getBoundingClientRect();
      const holder = node.closest('.overlay-shipments-block') ? data : body;
      if (holder && (r.top < holder.top - .5 || r.bottom > holder.bottom + .5 || r.left < holder.left - .5 || r.right > holder.right + .5)) violations.push(`outside section: ${node.className}`);
    }
    if (body && (body.left < 0 || body.right > innerWidth + .5 || body.top < 0 || body.bottom > innerHeight + .5)) violations.push('card outside viewport');
    const title = document.querySelector('.nexus-feed > .nexus-title')!.getBoundingClientRect();
    const feed = document.querySelector('.nexus-feed')!.getBoundingClientRect();
    const items = [...document.querySelectorAll('.nexus-feed-item')].map(el => {
      const r = el.getBoundingClientRect();
      const index = el.querySelector('.nexus-feed-index')!.getBoundingClientRect();
      if (intersect(index, title)) violations.push('feed title/index overlap');
      if (r.bottom > feed.bottom + .5) violations.push('feed outside module');
      const visual = el.querySelector('.nexus-machine-thumb');
      if (visual) {
        const v = visual.getBoundingClientRect();
        for (const other of el.querySelectorAll('.nexus-model, .nexus-feed-bottom')) if (intersect(v, other.getBoundingClientRect())) violations.push('thumbnail covers text');
      }
      return { item: box(el), index: box(el.querySelector('.nexus-feed-index')), visual: box(visual) };
    });
    const notes = [...document.querySelectorAll<HTMLElement>('.nexus-currency')].map(el => {
      const style = getComputedStyle(el), r = el.getBoundingClientRect();
      if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) violations.push('currency note line box too small');
      const panel = el.closest('.nexus-panel')!;
      for (const value of panel.querySelectorAll('.nexus-money, .nexus-contract-stats, .nexus-collection-body')) if (intersect(r, value.getBoundingClientRect())) violations.push('currency note covers data');
      return { text: el.textContent, rect: box(el), color: style.color, size: style.fontSize };
    });
    return { rects, violations, items, notes, demo: document.querySelector('.nexus-notice')?.textContent ?? null, page: document.querySelector('.overlay-shipments-block')?.getAttribute('data-page') };
  });
  const textFailures = await auditText(page);
  writeFileSync(path.join(output, `${name}.json`), JSON.stringify({ ...result, textFailures }, null, 2));
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  if (!baseline) { expect(result.violations).toEqual([]); expect(textFailures).toEqual([]); }
  return result;
}

for (const viewport of SCREEN_VIEWPORTS) for (const motion of ['no-preference', 'reduce'] as const) for (const variant of ['normal', 'long'] as const) {
  test(`main ${viewport.width} ${motion} ${variant}`, async ({ page, request }) => {
    await page.setViewportSize(viewport); await page.emulateMedia({ reducedMotion: motion });
    await setNexusPayload(request, variant === 'long' ? longNexusPayload(999999999999.99, 17) : nexusPayload());
    await page.goto(screenUrl(viewport.width)); await settle(page);
    // Let the actual intro and number animation settle in normal motion.
    await page.waitForTimeout(motion === 'reduce' ? 150 : 2800);
    const r = await record(page, `main-${viewport.width}-${motion}-${variant}`);
    if (!baseline) {
      expect(r.demo).toBeNull();
      await expect(page.locator('.nexus-machine-thumb')).toHaveCount(5);
      for (const visual of await page.locator('.nexus-machine-thumb').all()) await expect(visual).toBeVisible();
      expect(r.notes).toHaveLength(2);
      expect(r.notes[0].color).toBe(r.notes[1].color);
      expect(r.notes[0].size).toBe(r.notes[1].size);
      await expect(page.locator('.nexus-money[data-fit-ellipsis="true"]')).toHaveCount(0);
    }
  });
  for (const outage of [false, true]) test(`shipments ${viewport.width} ${motion} ${variant} ${outage ? 'outage' : 'normal'}`, async ({ page, request }) => {
    await page.setViewportSize(viewport); await page.emulateMedia({ reducedMotion: motion });
    await setNexusPayload(request, nexusPayload());
    const now = new Date(); await page.clock.install({ time: now }); await page.clock.pauseAt(now);
    await page.goto(`${screenUrl(viewport.width)}${screenUrl(viewport.width).includes('?') ? '&' : '?'}voiceLive=1&lite=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);
    await settle(page); await expect.poll(() => hub.counts().screens).toBe(1);
    // A mirrored session has no local audio ownership; the owner without a speech
    // manifest takes the real existing audio-unavailable presentation path.
    hub.broadcast({ type: 'session.start', at: Date.now(), sessionId: 'p13-layout', ...(outage ? {} : { screenId: '00000000-0000-0000-0000-000000000001' }) });
    hub.broadcast({ type: 'state.change', at: Date.now(), from: 'waking', to: 'listening', turn: 0 });
    await page.clock.runFor(1200);
    const card = task12Card('upcoming_shipments', variant);
    hub.broadcast({ type: 'state.change', at: Date.now(), from: 'listening', to: 'thinking', turn: 0 });
    hub.broadcast({ type: 'answer.delta', at: Date.now(), seq: 0, text: card.spoken, full: true, card });
    hub.broadcast({ type: 'state.change', at: Date.now(), from: 'thinking', to: 'answering', turn: 0 });
    await expect(page.locator('.overlay-card')).toHaveCount(1);
    await page.clock.runFor(3400);
    await expect(page.locator('.overlay-card-body')).toHaveAttribute('data-spoken-complete', 'true');
    await expect(page.locator('.overlay-audio-notice')).toHaveCount(outage ? 1 : 0);
    const pages = await page.locator('.overlay-shipment-page').count();
    expect(pages).toBeGreaterThan(0);
    if (variant === 'long') expect(pages).toBe(3);
    const seen = new Set<string>();
    for (let i = 0; i < pages; i++) {
      await page.clock.runFor(450);
      // CSS transitions use the compositor clock, independently of fake JS timers.
      if (motion === 'no-preference') await page.waitForTimeout(450);
      const r = await record(page, `card-${viewport.width}-${motion}-${variant}-${outage ? 'outage' : 'normal'}-${i + 1}`);
      seen.add(r.page!);
      if (!baseline) {
        const rows = page.locator('.overlay-shipment-page[aria-hidden="false"] [role="row"]');
        expect(await rows.count()).toBeGreaterThan(0);
        for (const row of await rows.all()) await expect(row).toBeInViewport({ ratio: 1 });
      }
      await page.clock.fastForward(3550);
    }
    expect(seen.size).toBe(pages);
  });
}

test('demo badge requires explicit demo mode even when payload requests a notice', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const p = nexusPayload(); p.displayNotice = true; await setNexusPayload(request, p);
  for (const [query, visible] of [['', false], ['?demo=1', true], ['?source=mock', true], ['?source=public&demo=0', false]] as const) {
    await page.goto(`/screen/sales${query}`); await settle(page);
    await record(page, `demo-${query.replace(/[^a-z0-9]/gi, '-') || 'default'}`);
    if (!baseline) await expect(page.locator('.nexus-notice')).toHaveCount(visible ? 1 : 0);
  }
});
