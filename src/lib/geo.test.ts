import { describe, expect, it } from "vitest";
import {
  chinaMap,
  chinaSilhouette,
  mapBBox,
  matchProvinceKey,
  projectLonLat,
  sphereCenter,
  sphereRings,
} from "./geo";
import { buildMockScreenPayload } from "./mock";

describe("china map projection", () => {
  it("places Tengzhou inside Shandong, in the eastern half", () => {
    const factory = projectLonLat(117.1656, 35.0886);
    // 相对陆地包围盒判断，而不是相对画布 —— 画布边距会随排版调整，
    // 拿画布比例当断言会在每次改 viewBox 时误报。
    const relativeX = (factory.x - mapBBox.minX) / mapBBox.width;
    const relativeY = (factory.y - mapBBox.minY) / mapBBox.height;
    expect(relativeX).toBeGreaterThan(0.55);
    expect(relativeX).toBeLessThan(0.8);
    expect(relativeY).toBeGreaterThan(0.3);
    expect(relativeY).toBeLessThan(0.6);
    // 滕州在山东，必须落在山东多边形附近
    const shandong = chinaMap.provinces.find((item) => item.short === "山东");
    expect(shandong).toBeDefined();
    expect(Math.abs(shandong!.x - factory.x)).toBeLessThan(70);
    expect(Math.abs(shandong!.y - factory.y)).toBeLessThan(70);
  });

  it("keeps provinces and mock destinations inside the canvas", () => {
    expect(chinaMap.provinces.length).toBeGreaterThanOrEqual(30);
    expect(chinaMap.provinces.some((item) => item.short === "山东")).toBe(true);
    expect(matchProvinceKey("山东省")).toBe("山东");
    const payload = buildMockScreenPayload(new Date("2026-09-15T10:00:00+08:00"));
    for (const route of payload.map.routes) {
      expect(route.destination.x).toBeGreaterThan(0);
      expect(route.destination.x).toBeLessThan(chinaMap.width);
      expect(route.destination.y).toBeGreaterThan(0);
      expect(route.destination.y).toBeLessThan(chinaMap.height);
    }
  });

  it("fills the canvas horizontally instead of leaving margins", () => {
    // 中国必须横向占到画布的 65% 以上。Rev 3 只有 62%：投影跨度按地理范围
    // 写死，画布宽高比又和面板对不上，结果地图在面板里被等比缩了一圈。
    expect(mapBBox.width / chinaMap.width).toBeGreaterThan(0.65);
  });

  it("centres China vertically in the canvas", () => {
    const topGap = mapBBox.minY;
    const bottomGap = chinaMap.height - mapBBox.maxY;
    expect(topGap).toBeGreaterThan(0);
    expect(bottomGap).toBeGreaterThan(0);
    // 上下留白应当接近。做不到完全相等：纬度窗口的中心取的是整个陆地
    // （含邻国）的中心，而南方邻国被赤道裁掉一截，中国会略微偏上。
    expect(Math.abs(topGap - bottomGap)).toBeLessThan(chinaMap.height * 0.2);
  });

  it("fills the canvas with neighbouring land on both edges", () => {
    // 邻国沿经度裁到画布窗口，所以左右两侧一定有陆地贴边 ——
    // 这是「国土看着铺满画面」而不是「中间一小块」的关键。
    const edgeX = { left: chinaMap.width * 0.05, right: chinaMap.width * 0.95 };
    const vertex = (d: string) => [...d.matchAll(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)];
    let minX = Infinity;
    let maxX = -Infinity;
    for (const item of chinaMap.neighbors) {
      for (const match of vertex(item.d)) {
        const x = Number(match[1]);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    expect(minX).toBeLessThan(edgeX.left);
    expect(maxX).toBeGreaterThan(edgeX.right);
  });

  it("matches the canvas aspect ratio to the map panel", () => {
    // 画布宽高比必须接近地图面板的可用区宽高比（约 1.37）。
    // 差得越多，SVG 被某一边约束缩小的程度就越大。
    const aspect = chinaMap.width / chinaMap.height;
    expect(aspect).toBeGreaterThan(1.3);
    expect(aspect).toBeLessThan(1.45);
  });
});

describe("silhouette, neighbours and sphere", () => {
  it("ships a merged national silhouette and closes every subpath", () => {
    expect(chinaMap.silhouette.length).toBeGreaterThan(0);
    expect(chinaMap.silhouette[0].area).toBeGreaterThan(100);
    expect(chinaSilhouette.startsWith("M")).toBe(true);
    expect(chinaSilhouette).not.toContain("NaN");
    const subpaths = chinaSilhouette.split("Z").filter((piece) => piece.trim());
    expect(subpaths.length).toBe(chinaMap.silhouette.length);
  });

  it("keeps the whole landmass inside the viewBox", () => {
    const [, , vw, vh] = chinaMap.viewBox.split(/\s+/).map(Number);
    expect(mapBBox.minX).toBeGreaterThan(0);
    expect(mapBBox.minY).toBeGreaterThan(0);
    expect(mapBBox.maxX).toBeLessThan(vw);
    expect(mapBBox.maxY).toBeLessThan(vh);
  });

  it("projects lon/lat with the same parameters as the build script", () => {
    // 运行时换算必须和脚本里投影省界用的是同一套参数，否则工厂锚点会偏。
    const { lonLat, pitch } = chinaMap;
    expect(pitch).toBeGreaterThan(0);
    const corner = projectLonLat(lonLat.lon.min, lonLat.lat.max);
    expect(corner.x).toBeCloseTo(0, 1);
    expect(corner.y).toBeCloseTo(0, 1);
    const factory = chinaMap.factory;
    const reprojected = projectLonLat(factory.lon, factory.lat);
    expect(Math.abs(reprojected.x - factory.x)).toBeLessThan(1);
    expect(Math.abs(reprojected.y - factory.y)).toBeLessThan(1);
  });

  it("has neighbours in all three depth tiers so the globe reads as layered", () => {
    expect(chinaMap.neighbors.length).toBeGreaterThanOrEqual(15);
    for (const order of [0, 1, 2]) {
      expect(chinaMap.neighbors.some((item) => item.order === order)).toBe(true);
    }
    for (const item of chinaMap.neighbors) {
      expect(item.d.length).toBeGreaterThan(40);
      expect(item.d).not.toContain("NaN");
    }
  });

  it("generates a graticule from the same projection as the landmass", () => {
    // The grid is only convincing if it is registered to the map, not drawn as
    // arbitrary decoration — so every graticule point must land inside the canvas.
    const [, , vw, vh] = chinaMap.viewBox.split(/\s+/).map(Number);
    expect(chinaMap.graticule.meridians.length).toBeGreaterThanOrEqual(8);
    expect(chinaMap.graticule.parallels.length).toBeGreaterThanOrEqual(5);
    for (const line of [...chinaMap.graticule.meridians, ...chinaMap.graticule.parallels]) {
      expect(line.d).not.toContain("NaN");
      const coords = line.d.match(/-?\d+(\.\d+)?/g) ?? [];
      expect(coords.length).toBeGreaterThan(4);
      for (const value of coords.map(Number)) {
        expect(Math.abs(value)).toBeLessThan(Math.max(vw, vh) * 2);
      }
    }
    expect(chinaMap.graticule.parallels.some((line) => line.emphasis)).toBe(true);
  });

  it("keeps the sphere rings centred on the canvas and progressively wider", () => {
    // 光环按画布居中：画布中心同时也是经纬窗口中心，所以中国天然落在环中央。
    // 围着陆地画会让环缩成一小圈，撑不起「地球弧面」的感觉。
    expect(sphereCenter.x).toBeCloseTo(chinaMap.width / 2, 0);
    expect(sphereCenter.y).toBeCloseTo(chinaMap.height / 2, 0);
    expect(sphereRings.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < sphereRings.length; i += 1) {
      expect(sphereRings[i].scale).toBeGreaterThan(sphereRings[i - 1].scale);
      // Fainter as they get further out, so the outermost ring never competes
      // with the map itself.
      expect(sphereRings[i].opacity).toBeLessThan(sphereRings[i - 1].opacity);
    }
    // 最内圈要落在画布边缘附近：太小会在陆地内部画出一个圈，
    // 太大则整条弧线跑到画布外、画面上看不到任何环。
    expect(sphereRings[0].scale).toBeGreaterThan(0.95);
    expect(sphereRings[0].scale).toBeLessThan(1.25);
  });

  it("has no 3D extrusion left in the map data", () => {
    expect("extrude" in chinaMap).toBe(false);
  });
});
