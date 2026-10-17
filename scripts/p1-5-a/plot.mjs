import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const series = JSON.parse(readFileSync('docs/nexus-p1-5-a/evidence/time-series.json', 'utf8'));
const width = 1600, height = 1120, margin = 70, panelWidth = 700, panelHeight = 210, gapX = 70, gapY = 45;
const maxSeconds = 60, maxHz = 110;
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const color = { browser: '#8e9bab', engine: '#ee7d2c', director: '#36c5f0', low: '#6f2430', grid: '#33404d', text: '#e8edf2' };

function pointPath(points, key, x, y) {
  return points.filter(point => Number.isFinite(point[key])).map((point, index) => {
    const px = x + (point.elapsedMs / 1000) / maxSeconds * panelWidth;
    const py = y + panelHeight - Math.min(maxHz, point[key]) / maxHz * panelHeight;
    return `${index ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
  }).join(' ');
}

const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  `<rect width="100%" height="100%" fill="#10151b"/>`,
  `<text x="${margin}" y="38" fill="${color.text}" font-family="system-ui" font-size="24" font-weight="700">NEXUS P1.5-A 频率与质量档位时间序列</text>`,
  `<text x="900" y="38" fill="${color.browser}" font-family="system-ui" font-size="15">浏览器 RAF 代理</text><line x1="1025" y1="33" x2="1065" y2="33" stroke="${color.browser}" stroke-dasharray="5 4"/>`,
  `<text x="1080" y="38" fill="${color.engine}" font-family="system-ui" font-size="15">引擎底层回调</text><line x1="1190" y1="33" x2="1230" y2="33" stroke="${color.engine}"/>`,
  `<text x="1245" y="38" fill="${color.director}" font-family="system-ui" font-size="15">Director 更新</text><line x1="1350" y1="33" x2="1390" y2="33" stroke="${color.director}"/>`,
  `<text x="1405" y="38" fill="#d77b89" font-family="system-ui" font-size="15">红底=低档</text>`];

series.forEach((item, index) => {
  const column = index % 2, row = Math.floor(index / 2);
  const x = margin + column * (panelWidth + gapX), y = 70 + row * (panelHeight + gapY);
  const title = `${item.backend === 'headless' ? 'SwiftShader / headless' : 'Metal / headed'} · ${item.id.replace('-', ' · ')}`;
  parts.push(`<text x="${x}" y="${y - 10}" fill="${color.text}" font-family="system-ui" font-size="16" font-weight="600">${esc(title)}</text>`);
  for (let hz = 0; hz <= 100; hz += 20) {
    const py = y + panelHeight - hz / maxHz * panelHeight;
    parts.push(`<line x1="${x}" y1="${py}" x2="${x + panelWidth}" y2="${py}" stroke="${color.grid}" stroke-width="1"/>`,
      `<text x="${x - 8}" y="${py + 4}" text-anchor="end" fill="#84909c" font-family="system-ui" font-size="11">${hz}</text>`);
  }
  for (const point of item.points) {
    if (point.level !== 'low') continue;
    const px = x + (point.elapsedMs / 1000) / maxSeconds * panelWidth;
    parts.push(`<rect x="${px}" y="${y}" width="${panelWidth / maxSeconds}" height="${panelHeight}" fill="${color.low}" opacity="0.35"/>`);
  }
  parts.push(`<path d="${pointPath(item.points, 'browserRafProxyHz', x, y)}" fill="none" stroke="${color.browser}" stroke-width="1.5" stroke-dasharray="5 4"/>`,
    `<path d="${pointPath(item.points, 'engineCallbackHz', x, y)}" fill="none" stroke="${color.engine}" stroke-width="1.5"/>`,
    `<path d="${pointPath(item.points, 'directorUpdateHz', x, y)}" fill="none" stroke="${color.director}" stroke-width="2"/>`,
    `<rect x="${x}" y="${y}" width="${panelWidth}" height="${panelHeight}" fill="none" stroke="#617181"/>`,
    `<text x="${x}" y="${y + panelHeight + 18}" fill="#84909c" font-family="system-ui" font-size="11">0s</text>`,
    `<text x="${x + panelWidth}" y="${y + panelHeight + 18}" text-anchor="end" fill="#84909c" font-family="system-ui" font-size="11">60s</text>`);
});
parts.push(`<text x="${margin}" y="${height - 18}" fill="#9ba8b4" font-family="system-ui" font-size="13">RAF 仅是调度代理；图中没有“实际呈现 FPS”。GSAP 底层 RAF 与 ticker listener/Director 更新是不同频率。</text>`, '</svg>');
mkdirSync('docs/nexus-p1-5-a/figures', { recursive: true });
const file = path.resolve('docs/nexus-p1-5-a/figures/cadence-quality.svg');
writeFileSync(file, parts.join('\n'));
console.log(file);
