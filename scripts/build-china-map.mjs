/**
 * 生成 LED 大屏用的省市板块 + 周边邻国 + 国界剪影 + 球面网格。
 *
 * Rev 4：**由外框（viewBox）反推投影**，而不是先投影再猜画布。
 *
 * Rev 3 的问题出在顺序上：先写死地理范围再算画布，结果画布宽高比
 * （1060/766 ≈ 1.38）和地图面板的可用区（848/642 ≈ 1.32）对不上，
 * SVG 只能按较窄的一边等比缩放 —— 实测画布 594×429、中国 472×340，
 * 只占了实际可用空间的一角，看上去就是「一张缩小的地图」。
 *
 * 现在的算法：
 *   1. 选定一个**固定的经纬窗口**（FRAME_LON）。
 *   2. 由面板实测宽高比（FRAME_ASPECT）推出窗口纬度跨度：
 *      纬度跨度 = 经度跨度 / 宽高比。这样外框的宽高比天然等于面板，
 *      SVG 不会被任何一边约束缩小。
 *   3. 邻国沿经度裁到窗口，所以陆地横向铺满整幅画布，不留空白。
 *
 * 为什么纬度跨度比中国本身高那么多？因为中国 bbox 的宽高比是 ~1.74，
 * 面板只有 ~1.30。要让中国横向占满，纵向必然多出两条 —— 这两条正好
 * 留给球面光环与经纬网，并把中国稳稳地放在正中。
 *
 * 剪影（silhouette）来自 DataV 的 100000 国界数据，而不是把 33 个省轮廓
 * 拼起来 —— 相邻省份的边界是各自独立简化的，顶点对不上，无法互相抵消
 * （实测 3331 条边只抵消掉 2 条）。
 *
 * 南沙群岛的框线（纬度 < 17.5）不进入画面，否则会把山东挤出视野。
 */
import fs from "node:fs";
import path from "node:path";
import { simplify } from "./simplify.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROVINCES_RAW = path.join(ROOT, "src/data/china-provinces-raw.json");
const COUNTRIES_RAW = path.join(ROOT, "src/data/ne-countries-raw.json");
const COUNTRY_RAW = path.join(ROOT, "src/data/china-raw.json");
const OUT = path.join(ROOT, "src/data/china-map.json");
const OUT_TS = path.join(ROOT, "src/data/china-map.ts");

/** 邻国清单（EN/ZH/远近层级）由 scripts/neighbors.mjs 共享，与行政线脚本保证同一批国家。 */
import { NEIGHBORS } from "./neighbors.mjs";

const SHORT_NAME = {
  北京市: "北京",
  天津市: "天津",
  河北省: "河北",
  山西省: "山西",
  内蒙古自治区: "内蒙古",
  辽宁省: "辽宁",
  吉林省: "吉林",
  黑龙江省: "黑龙江",
  上海市: "上海",
  江苏省: "江苏",
  浙江省: "浙江",
  安徽省: "安徽",
  福建省: "福建",
  江西省: "江西",
  山东省: "山东",
  河南省: "河南",
  湖北省: "湖北",
  湖南省: "湖南",
  广东省: "广东",
  广西壮族自治区: "广西",
  海南省: "海南",
  重庆市: "重庆",
  四川省: "四川",
  贵州省: "贵州",
  云南省: "云南",
  西藏自治区: "西藏",
  陕西省: "陕西",
  甘肃省: "甘肃",
  青海省: "青海",
  宁夏回族自治区: "宁夏",
  新疆维吾尔自治区: "新疆",
  台湾省: "台湾",
  香港特别行政区: "香港",
  澳门特别行政区: "澳门",
};

/* ------------------------------------------------------------------ *
 * 外框几何
 *
 * 三条约束互相拉扯，先说清楚取舍：
 *   · 等距圆柱投影下 x/y 用同一个 PITCH ⇒ 中国不会被拉伸（比例尺 1:1）
 *   · 画布宽高比必须等于面板可用区，否则 SVG 会被某一边约束缩小
 *   · 中国 bbox 宽高比 ~1.74，面板只有 ~1.30 ⇒ 横向占满时纵向必然有余量
 *
 * 所以经纬窗口的**宽高比**直接由面板决定：面板 880×866、SVG 内缩 6px
 * ⇒ 可用区 868×854（≈1.016），于是纬度跨度 = 86° / 1.016 ≈ 84.6°。
 * 横向用裁剪严格贴边（邻国铺满整幅画布，不留空白），纵向窗口比中国本身
 * 高一条，上下均分 —— 中国因此天然居中，上下两条留给球面光环与经纬网。
 * ------------------------------------------------------------------ */

