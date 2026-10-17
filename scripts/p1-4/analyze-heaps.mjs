/** Strong retaining paths + stable V8 object-id diffs. Self-size != dominator retained size. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const dir='.review/p1-4';
function graph(file){
 const x=JSON.parse(readFileSync(`${dir}/${file}.heapsnapshot`,'utf8'));
 const nf=x.snapshot.meta.node_fields, ef=x.snapshot.meta.edge_fields;
 const nwidth=nf.length,ewidth=ef.length;
 const ni=Object.fromEntries(nf.map((x,i)=>[x,i])),ei=Object.fromEntries(ef.map((x,i)=>[x,i]));
 const types=x.snapshot.meta.node_types[ni.type],etypes=x.snapshot.meta.edge_types[ei.type];
 const n=x.nodes.length/nwidth,first=new Int32Array(n+1);let off=0;
 const groups=new Map(),ids=new Set();
 for(let i=0;i<n;i++){first[i]=off;off+=x.nodes[i*nwidth+ni.edge_count]*ewidth;const name=x.strings[x.nodes[i*nwidth+ni.name]],type=types[x.nodes[i*nwidth+ni.type]],key=type+':'+name;const g=groups.get(key)??{type,name,count:0,selfBytes:0};g.count++;g.selfBytes+=x.nodes[i*nwidth+ni.self_size];groups.set(key,g);ids.add(x.nodes[i*nwidth+ni.id]);}first[n]=off;
 function node(i){const b=i*nwidth;return {index:i,id:x.nodes[b+ni.id],type:types[x.nodes[b+ni.type]],name:x.strings[x.nodes[b+ni.name]],selfBytes:x.nodes[b+ni.self_size],detachedness:ni.detachedness===undefined?null:x.nodes[b+ni.detachedness]};}
 function edge(e){const type=etypes[x.edges[e+ei.type]],raw=x.edges[e+ei.name_or_index];return {type,name:['element','hidden'].includes(type)?raw:x.strings[raw],to:x.edges[e+ei.to_node]/nwidth};}
 return {x,n,first,ewidth,groups,ids,node,edge};
}
const names=['memory-clean-10','memory-clean-30','memory-clean-50','memory-clean-70','memory-clean-settled','memory-dwell-settled'];
let warmIds,warmGroups,warmAnimationIds;const report={policy:'Stable node ids within one CDP HeapProfiler session; weak edges excluded in shortest retaining paths; summed shallow bytes are NOT dominator retained bytes. Animation classes are detected by own property signatures, not minified constructor names.',snapshots:[]};
for(const name of names){
 if(!existsSync(`${dir}/${name}.heapsnapshot`)){console.log('PENDING',name);continue;}
 console.log('PARSE',name);let g=graph(name);
 if(name===names[0]){warmIds=g.ids;warmGroups=g.groups;}
 const totals={nodes:g.n,selfBytes:g.x.nodes.filter((_,i)=>i%g.x.snapshot.meta.node_fields.length===g.x.snapshot.meta.node_fields.indexOf('self_size')).reduce((a,b)=>a+b,0)};
 const deltas=[...g.groups].map(([key,v])=>({...v,countDelta:v.count-(warmGroups.get(key)?.count??0),selfDelta:v.selfBytes-(warmGroups.get(key)?.selfBytes??0)}));
 const animation={director:[],scene:[],timeline:[],tween:[]};
 for(let i=0;i<g.n;i++){
  const n=g.node(i);if(n.type!=='object')continue;
  const props=new Set();for(let e=g.first[i];e<g.first[i+1];e+=g.ewidth){const ed=g.edge(e);if(ed.type==='property')props.add(ed.name);}
  let kind=null;
  if(props.has('frame')&&props.has('callbacks')&&props.has('records'))kind='director';
  else if(props.has('introTl')&&props.has('pulseTl')&&props.has('routeTls'))kind='scene';
  else if(props.has('labels')&&props.has('vars'))kind='timeline';
  else if(props.has('_targets')&&props.has('vars'))kind='tween';
  if(kind)animation[kind].push(n);
 }
 if(name===names[0])warmAnimationIds=Object.fromEntries(Object.entries(animation).map(([k,v])=>[k,new Set(v.map(n=>n.id))]));
 const row={name,totals,animation,idComparisonGroup:name.startsWith('memory-clean')?'clean':'dwell',animationWarmSurvivors:name.startsWith('memory-clean')?Object.fromEntries(Object.entries(animation).map(([k,v])=>[k,v.filter(n=>warmAnimationIds[k].has(n.id)).length])):null,browserCollections:[...g.groups.values()].filter(x=>x.type==='native'&&['NavigationHistoryEntry','PerformanceResourceTiming','LayoutShift','blink::NetworkResourcesData::ResourceData'].includes(x.name)),topByBytes:[...g.groups.values()].sort((a,b)=>b.selfBytes-a.selfBytes).slice(0,35),growth: deltas.sort((a,b)=>b.selfDelta-a.selfDelta).slice(0,40)};
 if(name==='memory-clean-settled'){
  // BFS from synthetic root using strong edges: a reproducible existence proof of a retaining path.
  const pn=new Int32Array(g.n);pn.fill(-1);const pe=new Int32Array(g.n);pe.fill(-1);const q=new Int32Array(g.n);q[0]=0;pn[0]=0;let head=0,tail=1;
  while(head<tail){const from=q[head++];for(let e=g.first[from];e<g.first[from+1];e+=g.ewidth){const ed=g.edge(e);if(ed.type==='weak'||pn[ed.to]!==-1)continue;pn[ed.to]=from;pe[ed.to]=e;q[tail++]=ed.to;}}
  const targets=new Set(row.growth.filter(x=>x.selfDelta>0).slice(0,16).map(x=>x.type+':'+x.name));
  // Always inspect suspected animation/DOM objects as well as the dominant growing classes.
  for(const [key,v]of g.groups)if(['object','native'].includes(v.type)&&/Timeline|Tween|MotionDirector|GsapScene|Detached|EventListener|^Map$|^Set$|DOMPoint|NavigationHistoryEntry|PerformanceResourceTiming|NetworkResourcesData|LayoutShift/.test(v.name))targets.add(key);
  for(const group of Object.values(animation))for(const n of group)targets.add(n.type+':'+n.name);
  const counts=new Map(),paths=[];
  for(let i=0;i<g.n;i++){
   const node=g.node(i),key=node.type+':'+node.name;
   if(!targets.has(key)||warmIds.has(node.id)||(counts.get(key)??0)>=3)continue;
   counts.set(key,(counts.get(key)??0)+1);
   if(pn[i]===-1){paths.push({target:node,path:null});continue;}
   const chain=[];let at=i;
   for(let d=0;d<70&&at!==0;d++){const parent=pn[at],ed=g.edge(pe[at]);chain.push({from:g.node(parent),edge:{type:ed.type,name:ed.name},to:g.node(at)});at=parent;}
   paths.push({target:node,path:chain.reverse(),truncated:at!==0});
  }
  row.strongReachable=tail;row.retainingPaths=paths;
  row.animationClasses=[...g.groups.values()].filter(v=>['object','native'].includes(v.type)&&/Timeline|Tween|MotionDirector|GsapScene|DOMPoint|Detached/.test(v.name));
 }
 report.snapshots.push(row);writeFileSync(`${dir}/heap-analysis.json`,JSON.stringify(report,(key,value)=>key==='name'&&typeof value==='string'&&value.length>200?value.slice(0,200)+' [truncated]':value,2));g=null;global.gc?.();
}
