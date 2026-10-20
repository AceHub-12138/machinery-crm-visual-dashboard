import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { nearestRank } from '../p1-5-a/metrics.mjs';
import { dispersion } from './stats.mjs';

const root = path.resolve(process.argv[2] ?? '.review/p1-5-b');
const backends = ['headless-swiftshader', 'headed-metal', 'headed-swiftshader'];

function summary(events) {
  const values = events.map(event => event.dur / 1000).filter(Number.isFinite);
  return {
    count: values.length,
    inclusiveTotalMs: values.reduce((sum, value) => sum + value, 0),
    p95Ms: nearestRank(values, 0.95),
    p99Ms: nearestRank(values, 0.99),
    maxMs: values.length ? values.reduce((maximum, value) => Math.max(maximum, value), -Infinity) : null,
  };
}

function parse(file) {
  const json = JSON.parse(gunzipSync(readFileSync(file)));
  const events = json.traceEvents ?? json;
  const processNames = new Map(), threadNames = new Map();
  for (const event of events) {
    if (event.ph !== 'M') continue;
    if (event.name === 'process_name') processNames.set(event.pid, event.args?.name ?? 'unknown');
    if (event.name === 'thread_name') threadNames.set(`${event.pid}:${event.tid}`, event.args?.name ?? 'unknown');
  }
  const complete = events.filter(event => event.ph === 'X' && Number.isFinite(event.dur));
  const rendererMain = complete.filter(event => /CrRendererMain|RendererMain/i.test(threadNames.get(`${event.pid}:${event.tid}`) ?? ''));
  const script = rendererMain.filter(event => /^(FunctionCall|EvaluateScript|v8\.execute|RunMicrotasks|TimerFire)$/i.test(event.name));
  const layoutStyle = rendererMain.filter(event => /^(Layout|UpdateLayoutTree|RecalculateStyles)$/i.test(event.name));
  const paint = complete.filter(event => /^(Paint|PaintImage|PrePaint|UpdateLayoutTree)$/.test(event.name));
  const compositeRaster = complete.filter(event => /^(CompositeLayers|RasterTask|DrawFrame|Commit|ActivateLayerTree|LayerTreeHostImpl::.*|TileManager::.*)$/.test(event.name));
  const gpu = complete.filter(event => /GPU Process/i.test(processNames.get(event.pid) ?? '') || /^(GPUTask|Graphics\.Pipeline|CommandBuffer::.*|Skia.*|GrMtl.*)$/.test(event.name));
  return {
    file: path.relative(process.cwd(), file), traceEventCount: events.length,
    costs: { rendererMain: summary(rendererMain), scriptAnimation: summary(script), layoutStyle: summary(layoutStyle), paint: summary(paint), compositeRaster: summary(compositeRaster), gpuProcess: summary(gpu) },
    interpretation: { additive: false, note: 'Inclusive events overlap across nesting and threads. GPU process time is not GPU utilization or presentation FPS.' },
  };
}

const runs = [];
for (const backend of backends) {
  const directory = path.join(root, backend, 'trace-shared60');
  let files = [];
  try { files = readdirSync(directory).filter(file => file.endsWith('.trace.json.gz')).sort(); } catch { continue; }
  for (const name of files) {
    const match = name.match(/^(legacy|gsap)-(1920|3840)-r(\d+)\.trace\.json\.gz$/);
    if (!match) continue;
    runs.push({ backend, engine: match[1], width: Number(match[2]), repetition: Number(match[3]), ...parse(path.join(directory, name)) });
  }
}

const groups = new Map();
for (const run of runs) {
  const id = `${run.backend}|${run.engine}|${run.width}`;
  const group = groups.get(id) ?? { backend: run.backend, engine: run.engine, width: run.width, repetitions: 0, values: {} };
  group.repetitions++;
  for (const [category, value] of Object.entries(run.costs)) {
    for (const metric of ['count', 'inclusiveTotalMs', 'p95Ms', 'p99Ms', 'maxMs']) {
      const key = `${category}.${metric}`;
      (group.values[key] ??= []).push(value[metric]);
    }
  }
  groups.set(id, group);
}
const summaryGroups = [...groups.values()].map(group => ({
  backend: group.backend, engine: group.engine, width: group.width, repetitions: group.repetitions,
  metrics: Object.fromEntries(Object.entries(group.values).map(([key, values]) => [key, dispersion(values)])),
}));

const output = { generatedAt: new Date().toISOString(), runs, summary: summaryGroups, caveat: 'Trace phase is separate from formal timing; inclusive event durations are non-additive.' };
writeFileSync(path.join(root, 'trace-analysis.json'), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ runs: runs.length, groups: summaryGroups.length }, null, 2));
