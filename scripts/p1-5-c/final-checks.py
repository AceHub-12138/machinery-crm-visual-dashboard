"""Final broad checks only after both real-time soaks release their resources."""
import json,os,subprocess,time
from pathlib import Path
out=Path('.review/p1-5-c')
while True:
 try:
  runs=json.loads((out/'runtime-runs.json').read_text())
  if runs and runs[-1]['name']=='legacy-soak' and runs[-1]['exitCode']==0:break
 except (OSError,ValueError):pass
 time.sleep(3)
jobs=[
 ('legacy-delivery',['pnpm','exec','playwright','test','-c','e2e/gsap-poc.config.ts'],{'GSAP_REGRESSION':'1','NEXUS_MOTION_ENGINE':'legacy','GSAP_RESULT_NAME':'p15c-legacy-regression'}),
 ('gsap-delivery',['pnpm','exec','playwright','test','-c','e2e/gsap-poc.config.ts'],{'GSAP_REGRESSION':'1','NEXUS_MOTION_ENGINE':'gsap','GSAP_RESULT_NAME':'p15c-gsap-regression'}),
 ('general-delivery',['pnpm','exec','playwright','test','--reporter=json'],{}),
 ('unit-final',['pnpm','exec','vitest','run','--reporter=json','--outputFile=.review/p1-5-c/unit-delivery.json'],{}),
 ('typecheck-final',['pnpm','exec','tsc','--noEmit'],{}),
 ('lint-final',['pnpm','lint'],{}),
]
results=[]
for name,command,env in jobs:
 print('START',name,flush=True)
 with (out/f'{name}.log').open('w') as f:r=subprocess.run(command,env={**os.environ,**env},stdout=f,stderr=subprocess.STDOUT)
 results.append({'name':name,'exitCode':r.returncode});(out/'final-checks.json').write_text(json.dumps(results,indent=2))
 print('DONE',name,r.returncode,flush=True)
