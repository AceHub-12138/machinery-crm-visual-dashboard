#!/usr/bin/env python3
"""Standalone audit figures; run after capture, outside timed browser samples."""
import json,pathlib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root=pathlib.Path(__file__).resolve().parents[2]; raw=root/'.review/p1-4';out=root/'docs/nexus-p1-4/figures';out.mkdir(exist_ok=True)
plt.rcParams.update({'font.size':10,'figure.dpi':150,'savefig.bbox':'tight','axes.spines.top':False,'axes.spines.right':False})
colors={'legacy':'#e77c31','gsap':'#3289ab','clean':'#e77c31','instrumented':'#3289ab','dwell':'#6c9972'}
def save(fig,name):
 fig.savefig(out/(name+'.png'));fig.savefig(out/(name+'.svg'));plt.close(fig)
 svg=out/(name+'.svg');svg.write_text('\n'.join(line.rstrip() for line in svg.read_text().splitlines()).rstrip()+'\n')
bench=json.loads((root/'.review/gsap-poc/performance/benchmark.json').read_text())
fig,ax=plt.subplots(figsize=(8,3.6));r=bench['results'];ax.bar([f"{x['engine']}\n{x['width']} px" for x in r],[x['metrics']['fps'] for x in r],color=[colors[x['engine']] for x in r]);ax.set_ylim(0,65);ax.axhline(60,color='#777',ls='--',lw=1);ax.set_ylabel('Mean RAF FPS (adaptive quality)')
for i,x in enumerate(r):ax.text(i,x['metrics']['fps']+1,f"{x['metrics']['fps']:.2f}",ha='center')
ax.set_title('Original PoC runner, production build, DPR=1; not venue acceptance');save(fig,'baseline-matrix')
fig,axes=plt.subplots(2,1,figsize=(10,5.2),sharex=True)
for ax,engine in zip(axes,['legacy','gsap']):
 x=json.loads((raw/f'{engine}-3840-trace-metrics.json').read_text());segs=x['segments'];start=segs[0]['time']-1000;t=[(s['time']-start)/1000 for s in segs]
 ax.plot(t,[s['metrics']['fps'] for s in segs],color=colors[engine],label='1 s RAF sample');ax.axhline(45,color='#b75c55',ls=':',lw=.8);ax.axhline(52,color='#68986a',ls=':',lw=.8)
 ax2=ax.twinx();ax2.step(t,[1 if s['level']=='normal' else 0 for s in segs],where='post',color='#777',alpha=.5);ax2.set_yticks([0,1],['low','normal']);ax2.set_ylim(-.15,1.15);ax.set_ylabel(f'{engine} FPS');ax.set_ylim(0,65);ax.grid(alpha=.2)
axes[0].set_title('4K diagnostic trace: endpoint quality; trace overhead included');axes[-1].set_xlabel('Seconds in traced sample');save(fig,'quality-feedback')
mem=json.loads((raw/'memory.json').read_text());fig,axes=plt.subplots(1,2,figsize=(10,4))
for x in mem:
 rows=x['rows'];c=colors[x['label']];axes[0].plot([r['cycle'] for r in rows],[r['usedSize']/1048576 for r in rows],label=x['label'],color=c)
 warm=next(r for r in rows if r['cycle']==10)['usedSize'];axes[1].plot([r['cycle'] for r in rows if r['cycle']>=10],[(r['usedSize']-warm)/1048576 for r in rows if r['cycle']>=10],label=x['label'],color=c)
axes[0].axvspan(0,10,color='#999',alpha=.1);axes[0].set_ylabel('JS heap after forced GC (MiB)');axes[1].set_ylabel('Delta from warm cycle 10 (MiB)')
for ax in axes:ax.set_xlabel('Navigation / dwell iteration');ax.grid(alpha=.2);ax.legend(fontsize=8)
fig.suptitle('Same GSAP endpoint every even navigation; clean vs collector vs no navigation');save(fig,'memory-trend')
ab=json.loads((raw/'ablation.json').read_text());names=list(dict.fromkeys(x['name'] for x in ab));fig,ax=plt.subplots(figsize=(9,4))
for round,offset in [(1,-.18),(2,.18)]:
 rows={x['name']:x for x in ab if x['round']==round};ax.bar([i+offset for i in range(len(names))],[rows[n]['metrics']['fps'] for n in names],width=.36,label=f'round {round}')
ax.set_xticks(range(len(names)),names);ax.set_ylabel('Mean RAF FPS (adaptive quality)');ax.set_ylim(0,65);ax.axhline(60,color='#777',ls=':',lw=1);ax.legend();ax.set_title('Browser-only diagnostic CSS ablations; no product visual changes');save(fig,'ablation')
