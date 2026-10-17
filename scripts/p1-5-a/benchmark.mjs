/**
 * NEXUS P1.5-A benchmark calibrator.
 *
 * Product source is not modified. Formal timing, tracing, and screenshots are
 * separate phases so trace/encoding overhead never contaminates formal samples.
 */
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import {
  classifyRenderer,
  estimateMissedOpportunities,
  mean,
  nearestRank,
  summarizeDurations,
  summarizeIntervals,
  summarizeLongTasks,
  transitionSummary,
} from './metrics.mjs';

const backend = process.env.P15_BACKEND ?? 'headless';
if (!['headless', 'headed'].includes(backend)) throw new Error('P15_BACKEND must be headless or headed');
const phase = process.env.P15_PHASE ?? 'all';
if (!['all', 'formal', 'trace', 'visual'].includes(phase)) throw new Error('P15_PHASE must be all, formal, trace, or visual');
const headless = backend === 'headless';
const formalMs = Number(process.env.P15_FORMAL_MS ?? 60_000);
const traceMs = Number(process.env.P15_TRACE_MS ?? 10_000);
const calibrationMs = Number(process.env.P15_CALIBRATION_MS ?? 5_000);
const sampleMs = Number(process.env.P15_SAMPLE_MS ?? 1_000);
const port = Number(process.env.P15_PORT ?? (headless ? 3051 : 3052));
const fixturePort = Number(process.env.P15_FIXTURE_PORT ?? 3199);
const base = `http://127.0.0.1:${port}`;
const fixture = `http://127.0.0.1:${fixturePort}`;
const output = path.resolve('.review/p1-5-a', backend);
mkdirSync(output, { recursive: true });

const BASELINES = {
  p14: 'df69d71f5b0cafcdab70a18f8e11be9f92cd163d',
  gsapPoc: '1f9e9cd6d78e12f85eee47d087c87191f90a0460',
  p13: '10a5e0b283b6ecae664cc64d44f7a9e88fb061f1',
};
const QUALITY_POLICY = {
  observationOnly: true,
  fpsWindowMs: 1_000,
  downshiftCondition: 'MotionDirector internal update frequency < 45 Hz for 5 consecutive one-second windows',
  recoveryCondition: 'MotionDirector internal update frequency >= 52 Hz for 10 consecutive one-second windows',
  lowFpsHz: 45,
  lowDurationMs: 5_000,
  recoveryFpsHz: 52,
  recoveryDurationMs: 10_000,
  note: 'Copied from the unmodified baseline config for interpretation; this runner does not change thresholds or behavior.',
};

const children = [];
const serverLogs = [];
const save = (file, value) => writeFileSync(path.join(output, file), JSON.stringify(value, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function server(args, env = {}) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => serverLogs.push(chunk.toString()));
  children.push(child);
  return child;
}

async function ready(url) {
  for (let attempt = 0; attempt < 300; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await sleep(100);
  }
  throw new Error(`Server not ready: ${url}`);
}

function installProbe() {
  let seed = 713;
  Math.random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const nativeRequest = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const enginePending = new Set();
  let browserIntervals = [];
  let browserLast;
  let browserProbeDurations = [];
  let engineIntervals = [];
  let engineDurations = [];
  let engineLast;
  let maxPending = 0;
  let longTasks = [];

  const browserProbe = timestamp => {
    const started = performance.now();
    if (browserLast !== undefined) browserIntervals.push(timestamp - browserLast);
    browserLast = timestamp;
    browserProbeDurations.push(performance.now() - started);
    nativeRequest(browserProbe);
  };
  nativeRequest(browserProbe);

  window.requestAnimationFrame = callback => {
    const id = nativeRequest(timestamp => {
      enginePending.delete(id);
      if (engineLast !== undefined) engineIntervals.push(timestamp - engineLast);
      engineLast = timestamp;
      const started = performance.now();
      callback(timestamp);
      engineDurations.push(performance.now() - started);
    });
    enginePending.add(id);
    maxPending = Math.max(maxPending, enginePending.size);
    return id;
  };
  window.cancelAnimationFrame = id => {
    enginePending.delete(id);
    nativeCancel(id);
  };

  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}

  window.__p15Probe = {
    snapshot(reset = false) {
      const result = {
        browserIntervals,
        browserProbeDurations,
        engineIntervals,
        engineDurations,
        longTasks,
        maxPending,
        pending: enginePending.size,
      };
      if (reset) {
        browserIntervals = [];
        browserProbeDurations = [];
        engineIntervals = [];
        engineDurations = [];
        longTasks = [];
        browserLast = undefined;
        engineLast = undefined;
        maxPending = enginePending.size;
      }
      return result;
    },
  };
}

