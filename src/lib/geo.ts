import { chinaMapData } from "@/data/china-map";

export type MapProvince = {
  name: string;
  short: string;
  adcode: string;
  d: string;
  x: number;
  y: number;
  label: boolean;
};

export type MapNeighbor = {
  name: string;
  /** 视觉远近：0 接壤 / 1 近邻 / 2 外围。渲染时逐级变淡。 */
  order: number;
  d: string;
  x?: number;
  y?: number;
};

export type ChinaMap = {
  viewBox: string;
  width: number;
  height: number;
  /** 画布对应的经纬窗口，与构建脚本共用。 */
  lonLat: { lon: { min: number; max: number }; lat: { min: number; max: number } };
  /** 每经纬度多少画布单位。等距圆柱投影，x/y 同值。 */
  pitch: number;
  /** 中国本土在画布上的包围盒（不含邻国），用于定位光环与球面明暗。 */
  china: { minX: number; minY: number; maxX: number; maxY: number };
  factory: { lon: number; lat: number; name: string; x: number; y: number };
  provinces: MapProvince[];
  neighbors: MapNeighbor[];
  /** 合并后的国界轮廓，按面积从大到小；用于给中国整体描一条发光边。 */
  silhouette: Array<{ d: string; area: number }>;
  /** 球面经纬网，由构建脚本用同一套投影生成，因此与中国轮廓严格对齐。 */
  graticule: {
    meridians: Array<{ lon: number; d: string; emphasis: boolean }>;
    parallels: Array<{ lat: number; d: string; emphasis: boolean }>;
  };
};

export type MapPoint = { x: number; y: number; lng?: number; lat?: number };

export const chinaMap = chinaMapData as unknown as ChinaMap;
/** @deprecated use `chinaMap` */
export const chinaOutline = chinaMap;

/**
 * 经纬度 → 画布坐标。
 *
 * 与构建脚本里投影省界用的是**同一套参数**（同一个 pitch 与同一个经纬窗口），
 * 否则工厂锚点、城市标签会和省界错位。
 */
export function projectLonLat(lon: number, lat: number) {
  const { lonLat, pitch } = chinaMap;
  return {
    x: Number(((lon - lonLat.lon.min) * pitch).toFixed(2)),
    y: Number(((lonLat.lat.max - lat) * pitch).toFixed(2)),
    lng: lon,
    lat,
  };
}

export function createScreenArc(start: MapPoint, end: MapPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy) || 1;
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const bend = Math.min(Math.max(distance * 0.16, 18), 86);
  const cx = (start.x + end.x) / 2 + normalX * bend;
  const cy = (start.y + end.y) / 2 + normalY * bend;
  return {
    d: `M ${start.x} ${start.y} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${end.x} ${end.y}`,
    length: distance,
  };
}

export function matchProvinceKey(region: string) {
  return region.replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔)/g, "");
}

/* ------------------------------------------------------------------ *
 * 平面地图几何
 *
 * Rev 4：去掉立体挤出，中国是平涂 + 边缘发光描边，外围叠球面经纬网与
 * 同心光环来营造「地球弧面」的感觉。邻国由中国向外逐级变淡，
 * 形成一个有纵深的地球表面，而不是一块孤立的贴纸。
 *
 * 画布（viewBox）的宽高比与地图面板可用区一致，所以 SVG 不会被任何
 * 一边约束缩小 —— 这是 Rev 3「地图看着像被缩小了一圈」的根因。
 * ------------------------------------------------------------------ */

export const mapViewBox: string = chinaMap.viewBox;

export const mapAspect = chinaMap.width / chinaMap.height;

/** 中国本土的画布包围盒（不含邻国）。 */
export const mapBBox = {
  minX: chinaMap.china.minX,
  minY: chinaMap.china.minY,
  maxX: chinaMap.china.maxX,
  maxY: chinaMap.china.maxY,
  width: chinaMap.china.maxX - chinaMap.china.minX,
  height: chinaMap.china.maxY - chinaMap.china.minY,
};

/** 海岸线 + 陆地边界 —— 描发光边用的路径。 */
export const chinaSilhouette: string = chinaMap.silhouette.map((part) => part.d).join(" ");

/**
 * 球面网格与光环的圆心。
 *
 * 取画布中心而不是陆地包围盒中心：光环要铺满整个画布才算「地球弧面」，
 * 围着陆地画只会缩成一小圈。画布中心同时也是经纬窗口的中心，
 * 所以中国天然落在光环中央。
 */
export const sphereCenter = { x: chinaMap.width / 2, y: chinaMap.height / 2 };

/**
 * 同心光环：**椭圆**而不是圆。
 *
 * 画布宽高比 1.37，用正圆的话上下两条弧线会跑到画布外，只剩左右两段，
 * 看着像被裁过的圆。按画布宽高分别给 rx / ry，环就永远贴着画布轮廓。
 */
export const sphereRings: Array<{
  scale: number;
  opacity: number;
  dash?: string;
  width: number;
  glow?: boolean;
}> = [
  { scale: 1.06, opacity: 0.5, width: 1.6, glow: true },
  { scale: 1.26, opacity: 0.32, width: 1.3, dash: "12 16" },
  { scale: 1.5, opacity: 0.2, width: 1.1 },
  { scale: 1.78, opacity: 0.12, width: 1, dash: "7 20" },
  { scale: 2.1, opacity: 0.07, width: 1 },
];
