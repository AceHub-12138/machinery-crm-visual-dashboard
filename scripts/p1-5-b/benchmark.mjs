/** NEXUS P1.5-B controlled benchmark. Product source and defaults stay untouched. */
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import {
  classifyRenderer,
  mean,
  nearestRank,
  summarizeDurations,
  summarizeIntervals,
  summarizeLongTasks,
} from '../p1-5-a/metrics.mjs';
import { ProbeBackoffPolicy } from './quality-policy.mjs';

const backend = process.env.P15B_BACKEND ?? 'headless-swiftshader';
const phase = process.env.P15B_PHASE ?? 'frequency';
const profile = process.env.P15B_PROFILE ?? (phase === 'frequency' || phase === 'trace' ? 'shared60' : 'candidate60');
if (!['headless-swiftshader', 'headed-metal', 'headed-swiftshader'].includes(backend)) throw new Error('Unsupported P15B_BACKEND');
if (!['frequency', 'strategy', 'long', 'relief', 'trace'].includes(phase)) throw new Error('Unsupported P15B_PHASE');
if (!['native', 'shared60', 'candidate60'].includes(profile)) throw new Error('Unsupported P15B_PROFILE');

const repetitions = Number(process.env.P15B_REPEATS ?? (phase === 'long' ? 1 : 3));
const durationMs = Number(process.env.P15B_DURATION_MS ?? ({ frequency: 9_000, strategy: 75_000, long: 300_000, relief: 75_000, trace: 8_000 }[phase]));
const calibrationMs = Number(process.env.P15B_CALIBRATION_MS ?? 3_000);
const sampleMs = 1_000;
const resourceSampleMs = Number(process.env.P15B_RESOURCE_SAMPLE_MS ?? 60_000);
const reliefAtMs = Number(process.env.P15B_RELIEF_AT_MS ?? NaN);
const targetHz = profile === 'native' ? null : 60;
const headless = backend === 'headless-swiftshader';
const launchArgs = backend === 'headed-swiftshader' ? ['--use-gl=angle', '--use-angle=swiftshader-webgl'] : [];
const port = Number(process.env.P15B_PORT ?? ({ 'headless-swiftshader': 3061, 'headed-metal': 3062, 'headed-swiftshader': 3063 }[backend]));
const fixturePort = 3199;
const base = `http://127.0.0.1:${port}`;
const fixture = `http://127.0.0.1:${fixturePort}`;
const output = path.resolve('.review/p1-5-b', backend, `${phase}-${profile}`);
mkdirSync(output, { recursive: true });