function parseDirector(debugText) {
  const fps = Number(debugText.match(/FPS ([0-9.]+)/)?.[1] ?? NaN);
  const level = debugText.match(/档位 (normal|low|static)/)?.[1] ?? null;
  return { fps: Number.isFinite(fps) ? fps : null, level };
}

function deltaMetrics(before, after) {
  const first = Object.fromEntries(before.metrics.map(item => [item.name, item.value]));
  const last = Object.fromEntries(after.metrics.map(item => [item.name, item.value]));
  const names = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'JSHeapUsedSize', 'Nodes', 'LayoutCount', 'RecalcStyleCount'];
  return Object.fromEntries(names.map(name => [name, first[name] == null || last[name] == null ? null : last[name] - first[name]]));
}

function webglInfo() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return { available: false, renderer: 'unknown', vendor: 'unknown', collection: 'temporary canvas WebGL context' };
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    available: true,
    renderer: gl.getParameter(gl.RENDERER) || 'unknown',
    vendor: gl.getParameter(gl.VENDOR) || 'unknown',
    unmaskedRenderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) || 'unknown' : 'unknown',
    unmaskedVendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) || 'unknown' : 'unknown',
    debugExtensionAvailable: Boolean(extension),
    collection: 'temporary canvas WebGL context; WEBGL_debug_renderer_info when available',
  };
}

async function browserEnvironment(browser, launchOptions) {
  const session = await browser.newBrowserCDPSession();
  const gpu = await session.send('SystemInfo.getInfo');
  let commandLine;
  try { commandLine = await session.send('Browser.getBrowserCommandLine'); }
  catch (error) { commandLine = { unavailable: true, reason: error.message }; }
  let displays = { available: false, reason: 'system_profiler unavailable' };
  try {
    const raw = JSON.parse(execFileSync('system_profiler', ['SPDisplaysDataType', '-json'], { encoding: 'utf8' }));
    displays = {
      available: true,
      collection: 'macOS system_profiler SPDisplaysDataType -json',
      adapters: raw.SPDisplaysDataType.map(adapter => ({
        model: adapter.sppci_model ?? 'unknown',
        cores: adapter.sppci_cores ?? 'unknown',
        metal: adapter.spdisplays_metal ?? 'unknown',
        deviceType: adapter.spdisplays_device_type ?? 'unknown',
        displays: (adapter.spdisplays_ndrvs ?? []).map(display => {
          const resolution = display.spdisplays_resolution ?? 'unknown';
          const parsedRefresh = typeof resolution === 'string' ? Number(resolution.match(/@\s*([0-9.]+)Hz/i)?.[1] ?? NaN) : NaN;
          return {
            name: display._name ?? 'unknown',
            resolution,
            pixels: display.spdisplays_pixels ?? 'unknown',
            refreshRate: display.spdisplays_refresh_rate ?? (Number.isFinite(parsedRefresh) ? `${parsedRefresh} Hz (parsed from resolution string)` : 'unknown'),
          };
        }),
      })),
    };
  } catch (error) { displays.reason = error.message; }
  return {
    capturedAt: new Date().toISOString(),
    browserName: 'Chromium',
    browserVersion: browser.version(),
    headless,
    launchOptions,
    effectiveBrowserCommandLine: commandLine.arguments ?? null,
    effectiveBrowserCommandLineError: commandLine.unavailable ? commandLine.reason : null,
    operatingSystem: { platform: os.platform(), release: os.release(), architecture: os.arch() },
    hardware: {
      cpuModel: os.cpus()[0]?.model ?? 'unknown',
      logicalCores: os.cpus().length,
      memoryBytes: os.totalmem(),
    },
    nodeVersion: process.version,
    gpuSystemInfo: gpu,
    displays,
  };
}

