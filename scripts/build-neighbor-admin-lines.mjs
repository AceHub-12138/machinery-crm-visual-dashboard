/**
 * 生成邻国一级行政区「内边线」（admin-1 interior boundaries），用于给大屏
 * 周围国家的色块增加地理纹理。
 *
 * 数据源：src/data/ne-admin1-neighbors-raw.json（Natural Earth 10m
 * admin_1_states_provinces 裁剪到 scripts/neighbors.mjs 的 26 国，公有领域；
 * 由 scripts/trim-admin1-raw.mjs 一次性裁剪生成）。
 *
 * 只保留**同一国家内两个行政区共享**的边（顶点级精确匹配计数 = 2）：
 *   - 计数 1        = 海岸线 / 数据裁剪边 → 丢弃（海岸由国界面填色边缘负责）；
 *   - 计数 2 但分属两国 = 国界           → 丢弃（国界由邻国描边负责）；
 *   - 计数 > 2      = 数据顶点伪影       → 丢弃。
 * 因此画出来的只有「省界」，不与海岸线、国界重复。
 *
 * 投影参数**读取 src/data/china-map.json**（lonLat 窗口 + pitch），
 * 不在本脚本复制外框常数 —— china-map.json 重生成后本脚本自然对齐。
 * 先在经纬度域提边、串链、简化，再统一投影；输出坐标保留 1 位小数
 * （纹理线，0.1 画布单位精度足够）。
 *
 * 输出：src/data/neighbor-admin-lines.json / .ts，按国家合并为单条 path。
 */
import fs from "node:fs";
import path from "node:path";
import { simplify } from "./simplify.mjs";
import { NEIGHBORS } from "./neighbors.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const RAW = path.join(ROOT, "src/data/ne-admin1-neighbors-raw.json");
const FRAME = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/china-map.json"), "utf8"));
const OUT = path.join(ROOT, "src/data/neighbor-admin-lines.json");
const OUT_TS = path.join(ROOT, "src/data/neighbor-admin-lines.ts");

/** 共享边的顶点量化精度（度）。NE 邻接面片共享同一份边界弧线，7 位小数足以对齐。 */
const EDGE_QUANT = 1e7;

/** 简化强度（度）。纹理线只要走势，不需海岸级精度。 */
const ADMIN_EPS = 0.12;
/** 行政区最小面积（度²）：滤掉小岛碎面，口径与 build-china-map 的 minArea 一致。 */
const MIN_UNIT_AREA = 0.02;
/** 简化后链路最短画布长度：短于此的碎线丢弃。 */
const MIN_CHAIN_CANVAS = 9;
/** 单链点数防御上限，异常数据不炸内存。 */
const MAX_CHAIN_POINTS = 20000;

const { lon: LON, lat: LAT } = FRAME.lonLat;
const PITCH = FRAME.pitch;
const project = (lon, lat) => [
  Number(((lon - LON.min) * PITCH).toFixed(1)),
  Number(((LAT.max - lat) * PITCH).toFixed(1)),
];

const quant = (v) => Math.round(v * EDGE_QUANT) / EDGE_QUANT;
const pointKey = ([lon, lat]) => `${quant(lon)},${quant(lat)}`;
const edgeId = (from, to) => (from < to ? `${from}|${to}` : `${to}|${from}`);

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area / 2);
}

function ringMaxLat(ring) {
  let max = -Infinity;
  for (const point of ring) if (point[1] > max) max = point[1];
  return max;
}