const children = [], serverLogs = [];
const save = (file, value) => writeFileSync(path.join(output, file), JSON.stringify(value, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function server(args, env = {}) {
  const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => serverLogs.push(chunk.toString()));
  children.push(child);
}
async function ready(url) {
  for (let attempt = 0; attempt < 300; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await sleep(100);
  }
  throw new Error(`Server not ready: ${url}`);
}

function installProbe(requestedTargetHz) {
  let seed = 713;
  Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const nativeRequest = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const nativeSetTimeout = window.setTimeout.bind(window), nativeClearTimeout = window.clearTimeout.bind(window);
  const nativeSetInterval = window.setInterval.bind(window), nativeClearInterval = window.clearInterval.bind(window);
  const logical = new Map();
  const activeTimeouts = new Set(), activeIntervals = new Set();
  let timeoutsScheduled = 0, timeoutsFired = 0, intervalsScheduled = 0, intervalCallbacks = 0;
  let nextId = 0, nextDue;
  let browserLast, engineLast;
  let browserIntervals = [], browserProbeDurations = [], engineIntervals = [], engineDurations = [], longTasks = [];
  let maxPending = 0;
  const minimumInterval = Number.isFinite(requestedTargetHz) && requestedTargetHz > 0 ? 1000 / requestedTargetHz : 0;

  const browserProbe = timestamp => {
    const started = performance.now();
    if (browserLast !== undefined) browserIntervals.push(timestamp - browserLast);
    browserLast = timestamp;
    browserProbeDurations.push(performance.now() - started);
    nativeRequest(browserProbe);
  };
  nativeRequest(browserProbe);

  window.requestAnimationFrame = callback => {
    const logicalId = ++nextId;
    const attempt = timestamp => {
      if (!logical.has(logicalId)) return;
      if (minimumInterval && nextDue !== undefined && timestamp + 0.5 < nextDue) {
        logical.set(logicalId, nativeRequest(attempt));
        return;
      }
      logical.delete(logicalId);
      if (engineLast !== undefined) engineIntervals.push(timestamp - engineLast);
      engineLast = timestamp;
      if (minimumInterval) {
        nextDue = nextDue === undefined ? timestamp + minimumInterval : nextDue + minimumInterval;
        if (nextDue < timestamp - minimumInterval) nextDue = timestamp + minimumInterval;
      }
      const started = performance.now();
      callback(timestamp);
      engineDurations.push(performance.now() - started);
    };
    logical.set(logicalId, nativeRequest(attempt));
    maxPending = Math.max(maxPending, logical.size);
    return logicalId;
  };
  window.cancelAnimationFrame = logicalId => {
    const nativeId = logical.get(logicalId);
    if (nativeId !== undefined) nativeCancel(nativeId);
    logical.delete(logicalId);
  };
  window.setTimeout = (handler, delay, ...args) => {
    let id;
    const wrapped = (...callbackArgs) => {
      activeTimeouts.delete(id); timeoutsFired++;
      if (typeof handler === 'function') return handler(...callbackArgs);
    };
    id = nativeSetTimeout(wrapped, delay, ...args); activeTimeouts.add(id); timeoutsScheduled++; return id;
  };
  window.clearTimeout = id => { activeTimeouts.delete(id); nativeClearTimeout(id); };
  window.setInterval = (handler, delay, ...args) => {
    const wrapped = (...callbackArgs) => { intervalCallbacks++; if (typeof handler === 'function') return handler(...callbackArgs); };
    const id = nativeSetInterval(wrapped, delay, ...args); activeIntervals.add(id); intervalsScheduled++; return id;
  };
  window.clearInterval = id => { activeIntervals.delete(id); nativeClearInterval(id); };
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}

  window.__p15bProbe = {
    snapshot(reset = false) {
      const result = { browserIntervals, browserProbeDurations, engineIntervals, engineDurations, longTasks, maxPending, pending: logical.size, requestedTargetHz };
      if (reset) {
        browserIntervals = []; browserProbeDurations = []; engineIntervals = []; engineDurations = []; longTasks = [];
        browserLast = undefined; engineLast = undefined; maxPending = logical.size;
      }
      return result;
    },
    timerAudit() {
      return { activeTimeouts: activeTimeouts.size, activeIntervals: activeIntervals.size, pendingApplicationRaf: logical.size, timeoutsScheduled, timeoutsFired, intervalsScheduled, intervalCallbacks };
    },
  };
}

function parseDirector(text) {
  const value = Number(text.match(/FPS ([0-9.]+)/)?.[1] ?? NaN);
  return Number.isFinite(value) ? value : null;
}

function deltaMetrics(before, after) {
  const first = Object.fromEntries(before.metrics.map(item => [item.name, item.value]));
  const last = Object.fromEntries(after.metrics.map(item => [item.name, item.value]));
  return Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].map(name => [name, last[name] - first[name]]));
}

function webglInfo() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return { available: false, renderer: 'unknown' };
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    available: true,
    renderer: gl.getParameter(gl.RENDERER) || 'unknown',
    vendor: gl.getParameter(gl.VENDOR) || 'unknown',
    unmaskedRenderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) || 'unknown' : 'unknown',
    unmaskedVendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) || 'unknown' : 'unknown',
  };
}

async function environment(browser) {
  const session = await browser.newBrowserCDPSession();
  const gpu = await session.send('SystemInfo.getInfo');
  let commandLine = null;
  try { commandLine = await session.send('Browser.getBrowserCommandLine'); } catch {}
  let display = { available: false };
  try { display = { available: true, raw: JSON.parse(execFileSync('system_profiler', ['SPDisplaysDataType', '-json'], { encoding: 'utf8' })) }; } catch (error) { display = { available: false, error: error.message }; }
  return {
    capturedAt: new Date().toISOString(), backend, headless, explicitLaunchArgs: launchArgs,
    browser: { name: 'Chromium', version: browser.version(), commandLine },
    operatingSystem: { platform: os.platform(), release: os.release(), architecture: os.arch() },
    hardware: { cpu: os.cpus()[0]?.model ?? 'unknown', logicalCores: os.cpus().length, memoryBytes: os.totalmem() },
    gpu, display,
  };
}