async function createScenario(browser, engine, width) {
  await fetch(`${fixture}/control?reset=1`);
  const context = await browser.newContext({
    viewport: { width, height: width * 9 / 16 },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
    timezoneId: 'Asia/Shanghai',
  });
  await context.addInitScript(installProbe);
  const page = await context.newPage();
  const errors = [];
  const networkFailures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => networkFailures.push({ url: request.url(), error: request.failure()?.errorText ?? 'unknown' }));
  page.on('response', response => { if (response.status() >= 400) networkFailures.push({ url: response.url(), status: response.status() }); });

  await page.goto('about:blank');
  await page.waitForTimeout(calibrationMs);
  const calibrationRaw = await page.evaluate(() => window.__p15Probe.snapshot(true));
  const calibration = summarizeIntervals(calibrationRaw.browserIntervals, calibrationMs);
  calibration.interpretation = headless
    ? 'Headless browser scheduling cadence estimate; physical display refresh is not observable and remains unknown.'
    : 'Visible Chromium RAF scheduling cadence estimate; compare with system_profiler display data, but do not treat as compositor presentation telemetry.';

  await page.goto(`${base}/screen/sales?layout=16x9&motion=${engine}&debug=1`);
  await page.locator(`#screen-stage[data-motion-engine="${engine}"]`).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(3_000);
  await page.addStyleTag({ content: '.nexus-motion-debug{display:none!important}' });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const gl = await page.evaluate(webglInfo);
  return { context, page, cdp, errors, networkFailures, calibration, webgl: gl };
}

function summarizeFormal(raw, actualMs, calibration, engine, series) {
  const browserRafProxy = summarizeIntervals(raw.browserIntervals, actualMs);
  const engineCallbacks = summarizeIntervals(raw.engineIntervals, actualMs);
  const directorValues = series.map(row => row.directorUpdateHz).filter(Number.isFinite);
  const director = {
    sampleCount: directorValues.length,
    meanHz: mean(directorValues),
    p05Hz: nearestRank(directorValues, 0.05),
    p50Hz: nearestRank(directorValues, 0.5),
    p95Hz: nearestRank(directorValues, 0.95),
    minHz: directorValues.length ? Math.min(...directorValues) : null,
    maxHz: directorValues.length ? Math.max(...directorValues) : null,
    source: 'Existing MotionDirector internal one-second sample, read from the debug panel once per second.',
  };
  const referenceInterval = calibration.intervalP50Ms;
  return {
    browserRafProxy: {
      ...browserRafProxy,
      meaning: 'Independent native requestAnimationFrame callback cadence. Proxy for browser scheduling opportunities only; not actual presented FPS.',
    },
    engineClock: {
      kind: engine === 'legacy' ? 'Legacy requestAnimationFrame callback' : 'GSAP ticker underlying requestAnimationFrame callback',
      ...engineCallbacks,
      maxPendingCallbacks: raw.maxPending,
      callbackCost: summarizeDurations(raw.engineDurations),
      meaning: engine === 'legacy'
        ? 'Legacy MotionDirector host callback cadence.'
        : 'Browser RAF callbacks driving GSAP ticker; GSAP listener updates may be throttled below this cadence.',
    },
    gsapTicker: engine === 'gsap' ? {
      configuredCapHz: 60,
      observedListenerUpdateHzEstimate: director.meanHz,
      method: 'Current createHost has one pending MotionDirector job per GSAP ticker listener update. The listener rate is therefore inferred 1:1 from Director updates, while underlying ticker RAF is measured separately above.',
      independentDirectInstrumentation: false,
    } : null,
    motionDirector: director,
    missedCallbackOpportunities: estimateMissedOpportunities(raw.engineIntervals, referenceInterval),
    longTasks: summarizeLongTasks(raw.longTasks),
    collectionOverhead: {
      browserProbeCallbackCost: summarizeDurations(raw.browserProbeDurations),
      note: 'The independent RAF probe adds one minimal callback per browser scheduling opportunity. Trace, screenshot, and video overhead are excluded from this formal phase.',
    },
  };
}

