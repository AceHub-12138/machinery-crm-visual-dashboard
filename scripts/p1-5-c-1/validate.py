"""Sequential browser suites: isolate ports, RAF resources, and visual capture."""
import json
import os
from pathlib import Path
import subprocess
import time

out = Path('docs/nexus-p1-5-c-1/evidence/checks')
out.mkdir(parents=True, exist_ok=True)
jobs = [
    ('runtime', ['pnpm', 'exec', 'playwright', 'test', '-c', 'e2e/p1-5-c-1.config.ts'], {}),
    ('native-and-probe', ['pnpm', 'exec', 'playwright', 'test', '-c', 'e2e/p1-5-c-1.config.ts', '--grep', '1792|active Candidate probe'], {'C1_E2E_LABEL': 'native-and-probe'}),
    ('legacy-regression', ['pnpm', 'exec', 'playwright', 'test', '-c', 'e2e/gsap-poc.config.ts'], {'GSAP_REGRESSION': '1', 'NEXUS_MOTION_ENGINE': 'legacy', 'GSAP_RESULT_NAME': 'c1-legacy-regression'}),
    ('gsap-regression', ['pnpm', 'exec', 'playwright', 'test', '-c', 'e2e/gsap-poc.config.ts'], {'GSAP_REGRESSION': '1', 'NEXUS_MOTION_ENGINE': 'gsap', 'GSAP_RESULT_NAME': 'c1-gsap-regression'}),
    ('quality-integration', ['pnpm', 'exec', 'playwright', 'test', '-c', 'e2e/p1-5-c.config.ts'], {'NEXUS_QUALITY_PERMISSION': 'local-candidate', 'P15C_E2E_LABEL': 'c1-integration'}),
    ('safety-boundary', ['pnpm', 'exec', 'playwright', 'test', '-c', 'e2e/p1-5-c-safety.config.ts'], {'NEXUS_SAFETY_LABEL': 'c1-boundary'}),
    ('permission-denied', ['pnpm', 'exec', 'playwright', 'test', '-c', 'e2e/p1-5-c.config.ts', '--grep', 'server permission'], {'NEXUS_QUALITY_PERMISSION': 'denied', 'P15C_E2E_LABEL': 'c1-denied'}),
    ('gsap-functional', ['pnpm', 'exec', 'playwright', 'test', '-c', 'e2e/gsap-poc.config.ts'], {'GSAP_RESULT_NAME': 'c1-functional'}),
    ('baseline-equivalence', ['node', 'scripts/p1-5-c-1/baseline-equivalence.mjs'], {}),
    ('visual', ['node', 'scripts/p1-5-c-1/capture.mjs'], {'C1_PHASE': 'fixed', 'C1_WIDTHS': '1280,1792,1920,3840', 'C1_RESUME': os.environ.get('C1_RESUME', '1')}),
]
selected = set(filter(None, os.environ.get('C1_JOBS', '').split(',')))
results = json.loads((out/'runs.json').read_text()) if (out/'runs.json').exists() else []
for name, command, environment in jobs:
    if selected and name not in selected:
        continue
    print('START', name, flush=True)
    (out/'current.json').write_text(json.dumps({'current': name, 'startedEpoch': time.time(), 'completed': results}, indent=2))
    started = time.monotonic()
    with (out/f'{name}.txt').open('w') as stream:
        result = subprocess.run(command, env={**os.environ, **environment}, stdout=stream, stderr=subprocess.STDOUT)
    results.append({'name': name, 'exitCode': result.returncode, 'elapsedSeconds': time.monotonic()-started, 'command': command, 'environment': environment})
    (out/'runs.json').write_text(json.dumps(results, indent=2))
    print('DONE', name, result.returncode, flush=True)
sources = {
    'legacy-regression': '.review/gsap-poc/c1-legacy-regression.json',
    'gsap-regression': '.review/gsap-poc/c1-gsap-regression.json',
    'quality-integration': '.review/p1-5-c/c1-integration-results.json',
    'safety-boundary': '.review/p1-5-c-safety/c1-boundary-results.json',
    'permission-denied': '.review/p1-5-c/c1-denied-results.json',
    'gsap-functional': '.review/gsap-poc/c1-functional.json',
}
for name, source in sources.items():
    if any(r['name'] == name for r in results) and Path(source).exists():
        (out/f'{name}.json').write_text(Path(source).read_text())
(out/'current.json').write_text(json.dumps({'current': 'finished', 'completed': results}, indent=2))
latest = {r['name']: r for r in results}
raise SystemExit(any(r['exitCode'] for r in latest.values()))
