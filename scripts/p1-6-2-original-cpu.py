"""Repeat the original 8ms oracle three times; keep failures and raw callback windows."""
from pathlib import Path
import os,subprocess,sys,json,shutil
worktree=Path(sys.argv[1]).resolve();label=sys.argv[2]
source=Path(__file__).resolve().parents[1];root=source/'.review/p1-6-2/performance'/label;root.mkdir(parents=True,exist_ok=True)
results=[]
for round in [1,2,3]:
    name=f'{label}-r{round}';env=dict(os.environ,P161_OVERLAY_MODE='gsap',P162_REPORT=name,P162_EVIDENCE_ROOT=str(root))
    cmd=['pnpm','exec','playwright','test','--config','e2e/p1-6-2-regression.config.ts','--grep','overlay RAF callback CPU increment']
    with (root/f'{name}.txt').open('w')as log:r=subprocess.run(cmd,cwd=worktree,env=env,stdout=log,stderr=subprocess.STDOUT)
    samples=worktree/'test-results/design-polish/voice-cards-calibration.json'
    if samples.exists():shutil.copy2(samples,root/f'{name}-samples.json')
    item={'round':round,'exitCode':r.returncode,'worktree':str(worktree),'command':cmd};results.append(item);print(json.dumps(item),flush=True)
(root/'runs.json').write_text(json.dumps(results,indent=2)+'\n')