async function runFormal(browser, engine, width) {
  const id = `${engine}-${width}`;
  console.log(`FORMAL ${backend} ${id}`);
  const scenario = await createScenario(browser, engine, width);
  const { context, page, cdp, errors, networkFailures, calibration, webgl } = scenario;
  // Warm-up can already accumulate a low-FPS window at 4K. The existing debug
  // action resets the policy counters and starts every comparable formal window
  // from normal/automatic mode without changing thresholds or recovery rules.
  await page.getByRole('button', { name: '恢复自动档', includeHidden: true }).evaluate(element => element.click());
  await page.evaluate(() => window.__p15Probe.snapshot(true));
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(100);
  await page.evaluate(() => window.__p15Probe.snapshot(true));
  const before = await cdp.send('Performance.getMetrics');
  const startedAt = Date.now();
  const initial = await page.evaluate(() => {
    const stage = document.querySelector('#screen-stage');
    const debugText = document.querySelector('.nexus-motion-debug p:nth-child(2)')?.textContent ?? '';
    return { level: stage?.dataset.motionLevel ?? 'unknown', state: stage?.dataset.motionState ?? 'unknown', debugText };
  });
  const initialDirector = parseDirector(initial.debugText);
  const series = [{
    elapsedMs: 0,
    level: initial.level,
    state: initial.state,
    browserRafProxyHz: null,
    engineCallbackHz: null,
    engineIntervalP95Ms: null,
    directorUpdateHz: initialDirector.fps,
    longTasks: 0,
    performanceRecords: [],
  }];
  const raw = { browserIntervals: [], browserProbeDurations: [], engineIntervals: [], engineDurations: [], longTasks: [], maxPending: 0 };
  const pulseRequests = [];
  const pulseSchedule = [10_000, 30_000, 50_000].filter(at => at < formalMs - 2_000);
  let pulseIndex = 0;

  while (Date.now() - startedAt < formalMs) {
    const remaining = formalMs - (Date.now() - startedAt);
    await page.waitForTimeout(Math.min(sampleMs, remaining));
    const elapsedMs = Date.now() - startedAt;
    const row = await page.evaluate(() => {
      const probe = window.__p15Probe.snapshot(true);
      const stage = document.querySelector('#screen-stage');
      const debugText = document.querySelector('.nexus-motion-debug p:nth-child(2)')?.textContent ?? '';
      const records = JSON.parse(document.querySelector('[data-performance-log]')?.textContent || '[]');
      return {
        probe,
        debugText,
        level: stage?.dataset.motionLevel ?? 'unknown',
        state: stage?.dataset.motionState ?? 'unknown',
        records,
      };
    });
    raw.browserIntervals.push(...row.probe.browserIntervals);
    raw.browserProbeDurations.push(...row.probe.browserProbeDurations);
    raw.engineIntervals.push(...row.probe.engineIntervals);
    raw.engineDurations.push(...row.probe.engineDurations);
    raw.longTasks.push(...row.probe.longTasks);
    raw.maxPending = Math.max(raw.maxPending, row.probe.maxPending);
    const director = parseDirector(row.debugText);
    series.push({
      elapsedMs,
      level: row.level,
      state: row.state,
      browserRafProxyHz: summarizeIntervals(row.probe.browserIntervals, sampleMs).rateHz,
      engineCallbackHz: summarizeIntervals(row.probe.engineIntervals, sampleMs).rateHz,
      engineIntervalP95Ms: nearestRank(row.probe.engineIntervals, 0.95),
      directorUpdateHz: director.fps,
      longTasks: row.probe.longTasks.length,
      performanceRecords: row.records,
    });

    while (pulseIndex < pulseSchedule.length && elapsedMs >= pulseSchedule[pulseIndex]) {
      const result = await page.evaluate(() => {
        const stage = document.querySelector('#screen-stage');
        const beforeLevel = stage?.dataset.motionLevel ?? 'unknown';
        const beforeState = stage?.dataset.motionState ?? 'unknown';
        document.querySelector('.nexus-motion-debug button:nth-of-type(2)')?.click();
        return {
          beforeLevel,
          beforeState,
          afterLevel: stage?.dataset.motionLevel ?? 'unknown',
          afterState: stage?.dataset.motionState ?? 'unknown',
        };
      });
      pulseRequests.push({
        scheduledAtMs: pulseSchedule[pulseIndex],
        observedAtMs: elapsedMs,
        ...result,
        accepted: result.beforeLevel === 'normal' && result.beforeState !== 'PULSE',
        acceptanceMethod: 'Derived from the unchanged synchronous MotionDirector trigger preconditions. The stage dataset is written on the following draw, so the immediate afterState is intentionally not used as the acceptance signal.',
        rejectionReason: result.beforeLevel !== 'normal' ? 'motion-level-not-normal' : result.beforeState === 'PULSE' ? 'pulse-already-active' : null,
      });
      pulseIndex++;
    }
    save('progress.json', { backend, engine, width, elapsedMs, targetMs: formalMs, latest: series.at(-1) });
    console.log(`${backend} ${id}: ${Math.round(elapsedMs / 1000)}s/${formalMs / 1000}s level=${row.level} director=${director.fps ?? 'unknown'}`);
  }

  const actualMs = Date.now() - startedAt;
  const after = await cdp.send('Performance.getMetrics');
  const directorRecords = await page.evaluate(() => JSON.parse(document.querySelector('[data-performance-log]')?.textContent || '[]'));
  const result = {
    id,
    engine,
    engineType: engine === 'legacy' ? 'Legacy MotionDirector via native RAF' : 'GSAP ticker adapter -> MotionDirector',
    backendLabel: backend,
    headless,
    viewport: { width, height: width * 9 / 16, deviceScaleFactor: 1 },
    duration: { requestedMs: formalMs, actualMs },
    calibration,
    sampleCounts: {
      timeSeries: series.length,
      browserRafIntervals: raw.browserIntervals.length,
      engineCallbackIntervals: raw.engineIntervals.length,
      directorFrequencySamples: series.filter(row => Number.isFinite(row.directorUpdateHz)).length,
      longTasks: raw.longTasks.length,
    },
    metrics: summarizeFormal(raw, actualMs, calibration, engine, series),
    mainThreadCdpDelta: {
      ...deltaMetrics(before, after),
      note: 'CDP cumulative deltas for the formal timing window. These do not include compositor/raster/GPU cost.',
    },
    qualityPolicy: QUALITY_POLICY,
    qualityTimeline: series,
    qualityTransitions: transitionSummary(series),
    directorRecords,
    formalDirectorRecords: directorRecords.filter(record => Date.parse(record.at) >= startedAt),
    pulseRequests,
    resonanceRejectedBecauseLow: pulseRequests.filter(item => item.rejectionReason === 'motion-level-not-normal').length,
    webgl,
    rendererClassification: classifyRenderer(null, webgl),
    errors,
    networkFailures,
  };
  save(`${id}-formal.json`, result);
  await context.close();
  return result;
}

