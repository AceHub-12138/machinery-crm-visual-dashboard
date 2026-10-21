"""Read-only scope and build-input attestation; no production connections."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

baseline = 'b35b93c230fc6c084895a4119196779f505bf2fb'
out = Path('docs/nexus-p1-5-c-1/evidence')
allowed = {
    'src/components/screen/motion/MotionDirector.ts',
    'src/components/screen/motion/MotionProvider.tsx',
    'src/components/screen/motion/QualityPolicy.ts',
    'src/components/screen/motion/QualityPolicy.test.ts',
    'src/components/screen/motion/DeferredRecalibration.ts',
    'src/components/screen/motion/DeferredRecalibration.test.ts',
}
files = subprocess.check_output(['git', 'ls-files', '-z', 'src', 'public', 'package.json', 'pnpm-lock.yaml', 'next.config.ts', 'tsconfig.json']).decode().split('\0')
files += [p for p in allowed if p not in files]
inputs = []
changes = []
for name in sorted(set(filter(None, files))):
    data = Path(name).read_bytes()
    previous = subprocess.run(['git', 'show', f'{baseline}:{name}'], capture_output=True)
    same = previous.returncode == 0 and data == previous.stdout
    if not same:
        changes.append(name)
    inputs.append({'path': name, 'sha256': hashlib.sha256(data).hexdigest(), 'sameAsBaseline': same})
assert set(changes) <= allowed, changes
policy = 'src/components/screen/motion/QualityPolicy.ts'
old = subprocess.check_output(['git', 'show', f'{baseline}:{policy}']).decode()
new = Path(policy).read_text()
parameters = lambda s: re.search(r'export const candidateParameters = Object.freeze\(\{[\s\S]*?\n\}\);', s).group(0)
assert parameters(old) == parameters(new)
for name in ['src/components/screen/motion/calibrateRaf.ts', 'src/components/screen/motion/config.ts',
             'src/components/screen/motion/GsapTickerOwner.ts', 'src/components/screen/motion/useSceneMotion.ts',
             'src/components/screen/ScreenStage.tsx', 'src/components/screen/motion/quality-permission.ts',
             'src/server/local-quality-boundary.mjs']:
    assert next(i for i in inputs if i['path'] == name)['sameAsBaseline'], name
scheduler = Path('src/components/screen/motion/DeferredRecalibration.ts').read_text()
assert 'requestAnimationFrame' not in scheduler and 'setInterval' not in scheduler
assert scheduler.count('= setTimeout(') == 1
assert 'queueMicrotask' in scheduler
report = {'status': 'passed', 'baseline': baseline, 'branch': subprocess.check_output(['git', 'branch', '--show-current']).decode().strip(),
          'buildId': Path('.next/BUILD_ID').read_text().strip(), 'candidateParametersUnchanged': True,
          'startupSamplerUnchanged': True, 'layoutAndFitUnchanged': True, 'permissionBoundaryUnchanged': True,
          'voiceAndBusinessAndArtInputsUnchanged': True, 'noNewPermanentRafOrPollingClock': True,
          'changedInputs': changes, 'inputCount': len(inputs)}
(out/'source-invariants.json').write_text(json.dumps(report, indent=2)+'\n')
(out/'product-inputs.json').write_text(json.dumps(inputs, indent=2)+'\n')
print(json.dumps(report, indent=2))
