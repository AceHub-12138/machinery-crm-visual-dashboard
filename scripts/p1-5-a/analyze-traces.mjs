import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { nearestRank } from './metrics.mjs';

const root = path.resolve(process.argv[2] ?? '.review/p1-5-a');

function eventSummary(events) {
  const durations = events.map(event => event.dur / 1000).filter(Number.isFinite);
  return {
    count: durations.length,
    inclusiveTotalMs: durations.reduce((sum, duration) => sum + duration, 0),
    p95Ms: nearestRank(durations, 0.95),
    p99Ms: nearestRank(durations, 0.99),
    maxMs: durations.length ? durations.reduce((maximum, duration) => Math.max(maximum, duration), -Infinity) : null,
  };
}

function aggregateByName(events, limit = 25) {
  const grouped = new Map();
  for (const event of events) {
    const item = grouped.get(event.name) ?? [];
    item.push(event);
    grouped.set(event.name, item);
  }
  return [...grouped.entries()]
    .map(([name, items]) => ({ name, ...eventSummary(items) }))
    .sort((a, b) => b.inclusiveTotalMs - a.inclusiveTotalMs)
    .slice(0, limit);
}

function parseTrace(file) {
  const trace = JSON.parse(gunzipSync(readFileSync(file)));
  const events = trace.traceEvents ?? trace;
  const processNames = new Map();
  const threadNames = new Map();
  for (const event of events) {
    if (event.ph !== 'M') continue;
    if (event.name === 'process_name') processNames.set(event.pid, event.args?.name ?? 'unknown');
    if (event.name === 'thread_name') threadNames.set(`${event.pid}:${event.tid}`, event.args?.name ?? 'unknown');
  }
  const complete = events.filter(event => event.ph === 'X' && Number.isFinite(event.dur));
  const rendererMain = complete.filter(event => {
    const thread = threadNames.get(`${event.pid}:${event.tid}`) ?? '';
    return /CrRendererMain|RendererMain/i.test(thread);
  });
  const paintNames = /^(Paint|PaintImage|PrePaint|UpdateLayoutTree)$/;
  const compositeRasterNames = /^(CompositeLayers|RasterTask|DrawFrame|Commit|ActivateLayerTree|LayerTreeHostImpl::.*|TileManager::.*)$/;
  const gpuNames = /^(GPUTask|Graphics\.Pipeline|CommandBuffer::.*|Skia.*|GrMtl.*)$/;
  const paint = complete.filter(event => paintNames.test(event.name));
  const compositeRaster = complete.filter(event => compositeRasterNames.test(event.name));
  const gpuProcess = complete.filter(event => /GPU Process/i.test(processNames.get(event.pid) ?? '') || gpuNames.test(event.name));
  const script = rendererMain.filter(event => /^(FunctionCall|EvaluateScript|v8\.execute|RunMicrotasks|TimerFire)$/i.test(event.name));
  const layoutStyle = rendererMain.filter(event => /^(Layout|UpdateLayoutTree|RecalculateStyles)$/i.test(event.name));
  const marks = events.filter(event => String(event.name).startsWith('P15A:')).map(event => ({ name: event.name, timestampUs: event.ts }));
  return {
    file: path.relative(process.cwd(), file),
    traceEventCount: events.length,
    processNames: Object.fromEntries(processNames),
    threadNames: Object.fromEntries(threadNames),
    userTimingMarks: marks,
    costs: {
      rendererMainThread: eventSummary(rendererMain),
      scriptAndAnimationCalculation: eventSummary(script),
      layoutAndStyle: eventSummary(layoutStyle),
      paint: eventSummary(paint),
      compositeAndRaster: eventSummary(compositeRaster),
      gpuProcess: eventSummary(gpuProcess),
    },
    topEvents: {
      rendererMainThread: aggregateByName(rendererMain),
      paint: aggregateByName(paint),
      compositeAndRaster: aggregateByName(compositeRaster),
      gpuProcess: aggregateByName(gpuProcess),
    },
    interpretation: {
      unit: 'milliseconds',
      durationType: 'inclusive trace event duration',
      additive: false,
      warning: 'Trace categories overlap and must not be summed into a total. GPU process event time is not GPU utilization, power, or presented-frame telemetry.',
    },
  };
}

const all = [];
for (const backend of ['headless', 'headed']) {
  const directory = path.join(root, backend);
  let files = [];
  try { files = readdirSync(directory).filter(file => file.endsWith('.trace.json.gz')).sort(); }
  catch { continue; }
  const summaries = files.map(file => ({ backend, ...parseTrace(path.join(directory, file)) }));
  writeFileSync(path.join(directory, 'trace-summary.json'), JSON.stringify(summaries, null, 2));
  all.push(...summaries);
}
writeFileSync(path.join(root, 'trace-summary.json'), JSON.stringify(all, null, 2));
console.log(JSON.stringify({ traces: all.length, files: all.map(item => item.file) }, null, 2));