async function streamTrace(cdp, file, callback) {
  const completed = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    traceConfig: {
      recordMode: 'recordContinuously',
      traceBufferSizeInKb: 262_144,
      includedCategories: 'toplevel,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking,disabled-by-default-devtools.timeline.layers,blink.user_timing,cc,gpu,viz,benchmark,disabled-by-default-gpu.service'.split(','),
    },
  });
  const metadata = await callback();
  await cdp.send('Tracing.end');
  const { stream, ...traceStatus } = await completed;
  const gzip = createGzip();
  const destination = createWriteStream(file);
  gzip.pipe(destination);
  while (true) {
    const chunk = await cdp.send('IO.read', { handle: stream });
    if (chunk.data && !gzip.write(Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8'))) await once(gzip, 'drain');
    if (chunk.eof) break;
  }
  await cdp.send('IO.close', { handle: stream });
  gzip.end();
  await once(destination, 'finish');
  return { metadata, traceStatus };
}

async function runTrace(browser, engine, width) {
  const id = `${engine}-${width}`;
  console.log(`TRACE ${backend} ${id}`);
  const { context, page, cdp, errors, calibration, webgl } = await createScenario(browser, engine, width);
  const file = path.join(output, `${id}.trace.json.gz`);
  const trace = await streamTrace(cdp, file, async () => {
    await page.evaluate(() => performance.mark('P15A:trace-start'));
    const startedAt = Date.now();
    await page.waitForTimeout(Math.min(2_000, traceMs / 3));
    const pulse = await page.evaluate(() => {
      const stage = document.querySelector('#screen-stage');
      const before = { level: stage?.dataset.motionLevel ?? 'unknown', state: stage?.dataset.motionState ?? 'unknown' };
      document.querySelector('.nexus-motion-debug button:nth-of-type(2)')?.click();
      return { before, after: { level: stage?.dataset.motionLevel ?? 'unknown', state: stage?.dataset.motionState ?? 'unknown' } };
    });
    await page.waitForTimeout(Math.max(0, traceMs - (Date.now() - startedAt)));
    await page.evaluate(() => performance.mark('P15A:trace-end'));
    return { actualMs: Date.now() - startedAt, pulse };
  });
  const result = { id, engine, width, height: width * 9 / 16, backend, headless, calibration, webgl, errors, rawTrace: path.relative(process.cwd(), file), ...trace };
  save(`${id}-trace-metadata.json`, result);
  await context.close();
  return result;
}

async function runVisual(browser, engine, width) {
  const id = `${engine}-${width}`;
  console.log(`VISUAL ${backend} ${id}`);
  const { context, page, webgl, errors } = await createScenario(browser, engine, width);
  await page.screenshot({ path: path.join(output, `${id}-ambient.png`) });
  const pulse = await page.evaluate(() => {
    const stage = document.querySelector('#screen-stage');
    const before = { level: stage?.dataset.motionLevel ?? 'unknown', state: stage?.dataset.motionState ?? 'unknown' };
    document.querySelector('.nexus-motion-debug button:nth-of-type(2)')?.click();
    return { before, after: { level: stage?.dataset.motionLevel ?? 'unknown', state: stage?.dataset.motionState ?? 'unknown' } };
  });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: path.join(output, `${id}-pulse.png`) });
  const result = { id, engine, width, height: width * 9 / 16, backend, headless, webgl, pulse, errors, collection: 'Separate screenshot phase; excluded from formal timing.' };
  save(`${id}-visual.json`, result);
  await context.close();
  return result;
}

