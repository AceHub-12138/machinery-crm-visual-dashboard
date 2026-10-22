"""Summarize preserved samples without discarding failing/low-quality frames."""
from pathlib import Path
import json, csv, collections, hashlib
root=Path(__file__).resolve().parents[1]
rawroot=root/'.review/p1-6-2/performance';out=root/'docs/nexus-p1-6-2/evidence';out.mkdir(parents=True,exist_ok=True)
def stats(values):
    v=sorted(values)
    return {'n':len(v),'p50':round(v[min(len(v)-1,int(len(v)*.5))],4),'p95':round(v[min(len(v)-1,int(len(v)*.95))],4),'max':round(v[-1],4),'sum':round(sum(v),4)}if v else {'n':0,'p50':None,'p95':None,'max':None,'sum':0}
def frames(callbacks,start,end):
    f=collections.defaultdict(float)
    for s in callbacks:
        if start<=s['start']<end:f[s['timestamp']]+=s['ms']
    return list(f.values())
rows=[]; attribution=[];environments={};manifest=[];excluded=[]; original=[]
for p in sorted(rawroot.rglob('*.json')):
    if any(part.startswith('invalid-')for part in p.parts):
        excluded.append({'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()});continue
    data=json.loads(p.read_text())
    manifest.append({'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
    if isinstance(data,list) and p.name.endswith('-samples.json'):
        for item in data:
            r=item['raw'];rec=item['performance'];windows=r['windows']
            entry={'series':p.parent.name,'file':str(p.relative_to(root)),'viewport':rec['viewport'],'collectorDepth':r['depth'],
                'baseline':stats([v for _,v in windows[0]['frames']]),'active':stats([v for _,v in windows[1]['frames']]),
                'incrementP95':rec['incrementP95'],'activeStartsAfterAnswerMs':windows[1]['start']-r['launchAt'],
                'passesUnchanged8msOracle':rec['incrementP95']<=8,
                'callbackQueueMs':stats([s['start']-s['timestamp']for s in windows[1]['callbacks']])}
            original.append(entry)
            profile=r.get('profile')
            if profile:attribution.append({'series':p.parent.name,'width':rec['viewport']['width'],'mode':'gsap','phase':'original-active',
                **{'components':{name:stats([s['ms']for s in profile['spans']if s['name']==name and windows[1]['start']<=s['start']<windows[1]['end']])for name in set(s['name']for s in profile['spans'])}},
                'canvas':[]})
            if profile:
                render=[s for s in profile['spans']if s['name']=='canvas-renderer'and windows[1]['start']<=s['start']<windows[1]['end']]
                native=collections.defaultdict(list);counts=collections.defaultdict(list)
                for s in render:
                    for name,value in s.get('canvas',{}).get('ms',{}).items():native[name].append(value)
                    for name,value in s.get('canvas',{}).get('count',{}).items():counts[name].append(value)
                attribution[-1]['canvas']={'renderer':stats([s['ms']for s in render]),'fullQualityFrames':sum(s['meta']['ambientStride']==1 and not s['meta']['coreHalf']for s in render),
                    'totalFrames':len(render),'nativeApiMs':{k:stats(v)for k,v in native.items()},'nativeApiCounts':{k:stats(v)for k,v in counts.items()}}
        continue
    if not isinstance(data,dict)or 'launchAt'not in data or 'gpu'not in data:continue
    gpu=data['gpu']['gpu'];device=gpu['devices'][0]['deviceString'];features=gpu.get('featureStatus',{})
    env={'browser':data['browser'],'device':device,'featureStatus':features,'dpr':data['raw']['dpr'],'constants':data['constants']}
    envkey=('SwiftShader'if'SwiftShader'in device else'Metal'if'Metal'in device else device)
    environments[envkey]=env
    callbacks=data['raw']['raf']['callbacks'];profile=data['raw']['profile'];base=data['windows'][0]
    b=stats(frames(callbacks,base['start'],base['end']))
    for window in data['windows']:
        values=stats(frames(callbacks,window['start'],window['end']))
        row={'series':data['label'].rsplit('-r',1)[0],'round':data['round'],'backend':envkey,'width':data['width'],'mode':data['mode'],'phase':window['name'],
            'earlyAnswer':data.get('earlyAnswer',False),'n':values['n'],'p50Ms':values['p50'],'p95Ms':values['p95'],
            'deltaP50Ms':round(max(0,values['p50']-b['p50']),4),'deltaP95Ms':round(max(0,values['p95']-b['p95']),4),'startAfterAnswerMs':round(window['start']-data['launchAt'],2),
            'visualCompleteAfterAnswerMs':round(data['raw']['raf']['visualCompleteAt']-data['launchAt'],2),
            'queueP95Ms':stats([s['queueMs']for s in callbacks if window['start']<=s['start']<window['end']])['p95'],
            'layoutTotalMs':round((window['after'].get('LayoutDuration',0)-window['before'].get('LayoutDuration',0))*1000,4),
            'styleTotalMs':round((window['after'].get('RecalcStyleDuration',0)-window['before'].get('RecalcStyleDuration',0))*1000,4),
            'rafIntervalP50Ms':stats([s['ms']for s in data['raw']['raf']['frames']if window['start']<=s['at']<window['end']])['p50']}
        row['caseRafRegistrationP95Ms']=stats(data['raw']['raf']['registrations'])['p95']
        rows.append(row)
        if profile:
            spans=[s for s in profile['spans']if window['start']<=s['start']<window['end']]
            attribution.append({'series':row['series'],'round':data['round'],'width':data['width'],'mode':data['mode'],'phase':window['name'],
                'components':{name:{'inclusiveInvocationMs':stats([s['ms']for s in spans if s['name']==name]),'exclusiveInvocationMs':stats([s['selfMs']for s in spans if s['name']==name])}for name in set(s['name']for s in spans)}})
with (out/'performance-windows.csv').open('w')as f:
    writer=csv.DictWriter(f,fieldnames=list(rows[0]),lineterminator='\n');writer.writeheader();writer.writerows(rows)
(out/'performance-summary.json').write_text(json.dumps({'units':'ms. CPU invocation/frame costs; Layout/Style totals per window; no GPU utilization or presentation FPS claims.',
    'environments':environments,'windows':rows,'original8msOracle':original,'attribution':attribution},ensure_ascii=False,indent=2)+'\n')
(out/'performance-raw-manifest.json').write_text(json.dumps({'root':str(root),'retention':'Keep raw local samples until architecture review. No upload authorization.',
    'files':manifest,'excludedFilesRetained':excluded},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'windows':len(rows),'originalSamples':len(original),'environments':list(environments),'rawFiles':len(manifest),'rawBytes':sum(x['bytes']for x in manifest)},indent=2))
