"""Read final reports and retained geometry; never mutate test results."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parents[1]
out = root / 'docs/nexus-p1-6-2/evidence'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(name, data):
    (out / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


build = json.loads((out / 'final-build-source.json').read_text())
for name, sha in build['productFiles'].items():
    assert digest(root / name) == sha, f'Product changed after final build: {name}'
protected = json.loads((out / 'protected-source-manifest.json').read_text())
for item in protected['unchanged']:
    assert digest(root / item['path']) == item['sha256'], item['path']

reports = {}
for label in ('gsap-regression', 'legacy-regression', 'special', 'legacy-prefinal'):
    path = out / f'{label}.json'
    data = json.loads(path.read_text())
    cases = []

    def visit(suite):
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                if test['status'] != 'expected':
                    cases.append({'title': spec['title'], 'file': spec['file'],
                                  'status': test['status'],
                                  'attempts': [r['status'] for r in test['results']]})
        for child in suite.get('suites', []):
            visit(child)

    for suite in data['suites']:
        visit(suite)
    reports[label] = {'stats': data['stats'], 'nonExpected': cases,
                      'sha256': digest(path)}
save('test-summary.json', {'build': build, 'reports': reports,
                           'protectedSourceFilesUnchanged': len(protected['unchanged'])})

cpu = []
for mode in ('gsap', 'legacy'):
    directory = root / f'.review/p1-6-2/card-evidence/{mode}-regression'
    for path in sorted(directory.glob('*.json')):
        for item in json.loads(path.read_text()):
            if 'performance' not in item:
                continue
            cpu.append({'mode': mode, 'record': item['performance'],
                        'collectorDepth': item['raw']['depth'],
                        'rawFile': str(path.relative_to(root)), 'sha256': digest(path),
                        'passesUnchanged8msOracle': item['performance']['incrementP95'] <= 8})
save('final-original-cpu.json', cpu)

geometry = {}
raw = {}
for mode in ('gsap', 'legacy'):
    directory = root / f'.review/p1-6-2/p13-{mode}/after'
    entries = {p.name: json.loads(p.read_text()) for p in sorted(directory.glob('*.json'))}
    assert entries, f'No geometry: {directory}'
    raw[mode] = entries
    geometry[mode] = {'records': len(entries),
                      'violations': sum(len(v['violations']) for v in entries.values()),
                      'textFailures': sum(len(v['textFailures']) for v in entries.values()),
                      'files': [{'path': str(p.relative_to(root)), 'sha256': digest(p)}
                                for p in sorted(directory.glob('*')) if p.is_file()]}
differences = []
for name in sorted(raw['gsap'].keys() & raw['legacy'].keys()):
    for selector, a in raw['gsap'][name]['rects'].items():
        b = raw['legacy'][name]['rects'][selector]
        if a is None or b is None:
            if a != b:
                differences.append({'file': name, 'selector': selector, 'presence': [a, b]})
            continue
        delta = max(abs(a[k] - b[k]) for k in ('x', 'y', 'width', 'height'))
        if delta > 0.5:
            differences.append({'file': name, 'selector': selector, 'maxDeltaPx': delta})
save('geometry-summary.json', {'viewports': [1280, 1792, 1920, 3840],
                               'modes': geometry, 'rectTolerancePx': 0.5,
                               'rectDifferencesBeyondTolerance': differences,
                               'onlyInGsap': sorted(raw['gsap'].keys() - raw['legacy'].keys()),
                               'onlyInLegacy': sorted(raw['legacy'].keys() - raw['gsap'].keys())})
print(json.dumps({'tests': {k: v['stats'] for k, v in reports.items()},
                  'geometry': {k: {a: b for a, b in v.items() if a != 'files'}
                               for k, v in geometry.items()},
                  'rectDifferencesBeyondTolerance': len(differences)}, indent=2))
