/** Continuous visual evidence; not a benchmark. Run against the unmodified baseline first. */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, renameSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installProbe } from '../p1-5-c/instrumentation.mjs';
const phase = process.env.C1_PHASE ?? 'baseline';
const out = path.resolve(`docs/nexus-p1-5-c-1/evidence/${phase}`);
mkdirSync(out, { recursive: true });
const children = [], serverLog = [], report = { phase, purpose: 'continuous visual evidence, not frame presentation/performance acceptance', scenarios: [], errors: [] };
const prior = process.env.C1_RESUME === '1' && existsSync(path.join(out, 'report.json')) ? JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8')) : null;
report.build = { id: readFileSync('.next/BUILD_ID', 'utf8').trim(), sourceInputs: ['MotionDirector.ts', 'MotionProvider.tsx', 'QualityPolicy.ts', 'calibrateRaf.ts', 'config.ts', 'DeferredRecalibration.ts']
  .map(file => `src/components/screen/motion/${file}`).filter(file => existsSync(file)).map(file => ({ path: file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') })) };
if (prior) {
  assert.equal(prior.phase, phase); assert.deepEqual(prior.build, report.build, 'Cannot reuse evidence from different build inputs');
  for (const scenario of prior.scenarios) assert.equal(createHash('sha256').update(readFileSync(path.join(out, scenario.video))).digest('hex'), scenario.videoSha256);
  report.scenarios = prior.scenarios;
}
const delay = ms => new Promise(r => setTimeout(r, ms));
function serve(args, env = {}) {
  const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child); for (const stream of [child.stdout, child.stderr]) stream.on('data', data => serverLog.push(String(data)));
}
async function ready(url) { for (let i = 0; i < 300; i++) { try { if ((await fetch(url)).ok) return; } catch {} await delay(100); } throw Error(`Not ready: ${url}`); }
function snapshot() {
  const debug = document.querySelector('.nexus-motion-debug'), stage = document.querySelector('#screen-stage');
  return { at: performance.now(), ...debug?.dataset, stageState: stage?.dataset.motionState, transform: stage?.style.transform,
    stageTime: Number(stage?.dataset.motionTime), pulse: Number(stage?.dataset.motionPulse), introMap: Number(stage?.style.getPropertyValue('--intro-map')),
    introPanels: Number(stage?.style.getPropertyValue('--intro-panels')), introFeed: Number(stage?.style.getPropertyValue('--intro-feed')),
    modules: { routes: document.querySelectorAll('.nexus-route-light').length, particles: document.querySelectorAll('.nexus-particles').length, mapPaths: document.querySelectorAll('.nexus-map-frame path').length, feed: document.querySelectorAll('.nexus-feed-item').length },
    rect: stage && { width: stage.getBoundingClientRect().width, height: stage.getBoundingClientRect().height },
    numbers: [...document.querySelectorAll('[data-motion-number]')].map(n => n.textContent),
    resources: window.__p15cProbe.timerAudit(), audit: JSON.parse(document.querySelector('[data-gsap-audit]')?.textContent ?? 'null'),
    recalibration: JSON.parse(document.querySelector('[data-recalibration-log]')?.textContent ?? '[]') };
}
let browser;
try {
  for (const port of [3199, 3074]) { let occupied = false; try { await fetch(`http://127.0.0.1:${port}`); occupied = true; } catch {} if (occupied) throw Error(`Occupied ${port}`); }
  serve(['e2e/nexus-fixture-server.mjs']); await ready('http://127.0.0.1:3199');
  serve(['scripts/p1-5-c/local-server.mjs', '--port', '3074'], { SCREEN_PLATFORM_URL: 'http://127.0.0.1:3199', SCREEN_PUBLIC_ID: 'fixture-only', NEXUS_QUALITY_PERMISSION: 'local-candidate' });
  await ready('http://127.0.0.1:3074/screen/sales');
  browser = await chromium.launch({ headless: false });
  report.environment = { browser: browser.version(), gpu: await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo'), headless: false, dpr: 1 };
  for (const engine of ['legacy', 'gsap']) for (const width of (process.env.C1_WIDTHS ?? '1920').split(',').map(Number)) {
    if (report.scenarios.some(s => s.engine === engine && s.width === width)) continue;
    await fetch('http://127.0.0.1:3199/control?reset=1');
    const height = width === 1792 ? 832 : Math.round(width * 9 / 16), layout = width === 1792 ? 'led-1792x832' : '16x9';
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'no-preference', deviceScaleFactor: 1,
      recordVideo: { dir: path.join(out, 'raw-video'), size: { width: 1280, height: 720 } } });
    await context.addInitScript(installProbe, null);
    const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
    if (phase !== 'baseline') {
      await page.goto(`http://127.0.0.1:3074/screen/sales?motion=${engine}&layout=${layout}&fit=1`);
      await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(400);
    }
    await page.goto(`http://127.0.0.1:3074/screen/sales?debug=1&motion=${engine}&qualityExperiment=candidate&layout=${layout}&fit=1`);
    await page.waitForFunction(() => document.querySelector('.nexus-motion-debug')?.dataset.paused === 'false');
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(2600);
    const scenario = { engine, width, height, layout, timeline: [] };
    const record = async label => { const s = await page.evaluate(snapshot); scenario.timeline.push({ label, ...s }); report.partialScenario = scenario; return s; };
    for (const cue of ['INTRO', 'PULSE']) {
      await page.getByRole('button', { name: cue === 'INTRO' ? '重启入场' : '触发共振', exact: true }).click();
      await page.waitForTimeout(350); const before = await record(`${cue}-before-resize`);
      await page.setViewportSize({ width: width === 1920 ? 1792 : width - 96, height: Math.round((width === 1920 ? 1792 : width - 96) * height / width) });
      // The browser controller can return before its native resize event is delivered.
      // Deliver the same event before sampling the synchronous fit listener.
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      const immediate = await record(`${cue}-immediate-resize`);
      if (phase === 'fixed') { assert.equal(before.state, cue); assert.equal(immediate.state, cue); assert.equal(immediate.paused, 'false'); assert.equal(immediate.qualityAutomation, 'candidate'); assert.ok(Math.abs(immediate.rect.width - (width === 1920 ? 1792 : width - 96)) <= 2); }
      for (let i = 0; i < (cue === 'INTRO' ? 14 : 55); i++) { await page.waitForTimeout(200); await record(`${cue}-${i}`); }
      if (phase === 'fixed') {
        const preserved = scenario.timeline.filter(s => s.label.startsWith(`${cue}-`) && !s.label.includes('before') && !s.label.includes('immediate') && s.at - before.at < (cue === 'INTRO' ? 1500 : 9000));
        assert.ok(preserved.length); assert.ok(preserved.every(s => s.state === cue && s.paused === 'false'));
        assert.equal(scenario.timeline.at(-1).qualityAutomation, 'candidate');
        const samples = [before, immediate, ...scenario.timeline.filter(s => s.label.startsWith(`${cue}-`) && /^\d+$/.test(s.label.slice(cue.length + 1)))];
        for (let i = 1; i < samples.length; i++) { assert.ok(samples[i].stageTime >= samples[i - 1].stageTime); assert.deepEqual(samples[i].modules, before.modules); }
        if (cue === 'INTRO') for (const key of ['introMap', 'introPanels', 'introFeed']) for (let i = 1; i < samples.length; i++) assert.ok(samples[i][key] >= samples[i - 1][key]);
      }
      await page.screenshot({ path: path.join(out, `${engine}-${width}-${cue}-after.png`) });
      await page.setViewportSize({ width, height }); await page.waitForTimeout(900);
    }
    await record('storm-before');
    await page.evaluate(async () => { for (let i = 0; i < 40; i++) { window.dispatchEvent(new Event('resize')); await new Promise(r => setTimeout(r, 50)); } });
    await record('storm-end'); await page.waitForTimeout(1000); await record('storm-settled');
    const video = page.video(); await context.close();
    renameSync(await video.path(), path.join(out, `${engine}-${width}-intro-pulse-resize.webm`));
    scenario.videoSha256 = createHash('sha256').update(readFileSync(path.join(out, `${engine}-${width}-intro-pulse-resize.webm`))).digest('hex');
    scenario.video = `${engine}-${width}-intro-pulse-resize.webm`; report.scenarios.push(scenario); delete report.partialScenario;
    writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ phase, engine, width, scenes: scenario.timeline.filter(s => /before-resize|immediate-resize|storm/.test(s.label)).map(s => ({ label: s.label, at: s.at, state: s.state, paused: s.paused, rect: s.rect, mode: s.qualityAutomation })) }));
  }
  report.status = report.errors.length ? 'page-errors' : 'captured';
} catch (error) { report.failure = error.stack; throw error; }
finally { writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); writeFileSync(path.join(out, 'servers.log'), serverLog.join('')); await browser?.close(); for (const child of children) child.kill('SIGTERM'); }
