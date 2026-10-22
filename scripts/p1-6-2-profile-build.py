"""Create a disposable, locally instrumented worktree. Never change release sources."""
from pathlib import Path
import subprocess, sys, json

source = Path(__file__).resolve().parents[1]
target = Path(sys.argv[1]).resolve()
if '--refresh' in sys.argv:
    proof=json.loads((source/'.review/p1-6-2/profile-build.json').read_text())
    if proof['target']!=str(target):raise ValueError('Not this task profiling worktree')
else:
    subprocess.run(['git', 'worktree', 'add', '--detach', str(target), '5ac9cff6398839d776ee5f92ac4fc34da92c9b3b'], cwd=source, check=True)
for name in ['src/components/overlay/AnswerCard.tsx', 'src/components/overlay/OverlayStage.tsx',
             'src/components/overlay/sentence-announcements.ts', 'src/components/overlay/JarvisCore.tsx',
             'src/components/overlay/motion/XiaochuanTimeline.ts', 'src/components/screen/motion/GsapTickerOwner.ts',
             'e2e/p1-6-2-performance.spec.ts', 'e2e/p1-6-2-performance.config.ts', 'e2e/p1-6-2-regression.config.ts', 'e2e/voice-cards.spec.ts']:
    (target/name).write_bytes((source/name).read_bytes())

(target/'src/lib/p162-local-profile.ts').write_text('''
type Meta = Record<string, number | boolean | string>;
type Api = { ms: Record<string, number>; count: Record<string, number> };
type Entry = { name: string; start: number; child: number; api?: Api };
type Profile = { stack: Entry[]; canvas?: Api; spans: Array<{ name: string; parent: string | null; start: number; end: number; ms: number; selfMs: number; meta: Meta; canvas?: Api }> };
declare global { interface Window { __p162Profile?: Profile } }
let installed = false;
function installCanvasProbe(p: Profile) {
  if(installed) return; installed = true;
  const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for(const name of ["drawImage","fillRect","stroke","fill","arc","beginPath","moveTo","lineTo"]) {
    const native = proto[name];
    proto[name] = function(this: CanvasRenderingContext2D, ...args: unknown[]) {
      const api = p.canvas; if(!api) return Reflect.apply(native,this,args);
      const start = performance.now(); try { return Reflect.apply(native,this,args); }
      finally { api.ms[name] = (api.ms[name] ?? 0) + performance.now()-start; api.count[name] = (api.count[name] ?? 0)+1; }
    };
  }
}
export function profileSpan(name: string, meta: Meta = {}) {
  const p = window.__p162Profile ??= { stack: [], spans: [] };
  if(name === "canvas-renderer") installCanvasProbe(p);
  const parent = p.stack.at(-1), entry: Entry = { name, start: performance.now(), child: 0 };
  if(name === "canvas-renderer") p.canvas = entry.api = { ms: {}, count: {} };
  p.stack.push(entry);
  return () => { const end = performance.now(), ms = end-entry.start;
    p.stack.pop(); if(parent) parent.child += ms;
    if(entry.api) p.canvas = undefined;
    p.spans.push({ name, parent: parent?.name ?? null, start: entry.start, end, ms, selfMs: Math.max(0,ms-entry.child), meta, canvas: entry.api }); };
}
''')

def edit(name, replacements):
    p=target/name; s=p.read_text()
    probe='import { profileSpan } from "@/lib/p162-local-profile";\n'
    s=s.replace('"use client";', '"use client";\n'+probe, 1) if s.startswith('"use client";') else probe+s
    for old,new in replacements:
        if s.count(old)!=1: raise ValueError((name, old, s.count(old)))
        s=s.replace(old,new)
    p.write_text(s)

edit('src/components/overlay/JarvisCore.tsx', [
 ('      if (!reduced) raf = requestAnimationFrame(loop);', '      const endSpan = profileSpan("canvas-renderer", { timestamp: now, ambientStride, coreHalf, quality, dpr, beam: PARTICLE_BUDGET.beam, state: frameRef.current.name });\n      try {\n      if (!reduced) raf = requestAnimationFrame(loop);'),
 ('      coreHalf = quality === "lite" || costEma > FRAME_BUDGET_MS * 1.5;', '      coreHalf = quality === "lite" || costEma > FRAME_BUDGET_MS * 1.5;\n      } finally { endSpan(); }'),
])
edit('src/components/overlay/AnswerCard.tsx', [
 ('      if (disposed) return;', '      if (disposed) return;\n      const endSpan = profileSpan("answer-dom");\n      try {'),
 ('      if (!motion) raf = requestAnimationFrame(paint);\n    };', '      if (!motion) raf = requestAnimationFrame(paint);\n      } finally { endSpan(); }\n    };'),
])
edit('src/components/overlay/motion/XiaochuanTimeline.ts', [
 ('  private emit() { this.subscribers.forEach(fn => fn()); }', '  private emit() { const end = profileSpan("subscribers"); try { this.subscribers.forEach(fn => fn()); } finally { end(); } }'),
 ('      track.timeline.totalTime(Math.min(elapsed, track.duration) / 1000, true);', '      const end = profileSpan("timeline-seek"); try { track.timeline.totalTime(Math.min(elapsed, track.duration) / 1000, true); } finally { end(); }'),
])
edit('src/components/screen/motion/GsapTickerOwner.ts', [
 ('  const tick = () => {', '  const tick = () => {\n    const endSpan = profileSpan("ticker-dispatch"); try {'),
 ('    if (!jobs.size) detach();\n  };', '    if (!jobs.size) detach();\n    } finally { endSpan(); }\n  };'),
 ('    request: fn => {', '    request: fn => {\n      const endSpan = profileSpan("host-request"); try {'),
 ('      return id;\n    },', '      return id;\n      } finally { endSpan(); }\n    },'),
])
# Keep the product gate, all particles, choreography and 60Hz cap byte-for-byte;
# only timing scopes surround the named functions in this disposable build.
patch=subprocess.check_output(['git','diff','--unified=0','--','src'],cwd=target)
out=source/'.review/p1-6-2';out.mkdir(parents=True,exist_ok=True)
(out/'profile-instrumentation.patch').write_bytes(patch)
(out/'profile-build.json').write_text(json.dumps({'source':str(source),'target':str(target),'base':'5ac9cff6398839d776ee5f92ac4fc34da92c9b3b','note':'Instrumentation only. Never use these durations as the uninstrumented 8ms gate.'},indent=2))
print(target)