let browser;
let report = {
  schemaVersion: 1,
  task: 'NEXUS P1.5-A performance benchmark calibration',
  baselines: BASELINES,
  startedAt: new Date().toISOString(),
  backend,
  phase,
  methodology: {
    randomSeed: 713,
    fixture: 'Local deterministic fixture only; generatedAt normalized before hashing.',
    execution: 'Sequential scenarios, production build, same Chromium, DPR=1, no trace/screenshot/video during formal timing.',
    formalStartNormalization: 'After font/page warm-up, the existing debug Restore automatic level action resets policy counters so every formal window begins at normal level. Thresholds and recovery behavior remain unchanged.',
    definitions: {
      browserRafProxy: 'Independent native RAF cadence; browser scheduling proxy, never labeled actual presented FPS.',
      engineClock: 'Legacy RAF callback or GSAP ticker underlying RAF callback, depending on engine.',
      gsapTickerUpdate: 'Configured cap plus 1:1 estimate from MotionDirector updates; underlying browser RAF is separate.',
      motionDirectorUpdate: 'Existing internal one-second update-frequency calculation shown by debug UI.',
      droppedFrameProxy: 'Missed callback opportunities relative to per-scenario calibrated browser interval; not actual displayed-frame loss.',
      p95p99: 'Nearest-rank percentiles over raw intervals or durations.',
      longTask: 'PerformanceLongTaskTiming entries; total blocking time counts duration above 50ms.',
    },
    qualityPolicy: QUALITY_POLICY,
  },
  formalResults: [],
  traceResults: [],
  visualResults: [],
};
const reportFile = path.join(output, 'benchmark.json');
if (phase !== 'all' && existsSync(reportFile)) {
  const previous = JSON.parse(readFileSync(reportFile, 'utf8'));
  if (previous.backend === backend && previous.baselines?.p14 === BASELINES.p14) {
    report = { ...previous, phase, phaseStartedAt: new Date().toISOString() };
    if (phase === 'formal') report.formalResults = [];
    if (phase === 'trace') report.traceResults = [];
    if (phase === 'visual') report.visualResults = [];
  }
}

