#!/usr/bin/env python3
"""Aggregate Chrome trace events by thread/state. Inclusive durations, not additive CPU utilization."""
import collections,gzip,json,pathlib,bisect
root=pathlib.Path(__file__).resolve().parents[2];out=root/'.review/p1-4'
reports=[]
for p in sorted(out.glob('*.trace.json.gz')):
 with gzip.open(p,'rt') as f:tr=json.load(f)
 events=tr['traceEvents'];threads={};processes={}
 for e in events:
  if e.get('ph')=='M':
   if e['name']=='thread_name':threads[(e['pid'],e['tid'])]=e.get('args',{}).get('name')
   if e['name']=='process_name':processes[e['pid']]=e.get('args',{}).get('name')
 marks=sorted((e['ts'],e['name'].split(':')[-1]) for e in events if e.get('name','').startswith('P14:level:') and e.get('ph') in ['R','I','i'])
 starts=[e['ts'] for e in events if e.get('name')=='P14:sample-start']
 start=min(starts) if starts else min(e.get('ts',float('inf')) for e in events)
 end=max(e.get('ts',0)+e.get('dur',0) for e in events)
 def state(ts):
  i=bisect.bisect_right(marks,(ts,'zzzz'))-1
  return marks[i][1] if i>=0 else 'normal'
 grouped=collections.defaultdict(lambda:[0,0.,0.]);stateStats=collections.defaultdict(lambda:[0,0.,0.]);paintNodes=collections.Counter();invalidations=collections.Counter();gpuExamples=[];paintExamples=[]
 # Complete events plus well-nested B/E records. Async flow records are not treated as CPU durations.
 stack=collections.defaultdict(list);complete=[]
 for e in sorted(events,key=lambda e:e.get('ts',0)):
  key=(e.get('pid'),e.get('tid'))
  if e.get('ph')=='X':complete.append(e)
  elif e.get('ph')=='B':stack[key].append(e)
  elif e.get('ph')=='E' and stack[key]:
   b=stack[key].pop();complete.append({**b,'ph':'X','dur':max(0,e['ts']-b['ts'])})
  if 'Invalidation' in e.get('name',''):
   data=e.get('args',{}).get('data',{});invalidations[(e['name'],data.get('reason',''),str(data.get('nodeId','')))]+=1
 for e in complete:
  if e.get('ts',0)<start:continue
  name=e['name'];key=(e['pid'],e['tid'],name);ms=e.get('dur',0)/1000
  a=grouped[key];a[0]+=1;a[1]+=ms;a[2]=max(a[2],ms)
  a=stateStats[(state(e['ts']),threads.get((e['pid'],e['tid']),'?'),name)];a[0]+=1;a[1]+=ms;a[2]=max(a[2],ms)
  if name=='Paint':
   data=e.get('args',{}).get('data',{});paintNodes[str(data.get('nodeId'))]+=1
   if len(paintExamples)<12:paintExamples.append(e)
  if ('gpu' in name.lower() or 'viz' in name.lower()) and len(gpuExamples)<12:gpuExamples.append(e)
 threadReports=[]
 for key in sorted(set((e['pid'],e['tid']) for e in complete)):
  rows=[{'event':name,'count':v[0],'inclusiveMs':round(v[1],3),'maxMs':round(v[2],3)} for (pid,tid,name),v in grouped.items() if (pid,tid)==key]
  if rows:threadReports.append({'pid':key[0],'tid':key[1],'process':processes.get(key[0]),'thread':threads.get(key),'topEvents':sorted(rows,key=lambda x:-x['inclusiveMs'])[:35]})
 periods=[];boundaries=[(start,'normal')]+[x for x in marks if x[0]>=start]+[(end,None)]
 for i in range(len(boundaries)-1):periods.append({'level':boundaries[i][1],'startUs':boundaries[i][0],'durationMs':(boundaries[i+1][0]-boundaries[i][0])/1000})
 report={'file':p.name,'events':len(events),'startUs':start,'durationMs':(end-start)/1000,'marks':marks,'periods':periods,'threads':threadReports,'byState':[{'level':k[0],'thread':k[1],'event':k[2],'count':v[0],'inclusiveMs':round(v[1],3),'maxMs':round(v[2],3)} for k,v in stateStats.items()],'paintNodes':paintNodes,'invalidationTop':[{'event':k[0],'reason':k[1],'nodeId':k[2],'count':v} for k,v in invalidations.most_common(30)],'paintExamples':paintExamples,'gpuExamples':gpuExamples}
 (out/(p.name.replace('.trace.json.gz','-trace-summary.json'))).write_text(json.dumps(report,indent=2));reports.append(report)
 print(p.name,'events',len(events),'ms',round(report['durationMs']), 'marks',[(round((x[0]-start)/1000),x[1]) for x in marks])
 for t in threadReports:
  if t['thread'] in ['CrRendererMain','VizCompositorThread','CrGpuMain'] or 'Raster' in str(t['thread']):print(t['thread'],t['topEvents'][:7])
(out/'trace-summaries.json').write_text(json.dumps(reports,indent=2))