function polygonsOf(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

const raw = JSON.parse(fs.readFileSync(RAW, "utf8"));
const targetAdmins = new Set(NEIGHBORS.map(([en]) => en));

/* ---- 第一步：全量边的顶点级计数（在原始环上做，不先裁剪，避免裁剪伪造邻接） ---- */

/** edgeId → { count, admins:Set, a, b } */
const edges = new Map();
for (const feature of raw.features) {
  const admin = feature.properties.admin;
  if (!targetAdmins.has(admin)) continue;
  for (const polygon of polygonsOf(feature.geometry)) {
    for (const ring of polygon) {
      // 整环都在画布以南的碎岛：其边不可能落进窗口，跳过省内存
      if (ringMaxLat(ring) < LAT.min - 2) continue;
      if (ringArea(ring) < MIN_UNIT_AREA) continue;
      for (let i = 0; i < ring.length - 1; i += 1) {
        const a = ring[i];
        const b = ring[i + 1];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        const id = edgeId(pointKey(a), pointKey(b));
        const record = edges.get(id);
        if (record) {
          record.count += 1;
          record.admins.add(admin);
        } else {
          edges.set(id, { count: 1, admins: new Set([admin]), a, b });
        }
      }
    }
  }
}

/* ---- 第二步：内边线 = 同国两区共享、且两端都落在画布窗口内的边 ---- */

/** pointKey → Map(adminEN → Array<{ to: pointKey, coords: [[lon,lat],[lon,lat]] }>) */
const adjacency = new Map();
let keptEdges = 0;
for (const record of edges.values()) {
  if (record.count !== 2 || record.admins.size !== 1) continue;
  const [admin] = record.admins;
  const inWindow = ([lon, lat]) =>
    lon >= LON.min && lon <= LON.max && lat >= LAT.min && lat <= LAT.max;
  if (!inWindow(record.a) || !inWindow(record.b)) continue;
  keptEdges += 1;
  const pa = pointKey(record.a);
  const pb = pointKey(record.b);
  for (const [from, to, coords] of [
    [pa, pb, [record.a, record.b]],
    [pb, pa, [record.b, record.a]],
  ]) {
    if (!adjacency.has(from)) adjacency.set(from, new Map());
    const byAdmin = adjacency.get(from);
    if (!byAdmin.has(admin)) byAdmin.set(admin, []);
    byAdmin.get(admin).push({ to, coords });
  }
}

/* ---- 第三步：按国家串链。每条无向边只消费一次；度=1 的端点先走开链，剩下的都是闭环 ---- */

function walk(startFrom, startLink, links, used) {
  const chain = [startLink.coords[0], startLink.coords[1]];
  let cur = startLink.to;
  /** 来向参考点：分叉路口按「与来向最顺」选延续，让边界线穿过 Y 型三区交点 */
  let prevPt = startLink.coords[0];
  used.add(edgeId(startFrom, cur));
  for (;;) {
    const candidates = (links.get(cur) || []).filter((link) => !used.has(edgeId(cur, link.to)));
    if (candidates.length === 0 || chain.length >= MAX_CHAIN_POINTS) break;
    let next;
    if (candidates.length === 1) {
      next = candidates[0];
    } else {
      const fromX = chain[chain.length - 1][0] - prevPt[0];
      const fromY = chain[chain.length - 1][1] - prevPt[1];
      const fromLen = Math.hypot(fromX, fromY) || 1;
      let best = -Infinity;
      for (const candidate of candidates) {
        const outX = candidate.coords[1][0] - candidate.coords[0][0];
        const outY = candidate.coords[1][1] - candidate.coords[0][1];
        const dot =
          (fromX * outX + fromY * outY) / (fromLen * (Math.hypot(outX, outY) || 1));
        if (dot > best) {
          best = dot;
          next = candidate;
        }
      }
    }
    used.add(edgeId(cur, next.to));
    prevPt = next.coords[0];
    chain.push(next.coords[1]);
    if (next.to === startFrom) break; // 闭环回到起点
    cur = next.to;
  }
  return chain;
}

function chainsFor(adminEN) {
  const links = new Map();
  for (const [from, byAdmin] of adjacency) {
    const own = byAdmin.get(adminEN);
    if (own) links.set(from, own);
  }
  const used = new Set();
  const chains = [];
  // 开链：从度=1 的端点出发
  for (const [from, own] of links) {
    if (own.length !== 1) continue;
    if (used.has(edgeId(from, own[0].to))) continue;
    chains.push(walk(from, own[0], links, used));
  }
  // 剩余未消费的边全在闭环上
  for (const [from, own] of links) {
    for (const link of own) {
      if (used.has(edgeId(from, link.to))) continue;
      chains.push(walk(from, link, links, used));
    }
  }
  return chains;
}

/* ---- 第四步：简化、投影、按国家合并成单条 path ---- */

const lines = [];
const debug = process.env.DEBUG === "1";
for (const [en, zh] of NEIGHBORS) {
  const rawChains = chainsFor(en);
  const rawPoints = rawChains.reduce((sum, chain) => sum + chain.length, 0);
  let droppedShort = 0;
  let droppedLen = 0;
  const paths = [];
  let pointCount = 0;
  for (const chain of rawChains) {
    const simplified = simplify(chain, ADMIN_EPS);
    // 注意：2 点链是合法的——西伯利亚式的直线州界简化后就是两端点，不能丢；
    // 碎线噪声交给画布长度过滤（MIN_CHAIN_CANVAS）负责。
    if (simplified.length < 2) {
      droppedShort += 1;
      continue;
    }
    const projected = simplified.map(([lon, lat]) => project(lon, lat));
    let canvasLength = 0;
    for (let i = 1; i < projected.length; i += 1) {
      canvasLength += Math.hypot(
        projected[i][0] - projected[i - 1][0],
        projected[i][1] - projected[i - 1][1],
      );
    }
    if (canvasLength < MIN_CHAIN_CANVAS) {
      droppedLen += 1;
      continue;
    }
    pointCount += projected.length;
    paths.push(projected.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(" "));
  }
  if (debug) {
    console.error(
      `${zh}: rawChains=${rawChains.length} rawPoints=${rawPoints} droppedShort=${droppedShort} droppedLen=${droppedLen} kept=${paths.length}/${pointCount}`,
    );
  }
  if (!paths.length) continue;
  lines.push({ key: zh, admin: en, chains: paths.length, points: pointCount, d: paths.join(" ") });
}

lines.sort((a, b) => a.key.localeCompare(b.key, "zh-CN"));
const out = { viewBox: FRAME.viewBox, pitch: PITCH, lines: lines.map(({ key, d }) => ({ key, d })) };

fs.writeFileSync(OUT, JSON.stringify(out));
fs.writeFileSync(OUT_TS, `export const neighborAdminLines = ${JSON.stringify(out)};\n`);

console.log({
  out: path.relative(ROOT, OUT),
  ts: path.relative(ROOT, OUT_TS),
  bytes: fs.statSync(OUT).size,
  tsBytes: fs.statSync(OUT_TS).size,
  sharedEdges: keptEdges,
  countries: lines.length,
  perCountry: lines.map(({ key, chains, points }) => `${key}:${chains}链/${points}点`),
});
