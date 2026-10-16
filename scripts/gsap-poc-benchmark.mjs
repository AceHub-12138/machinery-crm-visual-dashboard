import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
const output = path.resolve('.review/gsap-poc/performance'); mkdirSync(output, { recursive: true });
const port = Number(process.env.NEXUS_TEST_PORT ?? 3047);
const shortMs = Number(process.env.GSAP_BENCH_MS ?? 120000), soakMs = Number(process.env.GSAP_SOAK_MS ?? 300000);
const base = `http://127.0.0.1:${port}`;
const children = [], logs = [];
function server(args, env = {}) {
  const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => logs.push(b.toString())); child.stderr.on('data', b => logs.push(b.toString())); children.push(child); return child;
}
async function ready(url) {
  for (let i = 0; i < 200; i++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error(`Server not ready: ${url}`);
}
function instrument() {
  let seed = 713; Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const request = requestAnimationFrame.bind(window), cancel = cancelAnimationFrame.bind(window), pending = new Set();
  let last, maxPending = 0, intervals = [], callbacks = [], longTasks = [];
  window.requestAnimationFrame = fn => {
    const id = request(t => { pending.delete(id); if (last !== undefined) intervals.push(t - last); last = t; const start = performance.now(); fn(t); callbacks.push(performance.now() - start); });
    pending.add(id); maxPending = Math.max(maxPending, pending.size); return id;
  };
  window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
  new PerformanceObserver(list => { for (const e of list.getEntries()) longTasks.push({ start: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true });
  window.pocMetrics = reset => {
    const result = { intervals, callbacks, longTasks, maxPending, pending: pending.size, engine: document.querySelector('#screen-stage')?.dataset.motionEngine, timelines: document.querySelector('#screen-stage')?.dataset.gsapTimelines,
      directorRecords: document.querySelector('[data-performance-log]')?.textContent, state: document.querySelector('#screen-stage')?.dataset.motionState, level: document.querySelector('#screen-stage')?.dataset.motionLevel, audit: document.querySelector('[data-gsap-audit]')?.textContent };
    if (reset) { intervals = []; callbacks = []; longTasks = []; last = undefined; maxPending = pending.size; } return result;
  };
}
const quantile = (values, p) => { const a = [...values].sort((x, y) => x - y); return a[Math.floor((a.length - 1) * p)] ?? null; };
function summary(raw, durationMs) {
  const missed = raw.intervals.reduce((n, d) => n + Math.max(0, Math.round(d / (1000 / 60)) - 1), 0);
  return { measuredMs: durationMs, callbacks: raw.callbacks.length, fps: raw.intervals.length * 1000 / raw.intervals.reduce((a, b) => a + b, 0),
    intervalP95Ms: quantile(raw.intervals, .95), intervalP99Ms: quantile(raw.intervals, .99), missedVsyncEstimate: missed,
    missedVsyncPercent: missed / (missed + raw.intervals.length) * 100,
    callbackP95Ms: quantile(raw.callbacks, .95), callbackP99Ms: quantile(raw.callbacks, .99), callbackTotalMs: raw.callbacks.reduce((a,b) => a+b,0),
    longTasks: raw.longTasks.length, longTaskTotalMs: raw.longTasks.reduce((a,b) => a+b.duration,0), longTaskMaxMs: Math.max(0,...raw.longTasks.map(t => t.duration)), maxPendingRAF: raw.maxPending,
    timelines: raw.timelines, state: raw.state, level: raw.level };
}
let browser;
const report = { startedAt: new Date().toISOString(), baseline: '10a5e0b283b6ecae664cc64d44f7a9e88fb061f1', platform: { os: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryBytes: os.totalmem(), node: process.version },
  policy: 'Headless Chromium, deviceScaleFactor=1, real time, sequential modes, seeded random=713, production build, fixture only. No recording during timed samples. Dropped frames are estimated from animation RAF intervals, not GPU presentation telemetry. Forced GC only outside timed samples. One bounded run per engine/resolution, not statistical proof.', results: [] };
try {
  for (const url of ["http://127.0.0.1:3199", base]) {
    let occupied = false; try { await fetch(url); occupied = true; } catch {}
    if (occupied) throw new Error(`Refusing to reuse an occupied port: ${url}`);
  }
  server(['e2e/nexus-fixture-server.mjs']); await ready('http://127.0.0.1:3199');
  server(['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { SCREEN_PLATFORM_URL: 'http://127.0.0.1:3199', SCREEN_PUBLIC_ID: 'fixture-only', TZ: 'Asia/Shanghai' });
  await ready(`${base}/screen/sales?source=mock`);
  browser = await chromium.launch(); report.browser = browser.version();
  // Identical business fixture; only generatedAt is reset per run to keep every run equally fresh. The normal 60s refresh still executes.
  await fetch('http://127.0.0.1:3199/control?reset=1');
  const payloadBytes = await (await fetch('http://127.0.0.1:3199')).text();
  report.fixtureSha256 = createHash('sha256').update(payloadBytes).digest('hex');
  writeFileSync(path.join(output, 'fixture.json'), payloadBytes);
  for (const width of [1920, 3840]) for (const engine of ['legacy', 'gsap']) {
    await fetch('http://127.0.0.1:3199/control?reset=1');
    const currentFixture = await (await fetch('http://127.0.0.1:3199')).json();
    const normalizedFixture = { ...currentFixture, generatedAt: 'NORMALIZED' };
    const businessSha256 = createHash('sha256').update(JSON.stringify(normalizedFixture)).digest('hex');
    const durationMs = width === 3840 ? soakMs : shortMs;
    const context = await browser.newContext({ viewport: { width, height: width * 9 / 16 }, deviceScaleFactor: 1, reducedMotion: 'no-preference', timezoneId: 'Asia/Shanghai' });
    await context.addInitScript(instrument);
    const page = await context.newPage(), errors = [], networkFailures = []; page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', request => networkFailures.push({ url: request.url(), error: request.failure()?.errorText }));
    page.on('response', response => { if (response.status() >= 400) networkFailures.push({ url: response.url(), status: response.status() }); });
    const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
    await page.goto(`${base}/screen/sales?layout=16x9&motion=${engine}&debug=1`);
    await page.locator(`#screen-stage[data-motion-engine="${engine}"]`).waitFor(); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(3000);
    // Hide debug without disabling it, so lifecycle counters and pulse controls remain inspectable.
    await page.addStyleTag({ content: '.nexus-motion-debug { display:none!important }' });
    await page.evaluate(() => window.pocMetrics(true));
    await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(100);
    const before = await cdp.send('Runtime.getHeapUsage'), cpuBefore = await cdp.send('Performance.getMetrics');
    await page.evaluate(() => window.pocMetrics(true));
    const started = Date.now(), memory = [], segments = [], pulses = [];
    while (Date.now() - started < durationMs) {
      await page.waitForTimeout(Math.min(30000, durationMs - (Date.now() - started)));
      const heap = await cdp.send('Runtime.getHeapUsage'), dom = await cdp.send('Memory.getDOMCounters');
      const m = await page.evaluate(() => window.pocMetrics(false));
      memory.push({ elapsedMs: Date.now() - started, ...heap, ...dom, audit: m.audit, timelines: m.timelines, state: m.state, level: m.level });
      segments.push({ elapsedMs: Date.now() - started, frames: m.intervals.length, longTasks: m.longTasks.length });
      if (memory.length % 2 === 1 && Date.now() - started < durationMs - 11000) {
        await page.getByRole('button', { name: '触发共振', includeHidden: true }).evaluate(el => el.click()); pulses.push(Date.now() - started);
      }
      writeFileSync(path.join(output, 'progress.json'), JSON.stringify({ engine, width, elapsedMs: Date.now()-started, targetMs: durationMs, usedHeapBytes: heap.usedSize, dom, audit: m.audit, level: m.level, frames: m.intervals.length, longTasks: m.longTasks.length }, null, 2));
      console.log(`${engine} ${width}: ${Math.round((Date.now()-started)/1000)}s / ${durationMs/1000}s`);
    }
    const actualMs = Date.now() - started, raw = await page.evaluate(() => window.pocMetrics(false));
    const cpuAfter = await cdp.send('Performance.getMetrics');
    await page.evaluate(() => window.pocMetrics(true));
    await cdp.send('HeapProfiler.collectGarbage'); const after = await cdp.send('Runtime.getHeapUsage');
    const metrics = summary(raw, actualMs), first = Object.fromEntries(cpuBefore.metrics.map(m => [m.name,m.value])), last = Object.fromEntries(cpuAfter.metrics.map(m=>[m.name,m.value]));
    const cpuDelta = Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(k => [k, last[k]-first[k]]));
    const entry = { engine, businessSha256, fixtureGeneratedAt: currentFixture.generatedAt, width, height: width*9/16, metrics, beforeGCHeap: before, afterGCHeap: after, retainedHeapDeltaBytes: after.usedSize-before.usedSize, cpuDeltaSeconds: cpuDelta, errors, networkFailures, directorRecords: JSON.parse(raw.directorRecords ?? '[]'), memory, segments, pulses };
    writeFileSync(path.join(output, `${engine}-${width}-raw.json`), JSON.stringify(raw));
    // Client switching exercises React cleanup without destroying the renderer or JS module.
    const retention = []; entry.clientNavigationRetention = retention;
    report.results.push(entry); writeFileSync(path.join(output, 'benchmark.json'), JSON.stringify(report,null,2));
    for (let i = 0; i < 10; i++) {
      const next = i % 2 === 0 ? (engine === 'gsap' ? 'legacy' : 'gsap') : engine;
      await page.getByRole('link', { name: `切换 ${next === 'gsap' ? 'GSAP' : 'Legacy'}`, exact: true, includeHidden: true }).evaluate(el => el.click());
      await page.locator(`#screen-stage[data-motion-engine="${next}"]`).waitFor(); await page.waitForTimeout(2500);
      await page.evaluate(() => window.pocMetrics(true));
      await cdp.send('HeapProfiler.collectGarbage');
      retention.push({ cycle: i+1, engine: next, ...await cdp.send('Runtime.getHeapUsage'), ...await cdp.send('Memory.getDOMCounters'), audit: await page.locator('[data-gsap-audit]').textContent() });
    }
    entry.clientNavigationRetention = retention;
    await page.goto('about:blank'); await cdp.send('HeapProfiler.collectGarbage');
    entry.blankAfterGC = { ...await cdp.send('Runtime.getHeapUsage'), ...await cdp.send('Memory.getDOMCounters') };
    writeFileSync(path.join(output, 'benchmark.json'), JSON.stringify(report,null,2));
    await context.close(); console.log(JSON.stringify({ engine, width, ...metrics, retainedHeapDeltaBytes: entry.retainedHeapDeltaBytes, errors }));
  }
  // Separate visual recording: the encoding overhead is excluded from the timed samples above.
  for (const width of [1920,3840]) for (const engine of ['legacy','gsap']) {
    await fetch('http://127.0.0.1:3199/control?reset=1');
    const context = await browser.newContext({ viewport: { width,height:width*9/16 },deviceScaleFactor:1, ...(width === 1920 ? {recordVideo:{dir:path.join(output,'video'),size:{width:1920,height:1080}}} : {}) });
    await context.addInitScript(instrument); const page=await context.newPage();
    await page.goto(`${base}/screen/sales?layout=16x9&motion=${engine}&debug=1`); await page.locator('#screen-stage').waitFor(); await page.waitForTimeout(3000);
    await page.addStyleTag({content:'.nexus-motion-debug { display:none!important }'});
    await page.getByRole('button',{name:'重启入场',includeHidden:true}).evaluate(el=>el.click());
    for (const [name,wait] of [['intro-0',0],['intro-600',600],['intro-1500',900],['ambient',1200]]) { await page.waitForTimeout(wait); await page.screenshot({path:path.join(output,`${engine}-${width}-${name}.png`)}); }
    await page.getByRole('button',{name:'触发共振',includeHidden:true}).evaluate(el=>el.click());
    for (const [name,wait] of [['pulse-1400',1400],['pulse-2200',800],['pulse-5000',2800],['pulse-8500',3500],['pulse-end',2000]]) { await page.waitForTimeout(wait); await page.screenshot({path:path.join(output,`${engine}-${width}-${name}.png`)}); }
    const video=page.video(); await context.close(); if (video) { const file=path.join(output,'video',`${engine}.webm`); await video.saveAs(file); report[`${engine}Video`]=file; }
  }
  report.finishedAt = new Date().toISOString(); writeFileSync(path.join(output,'benchmark.json'),JSON.stringify(report,null,2));
} finally {
  await browser?.close(); for (const child of children) child.kill('SIGTERM'); writeFileSync(path.join(output,'servers.log'),logs.join(''));
}
