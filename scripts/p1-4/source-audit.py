#!/usr/bin/env python3
"""Read-only local source inventory. No credentials, production requests, or product edits."""
import collections, hashlib, json, pathlib, re, subprocess
ROOT=pathlib.Path(__file__).resolve().parents[2]
REPOS={'crm':ROOT.parent/'machinery-crm','desktop':ROOT.parent/'machinery-crm-desktop','nexus':ROOT}
PATTERNS={
'gsap':r'\bgsap\b|useGSAP|CustomEase',
'raf':r'requestAnimationFrame|cancelAnimationFrame',
'css':r'@keyframes|animation\s*:|transition\s*:|transition-property|\banimate-[\w-]+|\btransition-[\w-]+',
'graphics':r'getContext\(|<canvas|<svg|<animate\b|webgl|WebGL|Spline',
'lifecycle':r'visibilitychange|prefers-reduced-motion|ticker\.|\.kill\(|\.revert\(',
'other-engine':r'framer-motion|react-spring|three\b|pixi|lottie|\.animate\(',
'orchestration-consumer':r'MotionPage|StaggerContainer|AnimatedNumber|CountUp|ParticleField|AmbientBackground',
}
out=ROOT/'.review/p1-4';out.mkdir(parents=True,exist_ok=True)
hits=[];files=[];states={}
for name,root in REPOS.items():
 def git(*args):return subprocess.check_output(['git','-C',str(root),*args],text=True).strip()
 states[name]={'path':str(root),'head':git('rev-parse','HEAD'),'branch':git('branch','--show-current'),'status':git('status','--porcelain=v1'),'remote':git('remote','get-url','origin')}
 for rel in git('ls-files','src','electron').splitlines():
  if not re.search(r'\.(tsx?|jsx?|css|scss)$',rel) or re.search(r'\.(test|spec)\.',rel):continue
  p=root/rel
  if not p.is_file():continue
  text=p.read_text();matches=[]
  for line,s in enumerate(text.splitlines(),1):
   kinds=[k for k,pat in PATTERNS.items() if re.search(pat,s)]
   if kinds:
    h={'repo':name,'file':rel,'line':line,'kinds':kinds,'text':s};matches.append(h);hits.append(h)
  if matches:files.append({'repo':name,'file':rel,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'hits':len(matches),'kinds':sorted(set(k for h in matches for k in h['kinds']))})
(out/'source-hits.json').write_text(json.dumps(hits,ensure_ascii=False,indent=2))
(out/'source-files.json').write_text(json.dumps(files,ensure_ascii=False,indent=2))
(ROOT/'docs/nexus-p1-4/source-versions.json').write_text(json.dumps({'repositories':states,'files':files},ensure_ascii=False,indent=2))
lines=['# 源码检索证据索引','',f'扫描三仓库 tracked src/electron 源文件（排除测试）；{len(files)} 个命中文件，{len(hits)} 个命中行。误命中也保留，例如 PDF Canvas、CAD 文本、打印双 RAF，不把它们算成动画。第三方压缩运行时不反编译；部署端与未检出的远端分支不在本次范围。','', '重建：`python3 scripts/p1-4/source-audit.py`。版本和文件 SHA-256 见 [source-versions.json](source-versions.json)。完整 machine-readable 结果在 `.review/p1-4/source-hits.json`。','']
for name,root in REPOS.items():
 lines += [f'## {name}', '',f'根目录：`{root}`；HEAD：`{states[name]["head"]}`。','']
 for f in [x for x in files if x['repo']==name]:
  hs=[h for h in hits if h['repo']==name and h['file']==f['file']]
  lines += [f'### {f["file"]}', '',f'类别：{", ".join(f["kinds"])}；证据：[打开源码]({root / f["file"]}:{hs[0]["line"]})。','', '```text']
  for h in hs:
   # Long JSX is retained in raw JSON; index bounds each line for readability.
   s=h['text'].strip();lines.append(f'{h["line"]}: {s[:420]}'+(' … [完整行见源码/JSON]' if len(s)>420 else ''))
  lines += ['```','']
(ROOT/'docs/nexus-p1-4/source-index.md').write_text('\n'.join(lines))
print(json.dumps({'files':len(files),'hits':len(hits),'repos':states},ensure_ascii=False,indent=2))
