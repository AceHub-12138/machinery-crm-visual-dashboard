import { readFileSync,writeFileSync,readdirSync } from 'node:fs';
const root='docs/nexus-p1-6',dir=`${root}/evidence`;
const read=name=>JSON.parse(readFileSync(`${dir}/${name}`));
const round=n=>Math.round(n*100)/100;
const summary=values=>{const x=[...values].sort((a,b)=>a-b);return {n:x.length,mean:round(x.reduce((a,b)=>a+b,0)/x.length),p95:round(x[Math.floor((x.length-1)*.95)]),max:round(x.at(-1))};};
const performance=readdirSync(dir).filter(n=>n.endsWith('-performance.json')).map(name=>{
  const d=read(name),before=Object.fromEntries(d.before.metrics.map(x=>[x.name,x.value])),after=Object.fromEntries(d.after.metrics.map(x=>[x.name,x.value]));
  return {name,viewport:d.viewport,gpu:d.gpu,frameMs:summary(d.metrics.frames),canvasCallbackMs:summary(d.metrics.canvasMs),allCallbackMs:summary(d.metrics.callbackMs),deltaSeconds:Object.fromEntries(['ScriptDuration','TaskDuration','LayoutDuration','RecalcStyleDuration'].map(k=>[k,round(after[k]-before[k])])),audit:d.audit,peak:d.metrics.peak};
});
const films=['legacy','gsap'].map(engine=>{
  const d=read(`${engine}-film.json`),m=d.metrics;
  const launches=[...new Set(m.samples.filter(s=>Number(s.launchAt)>0 && s.state==='answering').map(s=>Number(s.launchAt)))];
  const turns=launches.map(at=>{
    const samples=m.samples.filter(s=>Number(s.launchAt)===at&&s.state==='answering');
    const find=fn=>{const x=samples.find(fn);return x?round(x.at-at):null;};
    const scales=s=>Number(/scaleX\(([^)]+)/.exec(s.line??'')?.[1]??0);
    const body=s=>Number(/scaleY\(([^)]+)/.exec(s.body??'')?.[1]??0);
    const schedule=m.scheduled.find(s=>s.at>=at);
    const onset=schedule?schedule.at+(schedule.when-schedule.contextTime)*1000:null;
    const first=samples.find(s=>s.highlight?.startsWith('本期'));
    const second=samples.find(s=>s.highlight?.startsWith('客户'));
    const canvasDrift=samples.filter(s=>s.canvas?.at>=at&&s.visual).map(s=>Math.max(Math.abs(s.canvas.stream-s.visual.stream)*350,Math.abs(s.canvas.unfold-s.visual.unfold)*250));
    return {at,lineStartMs:find(s=>scales(s)>.001),bodyStartMs:find(s=>Number(s.bodyOpacity)>.001),bodyFullMs:find(s=>body(s)>=.999),borderFullMs:find(s=>s.dash==='0'),pulseFullMs:find(s=>s.visual?.pulse>=1),streamStartMs:find(s=>s.visual?.stream>0),streamFullMs:find(s=>s.visual?.stream>=1),contentFullMs:find(s=>s.visual?.followups>=1),firstAudioScheduledMs:schedule?round(schedule.at-at):null,firstAudioOnsetMs:onset?round(onset-at):null,highlightFirstErrorMs:first&&onset?round(first.at-onset):null,highlightSecondErrorMs:second&&onset?round(second.at-onset-d.pcmSeconds[0]*1000):null,canvasDomProgressEquivalentSkewMs:canvasDrift.length?summary(canvasDrift):null};
  });
  return {engine,turns,audit:d.audit,reports:d.reports,pcmSeconds:d.pcmSeconds,errors:d.errors};
});
writeFileSync(`${dir}/comparison-summary.json`,JSON.stringify({performance,films},null,2));
const phases=[['Core pulse',0,120],['120-particle stream',100,450],['Horizontal line',400,500],['Card unfold',500,650],['SVG frame',400,650],['GSAP header',550,710],['GSAP metrics',600,800],['GSAP spoken',650,830],['GSAP followups',720,900]];
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="580" viewBox="0 0 1200 580"><rect width="1200" height="580" fill="#0a0806"/><g fill="#ffe8c7" font-family="sans-serif"><text x="30" y="40" font-size="25">XIAOCHUAN · ANSWER-relative timeline (ms)</text>${Array.from({length:11},(_,i)=>`<text x="${260+i*85}" y="80" font-size="14">${i*100}</text><path d="M${270+i*85} 90v410" stroke="#47311c"/>`).join('')}${phases.map(([label,a,b],i)=>`<text x="30" y="${124+i*42}" font-size="17">${label}</text><rect x="${270+a*.85}" y="${104+i*42}" width="${(b-a)*.85}" height="26" rx="5" fill="${i<4?'#c97f3d':'#ffb65c'}"/>`).join('')}<text x="30" y="550" font-size="16">Legacy and GSAP share the first four landmarks. Audio follows actual PCM events and is never gated by this timeline.</text></g></svg>`;
writeFileSync(`${root}/media/timeline.svg`,svg);
console.log(JSON.stringify({performance:performance.map(({name,frameMs,canvasCallbackMs,deltaSeconds})=>({name,frameMs,canvasCallbackMs,deltaSeconds})),films:films.map(({engine,turns})=>({engine,turns}))},null,2));
