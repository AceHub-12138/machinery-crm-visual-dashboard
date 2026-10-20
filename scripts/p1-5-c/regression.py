"""Sequential isolated browser suites, including unchanged historical lifecycle assertions."""
import os, subprocess, json
from pathlib import Path
out=Path('.review/p1-5-c');out.mkdir(parents=True,exist_ok=True)
jobs=[
 ('integration-final', ['pnpm','exec','playwright','test','-c','e2e/p1-5-c.config.ts'], {'NEXUS_QUALITY_PERMISSION':'local-candidate','P15C_E2E_LABEL':'integration-final-2'}),
 ('denied', ['pnpm','exec','playwright','test','-c','e2e/p1-5-c.config.ts','--grep','server permission'], {'NEXUS_QUALITY_PERMISSION':'denied','P15C_E2E_LABEL':'denied'}),
 ('legacy-regression', ['pnpm','exec','playwright','test','-c','e2e/gsap-poc.config.ts'], {'GSAP_REGRESSION':'1','NEXUS_MOTION_ENGINE':'legacy','GSAP_RESULT_NAME':'p15c-legacy-regression'}),
 ('gsap-regression', ['pnpm','exec','playwright','test','-c','e2e/gsap-poc.config.ts'], {'GSAP_REGRESSION':'1','NEXUS_MOTION_ENGINE':'gsap','GSAP_RESULT_NAME':'p15c-gsap-regression'}),
 ('historical-entry', ['pnpm','exec','playwright','test','-c','e2e/p1-5-b.config.ts'], {}),
 ('general', ['pnpm','exec','playwright','test','--reporter=json'], {}),
]
results=[]
for name,cmd,env in jobs:
 print('START',name,flush=True)
 with (out/f'{name}.log').open('w') as f:
  result=subprocess.run(cmd,env={**os.environ,**env},stdout=f,stderr=subprocess.STDOUT)
 results.append({'name':name,'exitCode':result.returncode,'command':cmd,'environment':env})
 (out/'regression-runs.json').write_text(json.dumps(results,indent=2))
 print('DONE',name,result.returncode,flush=True)
