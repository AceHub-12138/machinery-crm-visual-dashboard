/**
 * 从阿里云 DataV 省界生成 LED 大屏用的简化中国轮廓。
 * 只保留大陆 + 台湾 + 海南等可见陆块，去掉南沙框线以免把山东挤出画面。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const RAW = path.join(ROOT, "src/data/china-raw.json");
const OUT = path.join(ROOT, "src/data/china-outline.json");
const SOURCE = "https://geo.datav.aliyun.com/areas_v3/bound/100000.json";

function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function simplify(points, epsilon) {
  if (points.length <= 4) return points;
  let maxD = 0;
  let idx = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpDist(points[i], points[0], points[end]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > epsilon) {
    const left = simplify(points.slice(0, idx + 1), epsilon);
    const right = simplify(points.slice(idx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[end]];
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area / 2);
}

function ringBBox(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

if (!fs.existsSync(RAW)) {
  throw new Error(`缺少 ${RAW}，请先下载 ${SOURCE}`);
}

const geo = JSON.parse(fs.readFileSync(RAW, "utf8"));
const polys = geo.features[0].geometry.coordinates;
const EPSILON = 0.06;
const MIN_AREA = 0.015;
const simplified = [];

for (const poly of polys) {
  const outer = poly[0];
  const bbox = ringBBox(outer);
  if (bbox.maxY < 17.5) continue;
  if (ringArea(outer) < MIN_AREA) continue;
  const rings = [];
  for (const ring of poly) {
    if (ringArea(ring) < MIN_AREA) continue;
    const next = simplify(ring, EPSILON);
    if (next.length >= 4) rings.push(next);
  }
  if (rings.length) simplified.push(rings);
}

let minX = Infinity;
let minY = Infinity;
let maxX = -Infinity;
let maxY = -Infinity;
for (const poly of simplified) {
  for (const ring of poly) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}

const width = 1080;
const height = 780;
const padX = 28;
const padY = 22;

function project(lon, lat) {
  const x = padX + ((lon - minX) / (maxX - minX)) * (width - padX * 2);
  const y = padY + ((maxY - lat) / (maxY - minY)) * (height - padY * 2);
  return [Number(x.toFixed(2)), Number(y.toFixed(2))];
}

function ringToPath(ring) {
  return (
    ring
      .map((point, index) => {
        const [x, y] = project(point[0], point[1]);
        return `${index === 0 ? "M" : "L"}${x} ${y}`;
      })
      .join(" ") + " Z"
  );
}

const factory = { lon: 117.1656, lat: 35.0886, name: "大川机床滕州工厂" };
const [fx, fy] = project(factory.lon, factory.lat);

const out = {
  viewBox: `0 0 ${width} ${height}`,
  width,
  height,
  padX,
  padY,
  bounds: { minX, minY, maxX, maxY },
  factory: { ...factory, x: fx, y: fy },
  paths: simplified.map((poly) => poly.map(ringToPath).join(" ")),
};

fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT} (${fs.statSync(OUT).size} bytes, ${out.paths.length} polygons)`);