const PITCH = 14;
/**
 * 外框宽高比。取 1.303 是个折中：
 *
 * SVG 用 `preserveAspectRatio="xMidYMid meet"` 等比缩放，面板可用区是
 * 868×854（比值 1.016）。外框比面板**宽**时由宽度定标，中国能取到最大
 * 尺寸，代价是上下各留一条 —— 比值 1.303 时上下各浪费 ~9%；
 * 若让外框贴合面板（1.016），纬度窗口会被拉到 ±42°，上下两条只剩空海，
 * 中国反而缩到画布高度的 42%。
 *
 * 这个数字和 ScreenStage 的地图列宽 / 行高是**绑死的**：改了列宽就必须
 * 回来改这里并重跑脚本。src/lib/layout.test.ts 会拿生成出来的宽高比
 * 去比对栅格算术，能拦住漏改。
 */
const FRAME_ASPECT = 1.303;
/** 经度窗口：西到里海、东到日本以东。横向贴着画布裁，所以这就是画布宽度。 */
const FRAME_LON = { min: 62, max: 148 };
/**
 * 纬度窗口中心。
 *
 * 取 33.5 而不是中国的几何中心（36.3）：南方邻国只到赤道附近就断了，
 * 北方却有整片西伯利亚，所以几何居中会让画面下半部空出一大块海。
 * 往下压 3° 之后，中国的视觉重心才落回画布中部。
 */
const LAT_CENTER = 30.5;

const frameLonSpan = FRAME_LON.max - FRAME_LON.min;
const frameLatSpan = frameLonSpan / FRAME_ASPECT;
const FRAME_LAT = { min: LAT_CENTER - frameLatSpan / 2, max: LAT_CENTER + frameLatSpan / 2 };

/** 经纬 → 画布坐标。 */
const project = (lon, lat) => [
  Number(((lon - FRAME_LON.min) * PITCH).toFixed(2)),
  Number(((FRAME_LAT.max - lat) * PITCH).toFixed(2)),
];

/** 邻国/剪影裁剪窗口：横向严格贴住画布（保证陆地铺满），纵向多留 padding。 */
const CLIP = {
  minLon: FRAME_LON.min,
  maxLon: FRAME_LON.max,
  minLat: FRAME_LAT.min - 10,
  maxLat: FRAME_LAT.max + 10,
};

/**
 * 沿经度裁剪一条环。
 *
 * 必须先裁后投影：俄罗斯的原始 MultiPolygon 从波罗的海一直铺到白令海峡，
 * 整块投进去能把画布撑大好几倍，中国会被压成中间一小块。
 * 窗口横向正好等于画布，所以裁剪边落在画布外沿，看不出「被切断」；
 * 纵向故意放宽，避免出现上下被切平的硬边。
 */
const ringClip = (ring) =>
  ring.filter(
    ([lon, lat]) =>
      lon >= CLIP.minLon && lon <= CLIP.maxLon && lat >= CLIP.minLat && lat <= CLIP.maxLat,
  );

/**
 * 简化强度（度）。R1 整改后大屏支持滚轮放大（最高 5×），阈值按
 * 「放大 3× 后省界/海岸不明显发直」收紧；生成体积仍远低于 140KB 上限。
 */
const PROVINCE_EPS = 0.055;
const NEIGHBOR_EPS = 0.165;
const SILHOUETTE_EPS = 0.065;

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area / 2);
}

function ringCentroid(ring) {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    twiceArea += cross;
    cx += (ring[i][0] + ring[i + 1][0]) * cross;
    cy += (ring[i][1] + ring[i + 1][1]) * cross;
  }
  if (!twiceArea) return ring[0];
  return [cx / (3 * twiceArea), cy / (3 * twiceArea)];
}