try {
  for (const url of [base, fixture]) {
    let occupied = false;
    try { await fetch(url); occupied = true; } catch {}
    if (occupied) throw new Error(`Refusing to reuse occupied port: ${url}`);
  }
  if (fixturePort !== 3199) throw new Error('The existing isolated fixture server is fixed to port 3199; use P15_FIXTURE_PORT=3199.');
  server(['e2e/nexus-fixture-server.mjs']);
  await ready(fixture);
  server(['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    SCREEN_PLATFORM_URL: fixture,
    SCREEN_PUBLIC_ID: 'fixture-only',
    TZ: 'Asia/Shanghai',
  });
  await ready(`${base}/screen/sales?source=mock`);

  const launchOptions = { headless };
  browser = await chromium.launch(launchOptions);
  report.environment = await browserEnvironment(browser, launchOptions);
  const payload = await (await fetch(fixture)).json();
  const normalizedPayload = { ...payload, generatedAt: 'NORMALIZED' };
  report.fixture = {
    normalizedSha256: createHash('sha256').update(JSON.stringify(normalizedPayload)).digest('hex'),
    generatedAtTreatment: 'generatedAt replaced with NORMALIZED before hashing',
  };

  const scenarios = [
    ['legacy', 1920],
    ['gsap', 1920],
    ['legacy', 3840],
    ['gsap', 3840],
  ];
  if (phase === 'all' || phase === 'formal') {
    for (const [engine, width] of scenarios) {
      report.formalResults.push(await runFormal(browser, engine, width));
      save('benchmark.json', report);
    }
  }
  if (phase === 'all' || phase === 'trace') {
    for (const [engine, width] of scenarios) {
      report.traceResults.push(await runTrace(browser, engine, width));
      save('benchmark.json', report);
    }
  }
  if (phase === 'all' || phase === 'visual') {
    for (const [engine, width] of scenarios) {
      report.visualResults.push(await runVisual(browser, engine, width));
      save('benchmark.json', report);
    }
  }
  const webglSamples = [...report.formalResults, ...report.traceResults, ...report.visualResults].map(item => item.webgl).filter(Boolean);
  report.rendererClassification = classifyRenderer(report.environment.gpuSystemInfo, webglSamples);
  report.finishedAt = new Date().toISOString();
  save('benchmark.json', report);
  console.log(JSON.stringify({ backend, phase, formal: report.formalResults.length, traces: report.traceResults.length, visuals: report.visualResults.length, renderer: report.rendererClassification }));
} finally {
  await browser?.close();
  for (const child of children) child.kill('SIGTERM');
  writeFileSync(path.join(output, `${phase}-servers.log`), serverLogs.join(''));
}
