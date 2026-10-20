"""Run runtime evidence sequentially after browser regressions release their ports."""
import json, os, subprocess, time
from pathlib import Path
out=Path('.review/p1-5-c');out.mkdir(parents=True,exist_ok=True)
while True:
 try:
  if len(json.loads((out/'regression-runs.json').read_text()))==6:break
 except (OSError,ValueError):pass
 time.sleep(3)
jobs=[
 ('baseline-build',['pnpm','--dir','/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-5-c-baseline-check','build'],{}),
 ('baseline-tail-reproduction',['pnpm','exec','playwright','test','-c','e2e/p1-5-c-baseline.config.ts','--grep','public contract tail'],{}),
 ('delivery-build',['pnpm','build'],{}),
 ('reduced-resume-30',['pnpm','exec','playwright','test','-c','e2e/p1-5-c.config.ts','--grep','30 cycles'],{'NEXUS_QUALITY_PERMISSION':'local-candidate','P15C_E2E_LABEL':'reduced-resume-30-final'}),
 ('visual',['node','scripts/p1-5-c/visual.mjs'],{}),
 ('integration-delivery',['pnpm','exec','playwright','test','-c','e2e/p1-5-c.config.ts'],{'NEXUS_QUALITY_PERMISSION':'local-candidate','P15C_E2E_LABEL':'integration-delivery'}),
 ('poc-delivery',['pnpm','exec','playwright','test','-c','e2e/gsap-poc.config.ts'],{'GSAP_RESULT_NAME':'p15c-poc-delivery'}),
 ('gsap-soak',['node','scripts/p1-5-c/run.mjs'],{'P15C_PHASE':'soak','P15C_ENGINE':'gsap','P15C_DURATION_MS':'1800000','P15C_RELIEF_AT_MS':'1500000'}),
 ('legacy-soak',['node','scripts/p1-5-c/run.mjs'],{'P15C_PHASE':'soak','P15C_ENGINE':'legacy','P15C_DURATION_MS':'600000','P15C_RELIEF_AT_MS':'480000'}),
]
if os.environ.get('P15C_RUNTIME_WAIT_VISUAL')=='1':
 while True:
  try:
   report=json.loads((out/'visual/report.json').read_text())
   if report.get('status')=='passed' and len(report.get('scenarios',[]))==8:break
  except (OSError,ValueError):pass
  time.sleep(3)
start_from=os.environ.get('P15C_RUNTIME_FROM')
if start_from:jobs=jobs[next(i for i,j in enumerate(jobs) if j[0]==start_from):]
skip_names=set(os.environ.get('P15C_RUNTIME_SKIP','').split(','))
jobs=[j for j in jobs if j[0] not in skip_names]
results=[]
for name,cmd,env in jobs:
 print('START',name,flush=True)
 (out/'runtime-state.json').write_text(json.dumps({'current':name,'startedAtEpoch':time.time(),'completed':results},indent=2))
 with (out/f'{name}.log').open('w') as f:
  result=subprocess.run(cmd,env={**os.environ,**env},stdout=f,stderr=subprocess.STDOUT)
 results.append({'name':name,'exitCode':result.returncode,'command':cmd,'environment':env})
 (out/'runtime-runs.json').write_text(json.dumps(results,indent=2))
 print('DONE',name,result.returncode,flush=True)
 if result.returncode and name!='baseline-tail-reproduction':break
(out/'runtime-state.json').write_text(json.dumps({'current':'stopped','completed':results},indent=2))