function polygonsOf(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function ringMaxLat(ring) {
  return Math.max(...ring.map((point) => point[1]));
}

function simplifyPolygon(polygon, epsilon, minArea) {
  const rings = [];
  polygon.forEach((ring, index) => {
    const area = ringArea(ring);
    if (area < (index === 0 ? minArea : minArea * 0.35)) return;
    // 南沙群岛那一堆框线（最北 < 17.6°）整块丢掉，否则会把画布拉长
    if (ringMaxLat(ring) < 17.6) return;
    const next = simplify(ring, epsilon);
    if (next.length >= 4) rings.push(next);
  });
  return rings.length ? rings : null;
}

/** 一个 Polygon 的环数组。GeoJSON 环的点是 [lon, lat]。 */
function ringsToPath(rings) {
  return rings
    .map(
      (ring) =>
        ring
          .map(([lon, lat], index) => {
            const [x, y] = project(lon, lat);
            return `${index === 0 ? "M" : "L"}${x} ${y}`;
          })
          .join(" ") + " Z",
    )
    .join(" ");
}

/** 经纬折线 → path（不闭合）。用于球面网格，输入是 [lon, lat]。 */
function lineToPath(points) {
  if (points.length < 2) return "";
  return points
    .map(([lon, lat], index) => {
      const [x, y] = project(lon, lat);
      return `${index === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
}

/* ------------------------------------------------------------------ *
 * 省界
 * ------------------------------------------------------------------ */

const provincesGeo = JSON.parse(fs.readFileSync(PROVINCES_RAW, "utf8"));
const countriesGeo = JSON.parse(fs.readFileSync(COUNTRIES_RAW, "utf8"));
const countryGeo = JSON.parse(fs.readFileSync(COUNTRY_RAW, "utf8"));

const provinces = [];
for (const feature of provincesGeo.features) {
  const name = feature.properties.name;
  if (!name || feature.properties.adcode === "100000_JD") continue;
  // 每个 Polygon 贡献 0..n 条环，全部平铺进一个数组 ——
  // ringsToPath 要的是「环数组」，多套一层就会退化成 MNaN NaN Z。
  const rings = [];
  for (const polygon of polygonsOf(feature.geometry)) {
    const inner = simplifyPolygon(polygon, PROVINCE_EPS, 0.02);
    if (inner) rings.push(...inner);
  }
  if (!rings.length) continue;
  const largest = [...rings].sort((a, b) => ringArea(b) - ringArea(a))[0];
  const [lon, lat] = ringCentroid(largest);
  const [x, y] = project(lon, lat);
  provinces.push({
    name,
    short: SHORT_NAME[name] || name.replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔)/g, ""),
    adcode: String(feature.properties.adcode),
    label: !["香港", "澳门"].includes(SHORT_NAME[name]),
    d: ringsToPath(rings),
    x: Number(x.toFixed(1)),
    y: Number(y.toFixed(1)),
  });
}

/* ------------------------------------------------------------------ *
 * 邻国
 * ------------------------------------------------------------------ */

const neighbors = [];
for (const [en, zh, order] of NEIGHBORS) {
  const feature = countriesGeo.features.find((item) => item.properties.NAME === en);
  if (!feature) continue;
  const rings = [];
  for (const polygon of polygonsOf(feature.geometry)) {
    const outer = polygon[0];
    // 南沙那类小岛块整块丢掉
    if (ringMaxLat(outer) < 17.6) continue;
    if (ringArea(outer) < 0.04) continue;
    // 横向裁到画布窗口：不裁的话俄罗斯能从波罗的海铺到白令海峡
    const clipped = ringClip(outer);
    if (clipped.length < 6) continue;
    const next = simplify(clipped, NEIGHBOR_EPS);
    if (next.length >= 4) rings.push(next);
  }
  if (!rings.length) continue;
  const largest = [...rings].sort((a, b) => ringArea(b) - ringArea(a))[0];
  const [lon, lat] = ringCentroid(largest);
  const [x, y] = project(lon, lat);
  // 标签位置超出画布就不输出坐标，渲染端只画形状
  const inCanvas = x > 40 && x < frameLonSpan * PITCH - 40 && y > 34 && y < frameLatSpan * PITCH - 34;
  neighbors.push({
    name: zh,
    order,
    d: ringsToPath(rings),
    ...(inCanvas ? { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) } : {}),
  });
}

/* ------------------------------------------------------------------ *
 * 国界剪影（描发光边用）
 * ------------------------------------------------------------------ */

const silhouette = [];
for (const polygon of polygonsOf(countryGeo.features[0].geometry)) {
  const outer = polygon[0];
  // 南沙群岛的框线（最北 < 17.5°）会把画布拉长，整块丢掉
  if (ringMaxLat(outer) < 17.5) continue;
  const next = simplify(ringClip(outer), SILHOUETTE_EPS);
  if (next.length < 4) continue;
  if (ringArea(next) < 0.012) continue;
  silhouette.push({ d: ringsToPath([next]), area: Number(ringArea(next).toFixed(4)) });
}
silhouette.sort((a, b) => b.area - a.area);

/* ------------------------------------------------------------------ *
 * 工厂锚点
 * ------------------------------------------------------------------ */

const factory = { lon: 117.1656, lat: 35.0886, name: "大川机床滕州工厂" };
const [fx, fy] = project(factory.lon, factory.lat);

/* ------------------------------------------------------------------ *
 * 球面网格
 *
 * 留在地理坐标系里生成，再由统一投影落图，所以弧线一定与中国轮廓
 * 严格对齐，不会出现「网格和地图对不上」。
 * 采样范围比画布外扩很多，弧线就能自然延伸到画面边缘而不是断在半空。
 * ------------------------------------------------------------------ */

const GRID_LON = { min: 24, max: 192 };
const GRID_LAT = { min: 0, max: 70 };

const meridians = [];
for (let lon = GRID_LON.min; lon <= GRID_LON.max; lon += 10) {
  const points = [];
  for (let lat = GRID_LAT.min; lat <= GRID_LAT.max; lat += 3) points.push([lon, lat]);
  const d = lineToPath(points);
  if (d) meridians.push({ lon, d, emphasis: lon === 110 });
}

const parallels = [];
for (let lat = GRID_LAT.min; lat <= GRID_LAT.max; lat += 10) {
  const points = [];
  for (let lon = GRID_LON.min; lon <= GRID_LON.max; lon += 4) points.push([lon, lat]);
  const d = lineToPath(points);
  if (d) parallels.push({ lat, d, emphasis: lat === 30 || lat === 40 });
}

const width = Math.round(frameLonSpan * PITCH);
const height = Math.round(frameLatSpan * PITCH);

/** 中国本土在画布上的包围盒 —— 渲染端用它定位光环与球面明暗。 */
const chinaBounds = (() => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const province of provinces) {
    const nums = [...province.d.matchAll(/(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    for (let i = 0; i + 1 < nums.length; i += 2) {
      if (nums[i] < minX) minX = nums[i];
      if (nums[i + 1] < minY) minY = nums[i + 1];
      if (nums[i] > maxX) maxX = nums[i];
      if (nums[i + 1] > maxY) maxY = nums[i + 1];
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
})();

const out = {
  viewBox: `0 0 ${width} ${height}`,
  width,
  height,
  lonLat: { lon: FRAME_LON, lat: FRAME_LAT },
  pitch: PITCH,
  china: {
    minX: Number(chinaBounds.minX.toFixed(1)),
    minY: Number(chinaBounds.minY.toFixed(1)),
    maxX: Number(chinaBounds.maxX.toFixed(1)),
    maxY: Number(chinaBounds.maxY.toFixed(1)),
  },
  factory: { ...factory, x: fx, y: fy },
  provinces,
  neighbors,
  silhouette,
  graticule: { meridians, parallels },
};

fs.writeFileSync(OUT, JSON.stringify(out));
fs.writeFileSync(OUT_TS, `export const chinaMapData = ${JSON.stringify(out)};\n`);
console.log({
  out: path.relative(ROOT, OUT),
  ts: path.relative(ROOT, OUT_TS),
  bytes: fs.statSync(OUT).size,
  viewBox: out.viewBox,
  aspect: Number((width / height).toFixed(3)),
  lonLat: {
    lon: [FRAME_LON.min, FRAME_LON.max],
    lat: [Number(FRAME_LAT.min.toFixed(2)), Number(FRAME_LAT.max.toFixed(2))],
  },
  chinaFill: {
    x: Number((chinaBounds.width / width).toFixed(3)),
    y: Number((chinaBounds.height / height).toFixed(3)),
  },
  provinces: provinces.length,
  neighbors: neighbors.length,
  neighborsWithLabel: neighbors.filter((item) => item.x !== undefined).length,
  silhouetteRings: silhouette.length,
  meridians: meridians.length,
  parallels: parallels.length,
  factory: out.factory,
});
