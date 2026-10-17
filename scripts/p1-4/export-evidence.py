#!/usr/bin/env python3
"""Export compact review evidence and integrity manifest after all browser runs finish."""
import collections,hashlib,json,pathlib,subprocess,shutil
ROOT=pathlib.Path(__file__).resolve().parents[2];raw=ROOT/'.review/p1-4';out=ROOT/'docs/nexus-p1-4/evidence';out.mkdir(exist_ok=True)
def load(p):return json.loads(p.read_text())
def save(name,x):(out/name).write_text(json.dumps(x,ensure_ascii=False,indent=2))
def segments(r):return [{'time':s['time'],'fps':s['metrics']['fps'],'p95Ms':s['metrics']['intervalP95Ms'],'level':s['level'],'state':s['state'],'particleVisibility':s['particleVisibility'],'directorFPS':s.get('directorFPS')} for s in r['segments']]
b=load(ROOT/'.review/gsap-poc/performance/benchmark.json');assert len(b['results'])==4 and b.get('finishedAt')
p=load(raw/'prior/benchmark.json');assert len(set(x['businessSha256'] for x in b['results']))==1
save('baseline.json',{k:v for k,v in b.items() if k not in ['results','legacyVideo','gsapVideo']}|{'results':[{k:v for k,v in r.items() if k not in ['memory','segments','clientNavigationRetention']} for r in b['results']],'priorMetrics':[{'engine':r['engine'],'width':r['width'],'metrics':r['metrics']} for r in p['results']]})
for name in ['browser-gpu.json','browser-gpu-headed.json']:
 save(name,load(raw/'environment'/name))
h=load(raw/'headed-matrix.json');assert len(h['results'])==4
save('cadence.json',load(raw/'cadence.json'))
save('headed-matrix.json',{'platform':h['platform'],'results':[{k:v for k,v in r.items() if k!='segments'}|{'segments':segments(r)} for r in h['results']]})
a=load(raw/'ablation.json');assert len(a)==10
save('ablation.json',[{k:v for k,v in r.items() if k!='segments'}|{'segments':segments(r)} for r in a])
m=load(raw/'memory.json');assert [x['label'] for x in m]==['clean','instrumented','dwell']
for cohort in m:
 assert len(cohort['rows'])==72 and cohort['rows'][-1]['cycle']==70.1
 for row in cohort['rows']:
  assert row['dom']['stageCount']==row['dom']['canvases']==row['dom']['debugs']==1
  if row['dom']['engine']=='gsap':
   audit=json.loads(row['dom']['audit']);assert audit=={'liveScenes':1,'liveTimelines':27,'rootAnimations':0},audit
save('memory.json',m);save('heap-analysis.json',load(raw/'heap-analysis.json'))
t=load(raw/'trace-summaries.json');save('trace-summaries.json',t)
statuses={p.name:load(p) for p in raw.glob('*-trace-status.json')}
assert all(not x['dataLossOccurred'] for x in statuses.values()),statuses
for engine in ['legacy','gsap']:assert f'{engine}-3840-trace-status.json' in statuses
save('trace-status.json',statuses)
save('trace-window-metrics.json',[{'file':p.name,**{k:v for k,v in load(p).items() if k in ['actualMs','metrics','cpuSeconds','errors','dom']},'segments':segments(load(p))} for p in sorted(raw.glob('*-trace-metrics.json'))])
save('mutation-counts.json',load(raw/'mutation-counts.json'));save('structure.json',load(raw/'structure.json'))
repos=load(raw/'environment/git-before.json');after={}
for name,previous in repos.items():
 path=previous['path']
 def git(*args):return subprocess.check_output(['git','-C',path,*args],text=True).strip()
 after[name]={'path':path,'head':git('rev-parse','HEAD'),'branch':git('branch','--show-current'),'status':git('status','--porcelain=v1')}
 if name!='nexus':assert after[name]['head']==previous['head'] and after[name]['status']==previous['status'],(name,after[name],previous)
# Product paths must match the requested PoC exactly, even though docs/tools can change.
changed=subprocess.check_output(['git','diff','1f9e9cd','--name-only','--','src','public','package.json','pnpm-lock.yaml','next-env.d.ts','next.config.ts','e2e','services'],cwd=ROOT,text=True).strip();assert not changed,changed
subprocess.run(['git','merge-base','--is-ancestor','10a5e0b','1f9e9cd'],cwd=ROOT,check=True)
save('workspace-integrity.json',{'before':repos,'after':after,'productDiffFromPoC':changed,'p13IsAncestor':True,'push':False,'merge':False,'deploy':False,'task11':False})
manifest=[]
for folder in [raw,ROOT/'.review/gsap-poc/performance']:
 for p in sorted(folder.rglob('*')):
  if not p.is_file() or p.name=='artifact-manifest.json':continue
  digest=hashlib.sha256()
  with p.open('rb') as f:
   while chunk:=f.read(1024*1024):digest.update(chunk)
  manifest.append({'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':digest.hexdigest()})
save('artifact-manifest.json',manifest)
print('Validated/exported',len(list(out.iterdir())),'compact evidence files;',len(manifest),'raw artifacts hashed. Product diff empty; protected checkouts unchanged.')
