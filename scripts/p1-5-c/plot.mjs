import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const out='docs/nexus-p1-5-c/figures';mkdirSync(out,{recursive:true});
for(const engine of ['gsap','legacy']){
 const r=JSON.parse(readFileSync(`.review/p1-5-c/soak-${engine}/report.json`,'utf8'));
 const width=1200,height=620,left=70,right=35,span=width-left-right;
 const x=t=>left+t/r.actualMs*span;
 const line=(points,color)=>`<polyline fill="none" stroke="${color}" stroke-width="1.5" points="${points.map(p=>p.map(n=>n.toFixed(2)).join(',')).join(' ')}"/>`;
 const hz=r.samples.filter(s=>Number.isFinite(s.decision?.evidence?.updateHz)).map(s=>[x(s.elapsedMs),190-s.decision.evidence.updateHz/70*130]);
 const heap=r.resources.map(s=>({x:x(s.elapsedMs),mb:s.JSHeapUsedSize/1048576}));const heapMax=Math.ceil(Math.max(...heap.map(s=>s.mb)));
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/><style>text{font:14px -apple-system,BlinkMacSystemFont,sans-serif;fill:#26313f}.small{font-size:12px}.title{font-size:21px;font-weight:600}</style><text x="${left}" y="30" class="title">${engine.toUpperCase()} 候选策略 · 实际墙钟 ${(r.actualMs/60000).toFixed(2)} 分钟</text><text x="${left}" y="52" class="small">无头软件后端，测试 RAF 上限 60Hz；曲线是 Director 更新率，不能当作呈现 FPS。</text>`;
 for(const value of [0,20,40,60]){const yy=190-value/70*130;svg+=`<path d="M${left} ${yy}H${width-right}" stroke="#e5e7eb"/><text x="22" y="${yy+4}">${value}Hz</text>`;}
 svg+=line(hz,'#d96b16');svg+=`<text x="${left}" y="225">质量状态（绿 normal / 橙 low / 蓝 probe / 灰 环境暂停）</text>`;
 const colors={normal:'#3b9e6b',low:'#dd852e',probe:'#367bc5',paused:'#929baa'};let segmentStart=0,lastState;
 for(let i=0;i<=r.samples.length;i++){
  const s=r.samples[i],state=s?(s.paused==='true'?'paused':s.decision?.state??'normal'):null;
  if(i&&state!==lastState){const a=r.samples[segmentStart],b=s??{elapsedMs:r.actualMs};svg+=`<rect x="${x(a.elapsedMs)}" y="238" width="${Math.max(.8,x(b.elapsedMs)-x(a.elapsedMs))}" height="18" fill="${colors[lastState]}"><title>${lastState}: ${(a.elapsedMs/1000).toFixed(1)}–${(b.elapsedMs/1000).toFixed(1)} 秒</title></rect>`;segmentStart=i;}
  lastState=state;
 }
 svg+=`<text x="${left}" y="298">JS used heap（自然 GC；结束 GC 数值另见报告）</text>`;
 for(const value of [0,Math.ceil(heapMax/2),heapMax]){const yy=460-value/heapMax*140;svg+=`<path d="M${left} ${yy}H${width-right}" stroke="#e5e7eb"/><text x="15" y="${yy+4}">${value}MB</text>`;}
 svg+=line(heap.map(s=>[s.x,460-s.mb/heapMax*140]),'#387db0');
 const relief=r.actions.find(a=>a.action==='viewport-relief-3840-to-1920');if(relief){const xx=x(relief.elapsedMs);svg+=`<path d="M${xx} 62V470" stroke="#8b5bb5" stroke-dasharray="5 4"/><text x="${Math.max(left,xx-135)}" y="495" class="small">${(relief.elapsedMs/60000).toFixed(1)} 分钟：仅缩小渲染视口</text>`;}
 for(let m=0;m<=r.actualMs/60000;m+=r.actualMs>=1000000?5:2){const xx=x(m*60000);svg+=`<text x="${xx-8}" y="528">${m}分</text>`;}
 svg+=`<text x="${left}" y="565" class="small">所有地图、航线、数字、仪表、发货模块保留；low/static 沿用既有保护档粒子规则。</text><text x="${left}" y="590" class="small">计时与录屏分开。实验成功恢复、资源趋势、暂停明细及实际 ticker 计数见结构化证据；不代表现场 LED 验收。</text></svg>`;
 writeFileSync(`${out}/${engine}-soak.svg`,svg);
}
