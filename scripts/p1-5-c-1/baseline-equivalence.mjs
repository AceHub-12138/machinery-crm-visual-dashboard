/** Paired unchanged Baseline pages, identical virtual clock/seed, both engines. */
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installProbe } from '../p1-5-c/instrumentation.mjs';
const original = '/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-5-c-safety';
const base = 'b35b93c230fc6c084895a4119196779f505bf2fb';
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: original, encoding: 'utf8' }).trim(), base);
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: original, encoding: 'utf8' }).trim(), '');
const normalized = process.env.C1_DISABLE_CSS === '1';
const out = path.resolve(`docs/nexus-p1-5-c-1/evidence/baseline-equivalence${normalized ? '-css' : ''}`); mkdirSync(out, { recursive: true });
const children = [], logs = [], report = { baseline: base, screenshotCssAnimations: normalized ? 'disabled' : 'allow', originalBuild: readFileSync(path.join(original, '.next/BUILD_ID'), 'utf8').trim(), fixedBuild: readFileSync('.next/BUILD_ID', 'utf8').trim(), pairs: [] };
function serve(cwd, args) { const child = spawn(process.execPath, args, { cwd, env: { ...process.env, SCREEN_PLATFORM_URL: 'http://127.0.0.1:3199', SCREEN_PUBLIC_ID: 'fixture-only', NEXUS_QUALITY_PERMISSION: 'local-candidate', TZ: 'Asia/Shanghai' }, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child); for (const s of [child.stdout, child.stderr]) s.on('data', d => logs.push(String(d))); }
async function ready(url) { for (let i = 0; i < 300; i++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); } throw Error(`Not ready ${url}`); }
function readState() {
  const d = document.querySelector('.nexus-motion-debug'), s = document.querySelector('#screen-stage');
  const timers = window.__p15cProbe.timerAudit();
  return { scene: { ...s.dataset }, style: s.getAttribute('style'),
    debug: Object.fromEntries(Object.entries(d.dataset).filter(([key]) => key !== 'recalibration')),
    numbers: [...document.querySelectorAll('[data-motion-number]')].map(n => n.textContent),
    active: { timeouts: timers.activeTimeouts, intervals: timers.activeIntervals, raf: timers.pendingApplicationRaf },
    quality: document.querySelector('[data-quality-log]')?.textContent,
    routes: [...document.querySelectorAll('.nexus-route-light,.nexus-route-traveler')].map(n => [...n.attributes].map(a => [a.name, a.value])) };
}
let browser;
try {
  serve(process.cwd(), ['e2e/nexus-fixture-server.mjs']); await ready('http://127.0.0.1:3199');
  serve(original, ['scripts/p1-5-c/local-server.mjs', '--port', '3075']);
  serve(process.cwd(), ['scripts/p1-5-c/local-server.mjs', '--port', '3076']);
  await ready('http://127.0.0.1:3075/screen/sales'); await ready('http://127.0.0.1:3076/screen/sales');
  browser = await chromium.launch({ headless: true });
  for (const engine of ['legacy', 'gsap']) {
    const contexts = [], pages = [];
    for (const port of [3075, 3076]) {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'no-preference', deviceScaleFactor: 1 }); contexts.push(context);
      await context.addInitScript(installProbe, null); const page = await context.newPage(); pages.push(page);
      await page.clock.install({ time: new Date('2026-10-21T00:00:00Z') }); await page.clock.pauseAt(new Date('2026-10-21T00:00:00Z'));
      await page.goto(`http://127.0.0.1:${port}/screen/sales?debug=1&motion=${engine}&layout=16x9&fit=1`); await page.evaluate(() => document.fonts.ready);
    }
    const checkpoints = [];
    for (const [label, ms] of [['intro', 1200], ['ambient', 2000], ['pulse', 3300], ['resize-in-pulse', 1000], ['completed', 7000]]) {
      for (const page of pages) {
        if (label === 'pulse') await page.getByRole('button', { name: '触发共振', exact: true }).evaluate(button => button.click());
        if (label === 'resize-in-pulse') { await page.setViewportSize({ width: 1792, height: 1008 }); await page.evaluate(() => { for (let i = 0; i < 40; i++) window.dispatchEvent(new Event('resize')); screen.orientation.dispatchEvent(new Event('change')); }); }
        await page.clock.runFor(ms);
      }
      const [before, after] = await Promise.all(pages.map(p => p.evaluate(readState)));
      const match = JSON.stringify(before) === JSON.stringify(after); checkpoints.push({ label, match, before, after });
      // Save differences for review even if a renderer introduces nondeterminism.
      report.pairs.push({ engine, label, match });
      for (let i = 0; i < pages.length; i++) {
        const style = await pages[i].addStyleTag({ content: '.nexus-motion-debug{display:none!important}' });
        await pages[i].screenshot({ path: path.join(out, `${engine}-${label}-${i ? 'fixed' : 'original'}.png`), animations: normalized ? 'disabled' : 'allow' });
        await style.evaluate(node => node.remove());
      }
    }
    writeFileSync(path.join(out, `${engine}-states.json`), JSON.stringify(checkpoints, null, 2));
    for (const context of contexts) await context.close();
  }
  report.status = report.pairs.every(p => p.match) ? 'passed' : 'differences-recorded';
  assert.equal(report.status, 'passed');
} catch (error) { report.failure = error.stack; throw error; }
finally { writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); writeFileSync(path.join(out, 'servers.log'), logs.join('')); await browser?.close(); for (const child of children) child.kill('SIGTERM'); }