async function createScenario(browser, engine, width) {
  await fetch(`${fixture}/control?reset=1`);
  const context = await browser.newContext({ viewport: { width, height: width * 9 / 16 }, deviceScaleFactor: 1, reducedMotion: 'no-preference', timezoneId: 'Asia/Shanghai' });
  await context.addInitScript(installProbe, targetHz);
  const page = await context.newPage();
  const errors = [], networkFailures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => networkFailures.push({ url: request.url(), error: request.failure()?.errorText ?? 'unknown' }));
  page.on('response', response => { if (response.status() >= 400) networkFailures.push({ url: response.url(), status: response.status() }); });
  await page.goto('about:blank');
  await page.waitForTimeout(calibrationMs);
  const calibrationRaw = await page.evaluate(() => window.__p15bProbe.snapshot(true));
  const calibration = summarizeIntervals(calibrationRaw.browserIntervals, calibrationMs);
  await page.goto(`${base}/screen/sales?layout=16x9&motion=${engine}&debug=1&qualityExperiment=external`);
  await page.locator(`#screen-stage[data-motion-engine="${engine}"]`).waitFor();
  const automation = await page.locator('.nexus-motion-debug').getAttribute('data-quality-automation');
  if (automation !== 'external-experiment') throw new Error(`Quality experiment isolation not active: ${automation}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(3_000);
  await page.addStyleTag({ content: '.nexus-motion-debug{display:none!important}' });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  return { context, page, cdp, calibration, webgl: await page.evaluate(webglInfo), errors, networkFailures };
}

async function debugAction(page, name) {
  await page.getByRole('button', { name, exact: true, includeHidden: true }).evaluate(element => element.click());
}

async function pageSample(page, reset = true) {
  return page.evaluate(resetProbe => {
    const probe = window.__p15bProbe.snapshot(resetProbe);
    const stage = document.querySelector('#screen-stage');
    const debug = document.querySelector('.nexus-motion-debug');
    return {
      probe,
      directorText: debug?.querySelector('p:nth-child(2)')?.textContent ?? '',
      level: stage?.dataset.motionLevel ?? 'unknown',
      state: stage?.dataset.motionState ?? 'unknown',
      paused: stage?.dataset.motionPaused === 'true',
      qualityAutomation: debug?.dataset.qualityAutomation ?? 'unknown',
      audit: document.querySelector('[data-gsap-audit]')?.textContent ?? null,
    };
  }, reset);
}

async function resourceSample(page, cdp, elapsedMs, label = 'timed') {
  const [heap, dom, pageData] = await Promise.all([
    cdp.send('Runtime.getHeapUsage'),
    cdp.send('Memory.getDOMCounters'),
    page.evaluate(() => ({
      timers: window.__p15bProbe.timerAudit(),
      gsapAudit: JSON.parse(document.querySelector('[data-gsap-audit]')?.textContent || 'null'),
      stageCount: document.querySelectorAll('#screen-stage').length,
      canvasCount: document.querySelectorAll('canvas').length,
      debugCount: document.querySelectorAll('.nexus-motion-debug').length,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    })),
  ]);
  return { elapsedMs, label, heap, dom, ...pageData };
}

function mergeRaw(target, source) {
  target.browserIntervals.push(...source.browserIntervals);
  target.browserProbeDurations.push(...source.browserProbeDurations);
  target.engineIntervals.push(...source.engineIntervals);
  target.engineDurations.push(...source.engineDurations);
  target.longTasks.push(...source.longTasks);
  target.maxPending = Math.max(target.maxPending, source.maxPending);
}

function summarizeRun(raw, actualMs, series, engine, calibration) {
  const directorValues = series.map(item => item.directorUpdateHz).filter(Number.isFinite);
  const directorMean = mean(directorValues);
  const estimatedUpdates = Number.isFinite(directorMean) ? directorMean * actualMs / 1000 : null;
  return {
    browserRafProxy: summarizeIntervals(raw.browserIntervals, actualMs),
    engineCallbacks: summarizeIntervals(raw.engineIntervals, actualMs),
    engineCallbackCost: summarizeDurations(raw.engineDurations),
    motionDirector: { meanHz: directorMean, p05Hz: nearestRank(directorValues, 0.05), p50Hz: nearestRank(directorValues, 0.5), p95Hz: nearestRank(directorValues, 0.95), samples: directorValues.length },
    gsapTicker: engine === 'gsap' ? { configuredCapHz: 60, listenerHzEstimate: directorMean, independentDirectInstrumentation: false } : null,
    callbackCostPerEstimatedDirectorUpdateMs: estimatedUpdates ? raw.engineDurations.reduce((sum, value) => sum + value, 0) / estimatedUpdates : null,
    longTasks: summarizeLongTasks(raw.longTasks),
    calibrationReferenceHz: calibration.rateHz,
    collectionOverhead: summarizeDurations(raw.browserProbeDurations),
  };
}

async function installSyntheticLoad(page) {
  await page.evaluate(() => {
    let active = true;
    const burn = () => {
      if (!active) return;
      const until = performance.now() + 24;
      while (performance.now() < until) {}
      requestAnimationFrame(burn);
    };
    requestAnimationFrame(burn);
    window.__p15bStopSyntheticLoad = () => { active = false; };
  });
}

async function runTimed(browser, engine, width, repetition) {
  const id = `${engine}-${width}-r${repetition}`;
  console.log(`${phase.toUpperCase()} ${backend} ${profile} ${id}`);
  const scenario = await createScenario(browser, engine, width);
  const { context, page, cdp, calibration, webgl, errors, networkFailures } = scenario;
  await debugAction(page, '恢复自动档');
  if (phase === 'relief') await installSyntheticLoad(page);
  await page.evaluate(() => window.__p15bProbe.snapshot(true));
  const before = await cdp.send('Performance.getMetrics');
  const startedAt = Date.now();
  const raw = { browserIntervals: [], browserProbeDurations: [], engineIntervals: [], engineDurations: [], longTasks: [], maxPending: 0 };
  const series = [], actions = [], pulseRequests = [], resourceTimeline = [];
  const engineCapHz = engine === 'gsap' ? 60 : (targetHz ?? calibration.rateHz);
  const policy = ['strategy', 'long', 'relief'].includes(phase) ? new ProbeBackoffPolicy({ browserRafReferenceHz: calibration.rateHz, engineConfiguredCapHz: engineCapHz }) : null;
  let loadRemoved = false;
  let viewportReliefApplied = false;
  let nextResourceSampleAt = 0;
  const pulseSchedule = phase === 'frequency' ? [4_500] : [15_000, 40_000].filter(value => value < durationMs - 2_000);
  let pulseIndex = 0;

  while (Date.now() - startedAt < durationMs) {
    const elapsed = Date.now() - startedAt;
    await page.waitForTimeout(Math.min(sampleMs, durationMs - elapsed));
    const elapsedMs = Date.now() - startedAt;
    const sample = await pageSample(page);
    mergeRaw(raw, sample.probe);
    const windowMetrics = summarizeIntervals(sample.probe.engineIntervals, sampleMs);
    const directorUpdateHz = parseDirector(sample.directorText);
    let policyResult = null;

    if (policy) {
      policyResult = policy.sample({ atMs: elapsedMs, updateHz: directorUpdateHz, intervalP95Ms: windowMetrics.intervalP95Ms, paused: sample.paused });
      if (policyResult.action === 'enter-low' || policyResult.action === 'probe-failed') await debugAction(page, '强制低档');
      if (policyResult.action === 'start-probe' || policyResult.action === 'recover-normal') await debugAction(page, '恢复自动档');
      if (policyResult.action !== 'hold' && policyResult.action !== 'probe-pass-window') actions.push({ elapsedMs, ...policyResult });
    }
    if (phase === 'relief' && !loadRemoved && elapsedMs >= 35_000) {
      await page.evaluate(() => window.__p15bStopSyntheticLoad?.());
      loadRemoved = true;
      actions.push({ elapsedMs, action: 'remove-synthetic-load', visualModulesChanged: false });
    }
    if (phase === 'long' && Number.isFinite(reliefAtMs) && !viewportReliefApplied && elapsedMs >= reliefAtMs) {
      await page.setViewportSize({ width: 1920, height: 1080 });
      viewportReliefApplied = true;
      actions.push({ elapsedMs, action: 'reduce-render-load', method: 'viewport 3840x2160 -> 1920x1080', visualModulesChanged: false });
    }
    if (elapsedMs >= nextResourceSampleAt) {
      resourceTimeline.push(await resourceSample(page, cdp, elapsedMs));
      nextResourceSampleAt += resourceSampleMs;
    }
    while (pulseIndex < pulseSchedule.length && elapsedMs >= pulseSchedule[pulseIndex]) {
      const beforePulse = await page.evaluate(() => {
        const stage = document.querySelector('#screen-stage');
        return { level: stage?.dataset.motionLevel ?? 'unknown', state: stage?.dataset.motionState ?? 'unknown' };
      });
      await debugAction(page, '触发共振');
      pulseRequests.push({ elapsedMs, before: beforePulse, accepted: beforePulse.level === 'normal' && beforePulse.state !== 'PULSE', rejectedBecauseLow: beforePulse.level !== 'normal' });
      pulseIndex++;
    }
    const phaseLabel = phase === 'frequency' ? elapsedMs < 4_500 ? 'ambient' : 'pulse-window' : policy?.mode ?? 'normal';
    series.push({ elapsedMs, phase: phaseLabel, level: sample.level, state: sample.state, paused: sample.paused, qualityAutomation: sample.qualityAutomation, directorUpdateHz, browserRafProxyHz: summarizeIntervals(sample.probe.browserIntervals, sampleMs).rateHz, engineCallbackHz: windowMetrics.rateHz, engineIntervalP95Ms: windowMetrics.intervalP95Ms, engineIntervalP99Ms: windowMetrics.intervalP99Ms, callbackTotalMs: sample.probe.engineDurations.reduce((sum, value) => sum + value, 0), longTasks: sample.probe.longTasks.length, policy: policyResult, audit: sample.audit });
    save('progress.json', { backend, phase, profile, id, elapsedMs, targetMs: durationMs, latest: series.at(-1), actions: actions.slice(-3) });
  }
  const actualMs = Date.now() - startedAt;
  const after = await cdp.send('Performance.getMetrics');
  await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
  const postRunGc = await resourceSample(page, cdp, actualMs, 'post-run-gc');
  const result = {
    id, engine, width, height: width * 9 / 16, repetition, backend, headless, phase, profile,
    requestedTargetHz: targetHz, engineConfiguredCapHz: engineCapHz, effectiveTargetHz: Math.min(calibration.rateHz, engineCapHz),
    duration: { requestedMs: durationMs, actualMs }, calibration, webgl,
    rendererClassification: classifyRenderer(null, webgl),
    metrics: summarizeRun(raw, actualMs, series, engine, calibration),
    mainThreadCdpDelta: deltaMetrics(before, after), series, actions, resourceTimeline, postRunGc,
    policyTransitions: policy?.transitions ?? [], pulseRequests,
    syntheticLoad: phase === 'relief' ? { addedAtMs: 0, removedAtMs: actions.find(item => item.action === 'remove-synthetic-load')?.elapsedMs ?? null, busyMsPerRaf: 24, visualModulesChanged: false } : null,
    loadRelief: phase === 'long' && Number.isFinite(reliefAtMs) ? { requestedAtMs: reliefAtMs, appliedAtMs: actions.find(item => item.action === 'reduce-render-load')?.elapsedMs ?? null, method: 'viewport reduction with all visual modules retained' } : null,
    errors, networkFailures,
  };
  save(`${id}.json`, result);
  await context.close();
  return result;
}

async function streamTrace(cdp, file, callback) {
  const completed = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { recordMode: 'recordContinuously', traceBufferSizeInKb: 262_144, includedCategories: 'toplevel,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.layers,blink.user_timing,cc,gpu,viz,benchmark,disabled-by-default-gpu.service'.split(',') } });
  const metadata = await callback();
  await cdp.send('Tracing.end');
  const { stream, ...status } = await completed;
  const gzip = createGzip(), destination = createWriteStream(file); gzip.pipe(destination);
  while (true) {
    const chunk = await cdp.send('IO.read', { handle: stream });
    if (chunk.data && !gzip.write(Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8'))) await once(gzip, 'drain');
    if (chunk.eof) break;
  }
  await cdp.send('IO.close', { handle: stream }); gzip.end(); await once(destination, 'finish');
  return { metadata, status };
}

async function runTrace(browser, engine, width, repetition) {
  const id = `${engine}-${width}-r${repetition}`;
  console.log(`TRACE ${backend} ${profile} ${id}`);
  const { context, page, cdp, calibration, webgl, errors } = await createScenario(browser, engine, width);
  await debugAction(page, '恢复自动档');
  const before = await cdp.send('Performance.getMetrics');
  const file = path.join(output, `${id}.trace.json.gz`);
  const trace = await streamTrace(cdp, file, async () => {
    await page.evaluate(() => performance.mark('P15B:trace-start'));
    const started = Date.now();
    await page.waitForTimeout(Math.min(3_000, durationMs / 2));
    await debugAction(page, '恢复自动档');
    await debugAction(page, '触发共振');
    await page.waitForTimeout(Math.max(0, durationMs - (Date.now() - started)));
    await page.evaluate(() => performance.mark('P15B:trace-end'));
    return { actualMs: Date.now() - started };
  });
  const after = await cdp.send('Performance.getMetrics');
  const result = { id, engine, width, repetition, backend, profile, requestedTargetHz: targetHz, calibration, webgl, rendererClassification: classifyRenderer(null, webgl), mainThreadCdpDelta: deltaMetrics(before, after), rawTrace: path.relative(process.cwd(), file), errors, ...trace };
  save(`${id}-trace-metadata.json`, result);
  await context.close();
  return result;
}

let browser;
const report = {
  schemaVersion: 1,
  task: 'NEXUS P1.5-B controlled quality policy validation',
  baseline: '957ff26b3202510316213dec93f8a0d98c0758b4',
  backend, phase, profile, repetitions, durationMs, requestedTargetHz: targetHz,
  startedAt: new Date().toISOString(), results: [],
  caveats: {
    raf: 'Browser scheduling proxy only; never actual presented FPS.',
    gsap: 'GSAP ticker listener rate is inferred 1:1 from current MotionDirector topology and is not independently instrumented.',
    isolation: 'All target-frequency and candidate-policy controls are test injected or driven through existing debug controls; production source/defaults are unchanged.',
  },
};

try {
  for (const url of [base, fixture]) { let occupied = false; try { await fetch(url); occupied = true; } catch {} if (occupied) throw new Error(`Refusing occupied port ${url}`); }
  server(['e2e/nexus-fixture-server.mjs']); await ready(fixture);
  server(['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { SCREEN_PLATFORM_URL: fixture, SCREEN_PUBLIC_ID: 'fixture-only', TZ: 'Asia/Shanghai' });
  await ready(`${base}/screen/sales?source=mock`);
  browser = await chromium.launch({ headless, args: launchArgs });
  report.environment = await environment(browser);
  const payload = await (await fetch(fixture)).json();
  report.fixtureSha256 = createHash('sha256').update(JSON.stringify({ ...payload, generatedAt: 'NORMALIZED' })).digest('hex');
  const allowedEngines = new Set((process.env.P15B_ENGINES ?? 'legacy,gsap').split(',').filter(Boolean));
  const allowedWidths = new Set((process.env.P15B_WIDTHS ?? '1920,3840').split(',').map(Number).filter(Number.isFinite));
  const scenarios = [['legacy', 1920], ['gsap', 1920], ['legacy', 3840], ['gsap', 3840]].filter(([engine, width]) => allowedEngines.has(engine) && allowedWidths.has(width));
  if (!scenarios.length) throw new Error('P15B_ENGINES/P15B_WIDTHS selected no scenarios');
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    for (const [engine, width] of scenarios) {
      const result = phase === 'trace' ? await runTrace(browser, engine, width, repetition) : await runTimed(browser, engine, width, repetition);
      report.results.push(result); save('report.json', report);
    }
  }
  const webgl = report.results.map(item => item.webgl);
  report.rendererClassification = classifyRenderer(report.environment.gpu, webgl);
  report.finishedAt = new Date().toISOString();
  save('report.json', report);
  console.log(JSON.stringify({ backend, phase, profile, results: report.results.length, renderer: report.rendererClassification }));
} finally {
  await browser?.close();
  for (const child of children) child.kill('SIGTERM');
  writeFileSync(path.join(output, 'servers.log'), serverLogs.join(''));
}
