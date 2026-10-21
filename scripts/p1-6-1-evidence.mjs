import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
const base = '1c09242cfb7c8a51fd34d687e67c24f475135372';
const root = 'docs/nexus-p1-6-1';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const hash = value => createHash('sha256').update(value).digest('hex');
const old = path => execFileSync('git', ['show', `${base}:${path}`]);
const protectedPaths = ['src/components/overlay/JarvisCore.tsx', 'src/components/overlay/AnswerCard.tsx',
  'src/components/overlay/overlay.css', 'src/components/overlay/cards', 'src/components/overlay/spoken-pages.ts',
  'src/components/screen/motion', 'src/lib/voice', 'src/lib/public-screen-payload.ts',
  'services/voice-orchestrator/src', 'services/voice-local'];
const files = git('ls-files', '-z', '--', ...protectedPaths).split('\0').filter(path => path && !/\.test\./.test(path));
const unchanged = files.map(path => ({ path, baseSha256: hash(old(path)), currentSha256: hash(readFileSync(path)) }));
const section = (path, start, end) => {
  const before = old(path).toString(), after = readFileSync(path, 'utf8');
  const extract = text => text.slice(text.indexOf(start), end ? text.indexOf(end) : undefined);
  return { path, section: start, baseSha256: hash(extract(before)), currentSha256: hash(extract(after)) };
};
const sections = [
  section('src/components/overlay/motion/XiaochuanTimeline.ts', '  /** One shared answer clock', '  setReduced('),
  section('src/components/overlay/OverlayStage.tsx', '  const rootRef ='),
];
for (const entry of [...unchanged, ...sections]) {
  if (entry.baseSha256 !== entry.currentSha256) throw new Error(`Behavior source changed: ${entry.path}`);
}
writeFileSync(`${root}/evidence/behavior-source-equivalence.json`, JSON.stringify({ base, unchanged, sections }, null, 2));

function specs(suite) { return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specs)]; }
const reports = ['browser-initial', 'browser-hardening', 'legacy-regression', 'legacy-context-recheck', 'gsap-regression',
  'baseline-cpu-url-harness-initial', 'baseline-live-url-harness-initial',
  'baseline-cpu', 'baseline-live', 'gsap-cpu-recheck', 'gsap-live-recheck'];
const validation = reports.filter(name => existsSync(`${root}/evidence/${name}.json`)).map(name => {
  const result = JSON.parse(readFileSync(`${root}/evidence/${name}.json`));
  const tests = result.suites.flatMap(specs).map(spec => ({ title: spec.title, file: spec.file,
    results: spec.tests.map(test => ({ status: test.status, attempts: test.results.map(attempt => attempt.status) })) }));
  return { name, validModeComparison: !name.endsWith('-url-harness-initial'), stats: result.stats, tests };
});
writeFileSync(`${root}/evidence/validation-summary.json`, JSON.stringify(validation, null, 2));
const sampleSummary = values => {
  const sorted = values.toSorted((a, b) => a - b);
  return { n: sorted.length, mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p95: sorted[Math.floor((sorted.length - 1) * .95)] };
};
const film = (dir, engine) => {
  const d = JSON.parse(readFileSync(`${dir}/${engine}-film.json`));
  const at = Number(d.metrics.samples.find(s => Number(s.launchAt) > 0 && s.state === 'answering').launchAt);
  const first = d.metrics.scheduled.find(s => s.at >= at);
  return { engine, firstAudioScheduledMs: first.at - at, firstAudioOnsetMs: first.at - at + (first.when - first.contextTime) * 1000,
    peak: d.metrics.peak, errors: d.errors, pcmSeconds: d.pcmSeconds, audit: d.audit,
    playbackEvents: d.reports.filter(r => r.type.startsWith('playback.')).map(r => ({ type: r.type, turnId: r.turnId })),
    rafIntervalMs: sampleSummary(d.metrics.frames) };
};
writeFileSync(`${root}/evidence/p16-comparison.json`, JSON.stringify({
  note: 'Baseline is committed P1.6 evidence; timings are short browser observations, not a latency guarantee or venue acceptance.',
  baseline: ['legacy', 'gsap'].map(engine => film('docs/nexus-p1-6/evidence', engine)),
  current: ['legacy', 'gsap'].map(engine => film(`${root}/p16/evidence`, engine)),
}, null, 2));
if (existsSync(`${root}/evidence/gsap-p13`)) {
  const modes = ['legacy', 'gsap'].map(mode => {
    const dir = `${root}/evidence/${mode}-p13`;
    return { mode, cases: readdirSync(dir).filter(name => name.endsWith('.json')).map(name => ({ name, ...JSON.parse(readFileSync(`${dir}/${name}`)) })) };
  });
  const deltas = [];
  for (const before of modes[0].cases) {
    const after = modes[1].cases.find(item => item.name === before.name);
    if (!after) throw new Error(`Missing GSAP geometry case: ${before.name}`);
    for (const [selector, rect] of Object.entries(before.rects)) {
      const other = after.rects[selector];
      if (!rect || !other) { if (rect !== other) deltas.push({ name: before.name, selector, before: rect, after: other }); continue; }
      for (const key of ['x', 'y', 'width', 'height']) {
        // Report actual deltas; do not introduce a new acceptance tolerance or alter existing assertions.
        if (rect[key] !== other[key]) deltas.push({ name: before.name, selector, key, delta: other[key] - rect[key] });
      }
    }
  }
  writeFileSync(`${root}/evidence/p13-comparison.json`, JSON.stringify({
    modes: modes.map(({ mode, cases }) => ({ mode, records: cases.length,
      violations: cases.flatMap(item => item.violations), textFailures: cases.flatMap(item => item.textFailures) })),
    rectangleDeltas: deltas,
  }, null, 2));
}
console.log(JSON.stringify({ unchangedFiles: unchanged.length, identicalSections: sections.length, reports: validation.map(({ name, stats }) => ({ name, stats })) }, null, 2));
