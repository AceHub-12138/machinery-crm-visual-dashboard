"""Render benchmark evidence plots after the benchmark (requires matplotlib)."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

root = Path('.review/gsap-poc/performance')
report = json.loads((root / 'benchmark.json').read_text())
if not report.get('finishedAt') or len(report['results']) != 4:
    raise SystemExit('Wait for the complete benchmark before plotting.')
colors = {'legacy': '#ee7d2c', 'gsap': '#38bdf8'}
fig, axes = plt.subplots(2, 1, figsize=(12, 7), constrained_layout=True)
for ax, width in zip(axes, (1920, 3840)):
    for row in (r for r in report['results'] if r['width'] == width):
        raw = json.loads((root / f"{row['engine']}-{width}-raw.json").read_text())
        elapsed = 0
        bins = {}
        for interval in raw['intervals']:
            elapsed += interval
            second = int(elapsed // 1000)
            bins[second] = bins.get(second, 0) + 1
        seconds = list(range(int(elapsed // 1000)))
        ax.plot(seconds, [bins.get(s, 0) for s in seconds], label=row['engine'], color=colors[row['engine']], linewidth=1.1, alpha=.85)
    ax.axhline(45, color='#888888', linestyle='--', linewidth=.8, label='Low-FPS threshold')
    ax.set(title=f'{width} x {width * 9 // 16} (adaptive motion enabled)', xlabel='Elapsed real seconds', ylabel='RAF callbacks / second', ylim=(0, 66))
    ax.grid(alpha=.2)
    ax.legend(loc='lower right', ncol=3)
fig.suptitle('NEXUS PoC: real-time RAF cadence (not GPU presentation FPS)')
fig.savefig(root / 'fps-timeline.png', dpi=160)
plt.close(fig)
fig, ax = plt.subplots(figsize=(10, 5), constrained_layout=True)
for row in report['results']:
    values = [row['afterGCHeap']['usedSize'] / 1048576] + [r['usedSize'] / 1048576 for r in row['clientNavigationRetention']]
    ax.plot(range(len(values)), values, marker='.', label=f"{row['width']}px / {row['engine']} start")
ax.set(title='Renderer JS heap after forced GC; alternating Legacy / GSAP navigation', xlabel='Client navigation count (0 = end of timed sample)', ylabel='Used JS heap (MiB)')
ax.grid(alpha=.2)
ax.legend()
fig.savefig(root / 'navigation-heap.png', dpi=160)
plt.close(fig)
print('Saved fps-timeline.png and navigation-heap.png')
