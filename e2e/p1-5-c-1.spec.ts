import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installProbe } from '../scripts/p1-5-c/instrumentation.mjs';
import { startVoiceHub, type VoiceHubServer } from '../services/voice-orchestrator/src/ws/ws-server';
import { VOICE_TIMING } from '../src/lib/voice/session-machine';
let hub: VoiceHubServer;
test.beforeAll(async () => { hub = await startVoiceHub({ host: '127.0.0.1', port: 0, onMessage: (connection, raw) => { if (JSON.parse(raw).type === 'console.hello') connection.role = 'screen'; } }); });
test.afterAll(async () => { await hub.close(); });
const dir = 'docs/nexus-p1-5-c-1/evidence/runtime';
type RecordEntry = { at: number; event: string; version: number; firstRequestedAt: number; activeMs: number };
const debug = (page: Page) => page.locator('.nexus-motion-debug');
const records = async (page: Page) => JSON.parse((await page.locator('[data-recalibration-log]').textContent())!) as RecordEntry[];
async function open(page: Page, engine: string, mode = 'candidate', extra = '', layout = '16x9') {
  await page.clock.install(); await page.clock.pauseAt(new Date());
  await page.addInitScript(installProbe, null);
  await page.goto(`/screen/sales?debug=1&motion=${engine}&qualityExperiment=${mode}&layout=${layout}&fit=1${extra}`);
  await page.clock.runFor(1800); await expect(debug(page)).toHaveAttribute('data-quality-automation', mode);
  await expect(debug(page)).toHaveAttribute('data-paused', 'false');
}
async function request(page: Page) { await page.evaluate(() => window.dispatchEvent(new Event('nexus-quality-recalibrate'))); }
async function audit(page: Page) {
  return page.evaluate(() => ({ timers: (window as unknown as { __p15cProbe: { timerAudit: () => unknown } }).__p15cProbe.timerAudit(),
    ticker: JSON.parse(document.querySelector('[data-gsap-audit]')!.textContent!), state: { ...((document.querySelector('.nexus-motion-debug') as HTMLElement).dataset) } }));
}
function save(name: string, value: unknown) { mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/${name}.json`, JSON.stringify(value, null, 2)); }
for (const engine of ['legacy', 'gsap']) {
  for (const width of [1280, 1792, 1920, 3840]) test(`${engine} ${width}: fit is immediate while INTRO/PULSE reach natural ends`, async ({ page }) => {
    const height = width === 1792 ? 832 : Math.round(width * 9 / 16), layout = width === 1792 ? 'led-1792x832' : '16x9';
    await page.setViewportSize({ width, height }); await open(page, engine, 'candidate', '', layout);
    const evidence = [];
    for (const cue of ['INTRO', 'PULSE']) {
      await page.getByRole('button', { name: cue === 'INTRO' ? '重启入场' : '触发共振', exact: true }).click();
      await page.clock.runFor(350); const before = await audit(page);
      const nextWidth = width - 96, nextHeight = Math.round(nextWidth * height / width);
      await page.setViewportSize({ width: nextWidth, height: nextHeight });
      // Deliver orientation and resize before another animation frame to check synchronous layout.
      const immediate = await page.evaluate(() => {
        window.dispatchEvent(new Event('resize')); screen.orientation.dispatchEvent(new Event('change'));
        const s = document.querySelector('#screen-stage') as HTMLElement;
        return { width: s.getBoundingClientRect().width, height: s.getBoundingClientRect().height, transform: s.style.transform,
          state: document.querySelector('.nexus-motion-debug')?.getAttribute('data-state') };
      });
      expect(immediate.width).toBeCloseTo(Math.min(nextWidth, nextHeight * width / height), 0); expect(immediate.state).toBe(cue);
      await expect(debug(page)).toHaveAttribute('data-paused', 'false');
      await page.clock.runFor(cue === 'INTRO' ? 1300 : 9000); await expect(debug(page)).toHaveAttribute('data-state', cue);
      await page.clock.runFor(2000); await expect(debug(page)).toHaveAttribute('data-recalibration', 'idle');
      await expect(debug(page)).toHaveAttribute('data-quality-automation', 'candidate');
      const log = await records(page); expect(log.at(-1)?.event).toBe('applied');
      evidence.push({ cue, before, immediate, after: await audit(page), records: log });
      await page.setViewportSize({ width, height }); await page.clock.runFor(1400);
    }
    save(`${engine}-${width}-cues`, evidence);
  });
  test(`${engine}: resize storm reserves the first active budget without indefinite delay`, async ({ page }) => {
    await open(page, engine); await page.getByRole('button', { name: '重启入场', exact: true }).click(); await request(page);
    for (let i = 0; i < 31; i++) {
      await page.clock.runFor(1000); await request(page); await page.getByRole('button', { name: '重启入场', exact: true }).click();
    }
    await page.clock.runFor(4000); const log = await records(page);
    const applied = log.filter(r => r.event === 'applied'); expect(applied.length).toBeGreaterThan(0);
    expect(applied[0].activeMs).toBeGreaterThanOrEqual(30_000); expect(applied[0].activeMs).toBeLessThan(45_000);
    const first = log.find(r => r.event === 'requested')!;
    expect(log.filter(r => r.event === 'requested' && r.at <= applied[0].at).every(r => r.firstRequestedAt === first.firstRequestedAt)).toBe(true);
    expect(log.filter(r => r.event.startsWith('fallback'))).toEqual([]); save(`${engine}-storm`, { log, after: await audit(page) });
  });
  test(`${engine}: waiting/measurement takeover, recovery, teardown and engine switch release resources`, async ({ page }) => {
    await open(page, engine); const initial = await audit(page), phases = [];
    for (const kind of ['voice', 'hidden', 'reduced']) for (const stage of ['waiting', 'measuring']) {
      if (stage === 'waiting') await page.getByRole('button', { name: '重启入场', exact: true }).click();
      await request(page); await expect(debug(page)).toHaveAttribute('data-recalibration', stage);
      if (kind === 'voice') await page.evaluate(() => window.dispatchEvent(new CustomEvent('nexus-debug-voice', { detail: true })));
      if (kind === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
      if (kind === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(debug(page)).toHaveAttribute('data-paused', 'true'); await page.clock.runFor(60_000);
      const paused = await audit(page); expect(paused.timers).toMatchObject({ activeTimeouts: 0, pendingApplicationRaf: 0 });
      if (engine === 'gsap') expect(paused.ticker.activeListeners).toBe(0);
      if (kind === 'voice') await page.evaluate(() => window.dispatchEvent(new CustomEvent('nexus-debug-voice', { detail: false })));
      if (kind === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
      if (kind === 'reduced') await page.emulateMedia({ reducedMotion: 'no-preference' });
      // Media change dispatch is asynchronous; start the measured second after it arrives.
      await expect(debug(page)).toHaveAttribute('data-recalibration', 'measuring');
      await page.clock.runFor(1500); await expect(debug(page)).toHaveAttribute('data-recalibration', 'idle');
      const resumed = await audit(page); expect(resumed.timers).toMatchObject({ activeTimeouts: 0, pendingApplicationRaf: 1 });
      if (engine === 'gsap') expect(resumed.ticker).toMatchObject({ activeListeners: 1, liveScenes: 1, rootAnimations: 0 });
      phases.push({ kind, stage, paused, resumed, log: await records(page) });
    }
    await request(page); await expect(debug(page)).toHaveAttribute('data-recalibration', 'measuring');
    await page.getByRole('link', { name: engine === 'legacy' ? '切换 GSAP' : '切换 Legacy', exact: true }).click();
    await page.clock.runFor(2000); const switched = await audit(page); expect(switched.timers).toMatchObject({ activeTimeouts: 0, pendingApplicationRaf: 1 });
    await request(page); await page.getByRole('link', { name: '回到 Baseline', exact: true }).click();
    await page.clock.runFor(1500); await expect(debug(page)).toHaveAttribute('data-quality-automation', 'baseline');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(debug(page)).toHaveAttribute('data-paused', 'true');
    expect((await audit(page)).timers).toMatchObject({ activeTimeouts: 0, pendingApplicationRaf: 0 });
    save(`${engine}-lifecycle`, { initial, phases, switched, baseline: await audit(page) });
  });
  test(`${engine}: default Baseline ignores every recalibration trigger`, async ({ page }) => {
    await open(page, engine, 'baseline'); await page.getByRole('button', { name: '重启入场', exact: true }).click();
    await page.evaluate(() => { for (let i = 0; i < 100; i++) window.dispatchEvent(new Event('resize')); screen.orientation.dispatchEvent(new Event('change')); window.dispatchEvent(new Event('nexus-quality-recalibrate')); });
    await page.clock.runFor(1200); await expect(debug(page)).toHaveAttribute('data-state', 'INTRO'); expect(await records(page)).toEqual([]);
    expect((await audit(page)).timers).toMatchObject({ activeTimeouts: 0, pendingApplicationRaf: 1 });
    save(`${engine}-baseline`, await audit(page));
  });
  test(`${engine}: new version during measurement wins and a stalled finite measurement falls back`, async ({ page }) => {
    await open(page, engine); await request(page); await expect(debug(page)).toHaveAttribute('data-recalibration', 'measuring');
    await page.clock.runFor(160); await request(page); await page.clock.runFor(1500);
    const log = await records(page); expect(log.some(r => r.event === 'discarded-stale-version')).toBe(true);
    expect(log.filter(r => r.event === 'applied').map(r => r.version)).toEqual([2]);
    await request(page); await expect(debug(page)).toHaveAttribute('data-recalibration', 'measuring');
    // Advance the finite deadline while delivering at most one RAF, as a throttled browser would.
    await page.clock.fastForward(3100); await expect(debug(page)).toHaveAttribute('data-quality-automation', 'baseline');
    expect((await records(page)).some(r => r.event === 'fallback-invalid-or-timed-out-measurement')).toBe(true);
    await request(page); await page.clock.runFor(1000); expect((await audit(page)).timers).toMatchObject({ activeTimeouts: 0, pendingApplicationRaf: 1 });
    save(`${engine}-versions-timeout`, { log, finalLog: await records(page), after: await audit(page) });
  });
  test(`${engine}: real voice overlay takes priority while waiting and measuring`, async ({ page }) => {
    await open(page, engine, 'candidate', `&voiceLive=1&lite=1&hub=${encodeURIComponent(`ws://127.0.0.1:${hub.port}`)}`);
    await expect.poll(() => hub.counts().screens).toBe(1); const evidence = [];
    // Establish the voice-only footprint: JarvisCore owns its own visible overlay RAF.
    hub.broadcast({ type: 'session.start', at: Date.now(), sessionId: 'c1-voice-control' });
    hub.broadcast({ type: 'state.change', at: Date.now(), from: 'waking', to: 'listening', turn: 0 });
    await expect(debug(page)).toHaveAttribute('data-paused', 'true'); await page.clock.runFor(4000);
    const control = await audit(page);
    await page.keyboard.press('Escape'); await page.clock.runFor(VOICE_TIMING.closingMs); await expect(page.locator('.overlay-root')).toHaveAttribute('data-phase', 'exit');
    await page.clock.runFor(600); await expect(debug(page)).toHaveAttribute('data-paused', 'false'); await page.clock.runFor(1500);
    for (const stage of ['waiting', 'measuring']) {
      if (stage === 'waiting') await page.getByRole('button', { name: '重启入场', exact: true }).click();
      await request(page); await expect(debug(page)).toHaveAttribute('data-recalibration', stage);
      hub.broadcast({ type: 'session.start', at: Date.now(), sessionId: `c1-${stage}` });
      hub.broadcast({ type: 'state.change', at: Date.now(), from: 'waking', to: 'listening', turn: 0 });
      await expect(debug(page)).toHaveAttribute('data-paused', 'true'); await page.clock.runFor(4000);
      const paused = await audit(page); expect(paused.timers).toMatchObject({ activeTimeouts: 0 });
      expect(paused.timers).toMatchObject({ pendingApplicationRaf: (control.timers as { pendingApplicationRaf: number }).pendingApplicationRaf });
      await expect(debug(page)).toHaveAttribute('data-recalibration', 'paused');
      if (engine === 'gsap') expect(paused.ticker.activeListeners).toBe(0);
      await page.keyboard.press('Escape'); await page.clock.runFor(VOICE_TIMING.closingMs); await expect(page.locator('.overlay-root')).toHaveAttribute('data-phase', 'exit');
      await page.clock.runFor(600); await expect(debug(page)).toHaveAttribute('data-recalibration', 'measuring');
      await page.clock.runFor(1500); await expect(debug(page)).toHaveAttribute('data-recalibration', 'idle');
      evidence.push({ stage, paused, resumed: await audit(page), log: await records(page) });
    }
    save(`${engine}-actual-voice`, { control, evidence });
  });
  test(`${engine}: an active Candidate probe completes before runtime recalibration takes control`, async ({ page }) => {
    await open(page, engine);
    // Throttled delivery provides real policy samples; no debug quality or private state writes.
    for (let i = 0; i < 30 && await debug(page).getAttribute('data-quality-state') !== 'probe'; i++) await page.clock.fastForward(1100);
    await expect(debug(page)).toHaveAttribute('data-quality-state', 'probe'); await request(page);
    await expect(debug(page)).toHaveAttribute('data-recalibration', 'waiting');
    await expect(debug(page)).toHaveAttribute('data-paused', 'false'); const timeline = [];
    for (let i = 0; i < 24; i++) {
      await page.clock.runFor(250); const sample = await audit(page); timeline.push(sample);
      expect(sample.state.qualityState === 'probe' && sample.state.recalibration === 'measuring').toBe(false);
    }
    const log = await records(page); expect(log.some(r => r.event === 'applied')).toBe(true);
    const quality = JSON.parse((await page.locator('[data-quality-log]').textContent())!);
    const passed = quality.find((d: { reason: string }) => d.reason === 'normal-load-probe-passed'); expect(passed).toBeDefined();
    expect(log.find(r => r.event === 'started')!.at).toBeGreaterThanOrEqual(passed.evidence.atMs);
    expect((await audit(page)).timers).toMatchObject({ activeTimeouts: 0, pendingApplicationRaf: 1 });
    save(`${engine}-probe-arbitration`, { timeline, log, quality });
  });
}
