import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const aggregate = JSON.parse(readFileSync('docs/nexus-p1-5-b/evidence/aggregate.json', 'utf8'));
const long = JSON.parse(readFileSync('docs/nexus-p1-5-b/evidence/long-run.json', 'utf8')).run;
mkdirSync('docs/nexus-p1-5-b/figures', { recursive: true });
const colors = { bg: '#10151b', grid: '#33404d', text: '#e8edf2', legacy: '#ee7d2c', gsap: '#36c5f0', low: '#6f2430', probe: '#7b6c24', normal: '#194d3a' };

function frequencyFigure() {
  const width = 1600, height = 920, margin = 85, panelWidth = 1430, panelHeight = 300;
  const order = [
    ['headless-swiftshader', 1920, 'SW无头·1080'], ['headless-swiftshader', 3840, 'SW无头·4K'],
    ['headed-metal', 1920, 'Metal·1080'], ['headed-metal', 3840, 'Metal·4K'],
    ['headed-swiftshader', 1920, 'SW有头·1080'], ['headed-swiftshader', 3840, 'SW有头·4K'],
  ];
  const rows = aggregate.frequencySummary.filter(item => item.profile === 'shared60');
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`, `<rect width="100%" height="100%" fill="${colors.bg}"/>`,
    `<text x="${margin}" y="42" fill="${colors.text}" font-family="system-ui" font-size="26" font-weight="700">P1.5-B 相同60Hz目标：三次重复中位数</text>`];
  const panels = [
    { y: 85, title: 'MotionDirector 更新频率（Hz）', max: 65, key: 'directorHz' },
    { y: 500, title: '每次估算 Director 更新的引擎回调成本（ms）', max: .35, key: 'callbackCostPerEstimatedUpdateMs' },
  ];
  for (const panel of panels) {
    parts.push(`<text x="${margin}" y="${panel.y - 12}" fill="${colors.text}" font-family="system-ui" font-size="19">${panel.title}</text>`);
    for (let index = 0; index <= 5; index++) {
      const value = panel.max * index / 5, y = panel.y + panelHeight - panelHeight * index / 5;
      parts.push(`<line x1="${margin}" y1="${y}" x2="${margin + panelWidth}" y2="${y}" stroke="${colors.grid}"/>`, `<text x="${margin - 10}" y="${y + 4}" text-anchor="end" fill="#93a0ad" font-family="system-ui" font-size="12">${value < 1 ? value.toFixed(2) : value.toFixed(0)}</text>`);
    }
    order.forEach(([backend, res, label], groupIndex) => {
      const center = margin + 90 + groupIndex * 225;
      for (const [engine, offset, color] of [['legacy', -32, colors.legacy], ['gsap', 32, colors.gsap]]) {
        const row = rows.find(item => item.backend === backend && item.width === res && item.engine === engine);
        const value = row.metrics[panel.key].median;
        const barHeight = value / panel.max * panelHeight;
        parts.push(`<rect x="${center + offset - 24}" y="${panel.y + panelHeight - barHeight}" width="48" height="${barHeight}" fill="${color}"/>`, `<text x="${center + offset}" y="${panel.y + panelHeight - barHeight - 6}" text-anchor="middle" fill="${color}" font-family="system-ui" font-size="12">${value.toFixed(2)}</text>`);
      }
      parts.push(`<text x="${center}" y="${panel.y + panelHeight + 22}" text-anchor="middle" fill="${colors.text}" font-family="system-ui" font-size="13">${label}</text>`);
    });
  }
  parts.push(`<rect x="1200" y="22" width="18" height="12" fill="${colors.legacy}"/><text x="1225" y="33" fill="${colors.text}" font-family="system-ui" font-size="13">Legacy</text>`, `<rect x="1300" y="22" width="18" height="12" fill="${colors.gsap}"/><text x="1325" y="33" fill="${colors.text}" font-family="system-ui" font-size="13">GSAP</text>`, `<text x="${margin}" y="${height - 20}" fill="#9ba8b4" font-family="system-ui" font-size="13">RAF是调度代理，不是实际呈现FPS；100Hz浏览器用10/20ms离散节拍逼近60Hz。</text>`, '</svg>');
  writeFileSync('docs/nexus-p1-5-b/figures/frequency-comparison.svg', parts.join('\n'));
}

function longFigure() {
  const width = 1600, height = 900, margin = 80, plotWidth = 1450, plotHeight = 290;
  const points = long.minuteTimeline;
  const resources = long.resourceTimeline;
  const x = ms => margin + ms / 1_800_000 * plotWidth;
  const path = (items, selector, y, max) => items.map((item, index) => `${index ? 'L' : 'M'}${x(item.elapsedMs).toFixed(1)},${(y + plotHeight - selector(item) / max * plotHeight).toFixed(1)}`).join(' ');
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`, `<rect width="100%" height="100%" fill="${colors.bg}"/>`, `<text x="${margin}" y="42" fill="${colors.text}" font-family="system-ui" font-size="26" font-weight="700">P1.5-B GPT-6 Luna · 30分钟稳定性</text>`];
  for (const panel of [{ y: 90, title: 'Director更新频率与质量状态', max: 65 }, { y: 520, title: 'JS Heap（MiB）', max: 14 }]) {
    parts.push(`<text x="${margin}" y="${panel.y - 12}" fill="${colors.text}" font-family="system-ui" font-size="19">${panel.title}</text>`);
    for (let index = 0; index <= 5; index++) { const yy = panel.y + plotHeight - plotHeight * index / 5; parts.push(`<line x1="${margin}" y1="${yy}" x2="${margin + plotWidth}" y2="${yy}" stroke="${colors.grid}"/>`); }
  }
  for (let minute = 0; minute < 30; minute++) {
    const point = points.find(item => Math.floor(item.elapsedMs / 60_000) === minute);
    const fill = point?.phase === 'normal' ? colors.normal : point?.phase === 'probe' ? colors.probe : colors.low;
    parts.push(`<rect x="${x(minute * 60_000)}" y="90" width="${plotWidth / 30 + 1}" height="${plotHeight}" fill="${fill}" opacity="0.33"/>`);
  }
  parts.push(`<path d="${path(points, item => item.directorUpdateHz ?? 0, 90, 65)}" fill="none" stroke="${colors.gsap}" stroke-width="3"/>`, `<path d="${path(resources, item => item.heap.usedSize / 1048576, 520, 14)}" fill="none" stroke="${colors.legacy}" stroke-width="3"/>`);
  const reliefX = x(long.loadRelief.appliedAtMs);
  parts.push(`<line x1="${reliefX}" y1="70" x2="${reliefX}" y2="830" stroke="#f4d35e" stroke-width="3" stroke-dasharray="8 5"/>`, `<text x="${reliefX + 8}" y="78" fill="#f4d35e" font-family="system-ui" font-size="14">25:00 降低视口负载</text>`);
  for (let minute = 0; minute <= 30; minute += 5) parts.push(`<text x="${x(minute * 60_000)}" y="850" text-anchor="middle" fill="#9ba8b4" font-family="system-ui" font-size="13">${minute}m</text>`);
  parts.push(`<text x="${margin}" y="885" fill="#9ba8b4" font-family="system-ui" font-size="13">红=low，黄=probe，绿=normal；堆为自然GC锯齿，结束强制GC后7.43MiB。</text>`, '</svg>');
  writeFileSync('docs/nexus-p1-5-b/figures/long-stability.svg', parts.join('\n'));
}

frequencyFigure(); longFigure();
console.log('docs/nexus-p1-5-b/figures/frequency-comparison.svg\ndocs/nexus-p1-5-b/figures/long-stability.svg');
