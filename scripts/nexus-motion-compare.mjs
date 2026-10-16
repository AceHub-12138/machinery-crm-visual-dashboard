import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const output = path.resolve('.review/nexus-p2-motion');
function entries(file) {
  const json = JSON.parse(readFileSync(path.join(output, file), 'utf8'));
  const rows = [];
  function walk(suite, parents = []) {
    const titles = suite.title ? [...parents, suite.title] : parents;
    for (const spec of suite.specs ?? []) for (const test of spec.tests) {
      rows.push({ key: `${spec.file}:${spec.line}:${test.projectName}:${spec.title}`, file: spec.file, line: spec.line, title: [...titles, spec.title].join(' › '), status: test.status, expectedStatus: test.expectedStatus,
        errors: test.results.flatMap(r => r.errors ?? []).map(e => (e.message ?? '').replace(/\x1b\[[0-9;]*m/g, '')) });
    }
    for (const child of suite.suites ?? []) walk(child, titles);
  }
  for (const suite of json.suites) walk(suite);
  return { rows, stats: json.stats };
}
const before = entries('browser-baseline-full.json'), after = entries('browser-full-final.json');
const oldFailures = before.rows.filter(t => t.status === 'unexpected'), newFailures = after.rows.filter(t => t.status === 'unexpected');
const oldKeys = new Set(oldFailures.map(t => t.key)), newKeys = new Set(newFailures.map(t => t.key));
const newOnly = newFailures.filter(t => !oldKeys.has(t.key)), resolved = oldFailures.filter(t => !newKeys.has(t.key));
const normalizeCause = text => text.replace(/\/(?:private\/)?tmp\/nexus-p2-baseline-d3f41b1|\/Users\/apple\/Desktop\/Codex\/machinery-crm-visual-dashboard-nexus-p1/g, '<workspace>');
const isVoice = t => path.basename(t.file).startsWith('voice-');
const result = { base: 'd3f41b1', before: before.stats, after: after.stats, sameFailureSet: newOnly.length === 0 && resolved.length === 0 && oldFailures.length === newFailures.length,
  newFailures: newOnly, resolvedFailures: resolved, legacyScreenFailures: newFailures.filter(t => !isVoice(t)), voiceFailures: newFailures.filter(isVoice),
  voiceCauseComparisons: newFailures.filter(isVoice).map(current => {
    const baseline = oldFailures.find(t => t.key === current.key);
    return { key: current.key, sameCause: !!baseline && JSON.stringify(baseline.errors.map(normalizeCause)) === JSON.stringify(current.errors.map(normalizeCause)), baselineErrors: baseline?.errors ?? [], finalErrors: current.errors };
  }),
  baselineFailures: oldFailures, allTestKeysMatch: before.rows.length === after.rows.length && before.rows.every(t => after.rows.some(a => a.key === t.key)) };
writeFileSync(path.join(output, 'failure-comparison.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ sameFailureSet: result.sameFailureSet, allTestKeysMatch: result.allTestKeysMatch, baselineFailures: oldFailures.length, finalFailures: newFailures.length, newFailures: newOnly.length, voiceFailures: result.voiceFailures.length }));
