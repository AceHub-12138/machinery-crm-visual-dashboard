"""Three independent Playwright/browser-process repetitions, always serial."""
import argparse, os, subprocess, json
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('worktree');p.add_argument('label');p.add_argument('--headed',action='store_true');p.add_argument('--profile',action='store_true');p.add_argument('--early',action='store_true')
p.add_argument('--round',type=int,choices=[1,2,3])
a=p.parse_args();source=Path(__file__).resolve().parents[1];root=source/'.review/p1-6-2/performance';root.mkdir(parents=True,exist_ok=True)
if not (Path(a.worktree)/'.next/BUILD_ID').is_file():raise SystemExit('A successful production build is required before sampling')
results=[]
for round in ([a.round] if a.round else [1,2,3]):
    label=f'{a.label}-r{round}';env=dict(os.environ,P162_ROUND=str(round),P162_PERF_LABEL=label,P162_PERF_ROOT=str(root),P162_EXPECT_PROFILE='1' if a.profile else '0',P162_EARLY='1'if a.early else '0')
    cmd=['pnpm','exec','playwright','test','--config','e2e/p1-6-2-performance.config.ts']+(['--headed']if a.headed else [])
    with (root/f'{label}.txt').open('w')as f:r=subprocess.run(cmd,cwd=a.worktree,env=env,stdout=f,stderr=subprocess.STDOUT)
    results.append({'round':round,'label':label,'exitCode':r.returncode,'command':cmd,'worktree':str(Path(a.worktree).resolve())})
    print(json.dumps(results[-1]),flush=True)
    if r.returncode:break
(root/f'{a.label}-runs.json').write_text(json.dumps(results,indent=2)+'\n')
raise SystemExit(any(item['exitCode']for item in results))
