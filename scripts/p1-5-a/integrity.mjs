import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const baseline = 'df69d71f5b0cafcdab70a18f8e11be9f92cd163d';
const cwd = process.cwd();
const git = (workingDirectory, args) => execFileSync('git', ['-C', workingDirectory, ...args], { encoding: 'utf8' }).trim();
const hash = value => createHash('sha256').update(value).digest('hex');
const productPaths = ['src', 'public'];
const baselineListing = git(cwd, ['ls-tree', '-r', '--full-tree', '--format=%(objectname) %(path)', baseline, '--', ...productPaths]);
const currentListing = git(cwd, ['ls-files', '-s', '--', ...productPaths]).split('\n').filter(Boolean).map(line => {
  const match = line.match(/^\d+ ([0-9a-f]+) \d+\t(.+)$/);
  return match ? `${match[1]} ${match[2]}` : line;
}).join('\n');
const productDiff = git(cwd, ['diff', '--name-status', baseline, '--', ...productPaths]);
const productStatus = git(cwd, ['status', '--short', '--', ...productPaths]);

const worktrees = [
  ['/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-3', '10a5e0b283b6ecae664cc64d44f7a9e88fb061f1'],
  ['/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-gsap-poc', '1f9e9cd6d78e12f85eee47d087c87191f90a0460'],
  ['/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit', baseline],
].map(([directory, expectedHead]) => ({
  directory,
  expectedHead,
  actualHead: git(directory, ['rev-parse', 'HEAD']),
  branch: git(directory, ['branch', '--show-current']),
  status: git(directory, ['status', '--short']),
}));

const result = {
  generatedAt: new Date().toISOString(),
  baseline,
  currentWorktree: cwd,
  currentBranch: git(cwd, ['branch', '--show-current']),
  currentHead: git(cwd, ['rev-parse', 'HEAD']),
  productPaths,
  productDiff,
  productStatus,
  baselineTrackedListingSha256: hash(baselineListing),
  currentTrackedListingSha256: hash(currentListing),
  listingsMatch: baselineListing === currentListing,
  productFilesMatchBaseline: productDiff === '' && productStatus === '' && baselineListing === currentListing,
  protectedWorktrees: worktrees,
  p14EvidenceStillTracked: git(cwd, ['ls-tree', '-r', '--name-only', baseline, '--', 'docs/nexus-p1-4/evidence']).split('\n').filter(Boolean).length,
};
mkdirSync('docs/nexus-p1-5-a/evidence', { recursive: true });
writeFileSync('docs/nexus-p1-5-a/evidence/product-integrity.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
