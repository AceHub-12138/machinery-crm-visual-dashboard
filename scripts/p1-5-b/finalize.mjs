import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const review = path.resolve('.review/p1-5-b');
const evidence = path.resolve('docs/nexus-p1-5-b/evidence');
mkdirSync(evidence, { recursive: true });
const copyJson = (source, target) => writeFileSync(path.join(evidence, target), JSON.stringify(JSON.parse(readFileSync(source, 'utf8')), null, 2));
copyJson(path.join(review, 'aggregate.json'), 'aggregate.json');
copyJson(path.join(review, 'history-replay.json'), 'history-replay.json');
copyJson(path.join(review, 'long-analysis.json'), 'long-analysis.json');
copyJson(path.join(review, 'trace-analysis.json'), 'trace-analysis.json');

const longReport = JSON.parse(readFileSync(path.join(review, 'headless-swiftshader/long-candidate60/report.json'), 'utf8'));
const longRun = longReport.results[0];
const downsampledLong = {
  generatedAt: new Date().toISOString(),
  source: '.review/p1-5-b/headless-swiftshader/long-candidate60/report.json',
  environment: longReport.environment,
  rendererClassification: longReport.rendererClassification,
  fixtureSha256: longReport.fixtureSha256,
  run: {
    id: longRun.id, engine: longRun.engine, backend: longRun.backend, duration: longRun.duration,
    calibration: longRun.calibration, metrics: longRun.metrics, mainThreadCdpDelta: longRun.mainThreadCdpDelta,
    policyTransitions: longRun.policyTransitions, pulseRequests: longRun.pulseRequests, actions: longRun.actions,
    resourceTimeline: longRun.resourceTimeline, postRunGc: longRun.postRunGc, loadRelief: longRun.loadRelief,
    errors: longRun.errors, networkFailures: longRun.networkFailures,
    minuteTimeline: longRun.series.filter((_, index) => index % 60 === 0 || index === longRun.series.length - 1),
  },
};
writeFileSync(path.join(evidence, 'long-run.json'), JSON.stringify(downsampledLong, null, 2));

const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
const productDiff = git(['diff', '--name-only', '957ff26', '--', 'src', 'public']).split('\n').filter(Boolean);
const allowedProductChanges = [
  'src/components/screen/motion/MotionDirector.test.ts',
  'src/components/screen/motion/MotionDirector.ts',
  'src/components/screen/motion/MotionProvider.tsx',
];
const protectedWorktrees = [
  ['/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-3', '10a5e0b283b6ecae664cc64d44f7a9e88fb061f1'],
  ['/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-gsap-poc', '1f9e9cd6d78e12f85eee47d087c87191f90a0460'],
  ['/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit', 'df69d71f5b0cafcdab70a18f8e11be9f92cd163d'],
  ['/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-5-a', '957ff26b3202510316213dec93f8a0d98c0758b4'],
].map(([directory, expectedHead]) => ({
  directory, expectedHead,
  actualHead: execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  status: execFileSync('git', ['-C', directory, 'status', '--short'], { encoding: 'utf8' }).trim(),
}));
const integrity = {
  generatedAt: new Date().toISOString(), baseline: '957ff26b3202510316213dec93f8a0d98c0758b4',
  branch: git(['branch', '--show-current']), headBeforeCommit: git(['rev-parse', 'HEAD']),
  productDiff, allowedProductChanges,
  onlyAllowedExperimentalProductFilesChanged: productDiff.length === allowedProductChanges.length && productDiff.every(file => allowedProductChanges.includes(file)),
  defaultBehaviorGuard: 'The only runtime change is gated by debug=1&qualityExperiment=external; constructor automaticQuality defaults true.',
  protectedWorktrees,
};
writeFileSync(path.join(evidence, 'integrity.json'), JSON.stringify(integrity, null, 2));

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const rawFiles = [];
function add(file, kind) {
  if (!existsSync(file)) return;
  rawFiles.push({ path: path.relative(process.cwd(), file), kind, bytes: statSync(file).size, sha256: sha256(file) });
}
for (const backend of ['headless-swiftshader', 'headed-metal', 'headed-swiftshader']) {
  for (const profile of ['shared60', 'native']) add(path.join(review, backend, `frequency-${profile}/report.json`), 'frequency-report');
  add(path.join(review, backend, 'strategy-candidate60/report.json'), 'strategy-report');
  const traceDirectory = path.join(review, backend, 'trace-shared60');
  if (existsSync(traceDirectory)) for (const file of readdirSync(traceDirectory).filter(name => name.endsWith('.trace.json.gz'))) add(path.join(traceDirectory, file), 'raw-trace');
}
add(path.join(review, 'headless-swiftshader/long-candidate60/report.json'), 'long-report');
add(path.join(review, 'e2e-results.json'), 'test-result');
for (const file of ['p1-5-b-functional-results.json', 'p1-5-b-functional-rerun.json', 'p1-5-b-functional-final.json', 'p1-5-b-legacy-regression.json', 'p1-5-b-gsap-regression.json']) add(path.resolve('.review/gsap-poc', file), 'test-result');
writeFileSync(path.join(evidence, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rawFiles }, null, 2));
console.log(JSON.stringify({ evidenceFiles: readdirSync(evidence).length, rawFiles: rawFiles.length, productDiff }, null, 2));
