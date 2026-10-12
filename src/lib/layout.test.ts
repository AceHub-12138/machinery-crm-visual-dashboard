import { readFileSync } from "node:fs";
import path from "node:path";
import { screenMapBounds } from "./geo";
import { describe, expect, it } from "vitest";

/**
 * 版面几何回归测试。
 *
 * 这套大屏最容易出的问题是「面板内容比格子高，被 overflow-hidden 悄悄裁掉」——
 * 第一版就把「缺口」那张卡裁掉了 96px，肉眼几乎看不出来。
 * 这里直接读 ScreenStage 的栅格定义，用算术验证每一行/列都装得下，
 * 免得下次改内容时又踩同一个坑。
 *
 * 注意：这是**静态**守卫，验证的是栅格算术自洽；各面板内容的真实高度还是要靠
 * 浏览器实测（.review/blocks.mjs）。两者的关系见 docs/screen-design-spec.md。
 */

const STAGE_W = 1920;
const STAGE_H = 1080;
const HEADER_H = 88;
const PAD = 14; // --gutter，也是行区的 padding

const source = readFileSync(
  path.resolve(import.meta.dirname, "../components/screen/ScreenStage.tsx"),
  "utf8",
);

/**
 * 地图画布尺寸直接读生成出来的数据，而不是抄常数 ——
 * 否则改了 FRAME_* 却忘了同步面板列宽时，测试会继续绿。
 */
const MAP = (() => {
  return JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "../data/china-map.json"), "utf8"),
  ) as {
    width: number;
    height: number;
    china: { minX: number; minY: number; maxX: number; maxY: number };
  };
})();

/**
 * globals.css 里 `.map-svg` 的视口几何。
 *
 * 地图在面板里居中靠的就是这几个数（含上移量），所以必须一起守卫 ——
 * 它们由「画布宽高比 + 地图格尺寸」推出，改任何一边都会让中国重新偏心。
 */
const MAP_SVG = (() => {
  const css = readFileSync(path.resolve(import.meta.dirname, "../app/globals.css"), "utf8");
  const block = css.match(/\.map-svg\s*\{([^}]*)\}/);
  if (!block) throw new Error(".map-svg rule not found in globals.css");
  const pick = (name: string) => {
    // String.raw: 正则里的 \s \d 必须原样进 RegExp，用普通模板串会被当成转义
    const m = block[1].match(new RegExp(String.raw`${name}:\s*(-?[\d.]+)px`));
    if (!m) throw new Error(`${name} not found in .map-svg`);
    return Number(m[1]);
  };
  return { insetX: pick("left"), top: pick("top"), width: pick("width"), height: pick("height") };
})();

/**
 * 只认**外层**舞台栅格。
 *
 * 右列内部还有一个 `grid-rows-2` 的嵌套栅格，所以不能简单地
 * 搜第一个 `grid-rows-[…]`。这里锚定到舞台那一行：
 * `min-h-0 flex-1 grid-cols-[…] grid-rows-[…]`。
 */
function readTrackList(name: "grid-cols" | "grid-rows"): string[] {
  // 只取「同时带 flex-1」的那一组 —— 外层舞台栅格有，右列内层没有。
  const stageLine = source
    .split("\n")
    .find((line) => line.includes("className=\"grid") && line.includes("flex-1"));
  if (!stageLine) throw new Error("stage grid element not found in ScreenStage.tsx");
  const match = stageLine.match(new RegExp(`${name}-\\[([^\\]]+)\\]`));
  if (!match) throw new Error(`${name} not found on the stage grid`);
  return match[1].split("_");
}

/** 把 `minmax(0,1fr)` / `360px` / `200px` 解析成 px（1fr 需要由调用方给定）。 */
function trackPx(track: string, fr: number): number {
  const px = track.match(/^(\d+)px$/);
  if (px) return Number(px[1]);
  if (track.startsWith("minmax(")) return fr;
  throw new Error(`unparsed track: ${track}`);
}

describe("screen grid geometry", () => {
  const cols = readTrackList("grid-cols");
  const rows = readTrackList("grid-rows");

  it("has one flexible track per axis", () => {
    expect(cols.filter((c) => c.startsWith("minmax(")).length).toBe(1);
    expect(rows.filter((r) => r.startsWith("minmax(")).length).toBe(1);
  });

  it("fills the stage exactly — no horizontal or vertical overflow", () => {
    const gapsX = (cols.length - 1) * PAD;
    const fixedX = cols
      .filter((c) => !c.startsWith("minmax("))
      .reduce((sum, c) => sum + trackPx(c, 0), 0);
    const flexibleX = STAGE_W - PAD * 2 - gapsX - fixedX;
    expect(flexibleX).toBeGreaterThan(0);

    // 行区 = 舞台高 - 页头，再减掉上下 padding 与行间隙
    const gapsY = (rows.length - 1) * PAD;
    const fixedY = rows
      .filter((r) => !r.startsWith("minmax("))
      .reduce((sum, r) => sum + trackPx(r, 0), 0);
    const flexibleY = STAGE_H - HEADER_H - PAD * 2 - gapsY - fixedY;
    expect(flexibleY).toBeGreaterThan(0);

    const totalW = fixedX + flexibleX + gapsX + PAD * 2;
    const totalH = HEADER_H + fixedY + flexibleY + gapsY + PAD * 2;
    expect(totalW).toBe(STAGE_W);
    expect(totalH).toBe(STAGE_H);
  });

  it("gives the map column enough width that China renders large", () => {
    const mapTrack = cols[1];
    expect(mapTrack).toMatch(/^\d+px$/);
    const mapWidth = Number(mapTrack.replace("px", ""));
    const gapsY = (rows.length - 1) * PAD;
    const fixedY = rows
      .filter((r) => !r.startsWith("minmax("))
      .reduce((sum, r) => sum + trackPx(r, 0), 0);
    // 行高预算：行区 = 1080-88 = 992，扣掉栅格自身的上下 padding（28）
    // 与行间隙（14），剩下的 950 分给弹性行与固定底条 ⇒ 弹性行 838。
    // 底条从 84 提到 112（+28），所以这里比上一版少 28。用 CDP 实测过。
    const mapHeight = STAGE_H - HEADER_H - PAD * 2 - gapsY - fixedY;
    expect(mapHeight).toBe(838);

    // 地图 SVG 的视口比面板高（见 globals.css 的 .map-svg），仍由宽度定标。
    const scale = MAP_SVG.width / screenMapBounds.width;

    // 中国在屏幕上至少要占到 560px 宽。
    // Rev 3 实测只有 472px —— 画布宽高比和面板差了 26%，被缩掉一整圈。
    const chinaScreenW = (MAP.china.maxX - MAP.china.minX) * scale;
    expect(chinaScreenW).toBeGreaterThan(560);
    expect(chinaScreenW / mapWidth).toBeGreaterThanOrEqual(.75);
  });

  it("centers China inside the map panel instead of trusting the canvas centre", () => {
    // 画布的纬度窗口中心（30.5°N）不等于中国本土的纬度中心（36.3°N）——
    // 这是给球面光环留位置的代价。.map-svg 把视口放大并上移，正是为了
    // 让**中国**落在面板正中，而不是让画布中心落在面板正中。
    const mapWidth = Number(cols[1].replace("px", ""));
    const gapsY = (rows.length - 1) * PAD;
    const fixedY = rows
      .filter((r) => !r.startsWith("minmax("))
      .reduce((sum, r) => sum + trackPx(r, 0), 0);
    // 地图格的实际高度 = 弹性轨道(838) + 行区上下 padding(28) = 866。
    // ⚠️ 别直接用弹性轨道值 838 —— 那会把「面板中心」算到 419 去，
    // 于是这个测试会误报 13px 偏差（自己踩过一次）。
    const mapHeight = STAGE_H - HEADER_H - PAD * 2 - gapsY - fixedY - 2;

    // 视口宽高比必须**不宽于**画布，否则会变成由高度定标 ——
    // 那样中国会被缩小，且投影窗口的推导前提（按宽度定标）全部失效。
    expect(MAP_SVG.width / MAP_SVG.height).toBeLessThanOrEqual(screenMapBounds.width / screenMapBounds.height);
    // 视口左右内缩对称 ⇒ 水平方向不会偏。
    // 参照系是**面板内框**（880px 的格子减去左右各 1px 边框 = 878），
    // 所以内缩量应当是 (878-866)/2 = 6，而不是 (880-866)/2 = 7。
    expect(MAP_SVG.insetX).toBeCloseTo((mapWidth - 2 - MAP_SVG.width) / 2, 1);

    const scale = MAP_SVG.width / screenMapBounds.width;
    // 画布在视口里按 meet 垂直居中，所以画布中心的屏幕 y（面板坐标）=
    const canvasCentreInPanel =
      MAP_SVG.top + (MAP_SVG.height - MAP.height * scale) / 2 + (MAP.height / 2) * scale;
    // 中国本土中心相对画布中心的偏移（画布坐标 → 屏幕像素）
    const chinaOffsetFromCanvas = ((MAP.china.minY + MAP.china.maxY) / 2 - MAP.height / 2) * scale;
    const chinaCentreInPanel = canvasCentreInPanel + chinaOffsetFromCanvas;

    // 结论：中国本土中心与面板中心的偏差 ≤ 2px
    expect(Math.abs(chinaCentreInPanel - mapHeight / 2)).toBeLessThanOrEqual(2);

    // 反证：不加上移量时偏多少（防止有人把 top 改回「视口贴面板居中」）
    const naiveCentre = (mapHeight - MAP.height * scale) / 2 + (MAP.height / 2) * scale + chinaOffsetFromCanvas;
    expect(Math.abs(naiveCentre - mapHeight / 2)).toBeGreaterThan(20);
  });

  it("assigns every panel an explicit cell so auto-placement cannot push one off-stage", () => {
    // 自动排列曾把 row-span 的格子推到不存在的行，底条直接掉出画面。
    const explicit = source.match(/col-start-\d row-start-\d/g) ?? [];
    expect(explicit.length).toBeGreaterThanOrEqual(3);
    expect(source).not.toMatch(/className="row-span-\d[^"]*"/);
  });

  it("stacks the collection ring and the reminder rail in the same column", () => {
    // 需求：右侧一列 = 累计回款率 + 发货提醒，两块高度**按内容**分配，
    // 并且和左列、中列同高（三列都在 row-start-1，等高由栅格保证）。
    // 环要 441（环 240 + 目标行 + 两条进度条），提醒要 383（3 组 × 90）。
    const rightColumn = source.match(
      /col-start-3 row-start-1 grid min-h-0 grid-rows-\[(\d+)px_minmax\(0,1fr\)\]/,
    );
    expect(rightColumn).not.toBeNull();
    expect(source).toContain("<TargetRing");
    expect(source).toContain("<ReminderRail");

    // 两块之和 + 行间隙必须正好等于弹性行高，否则其中一块会被压/被裁
    const ringPanel = Number(rightColumn?.[1]);
    const gapsY = (rows.length - 1) * PAD;
    const fixedY = rows
      .filter((r) => !r.startsWith("minmax("))
      .reduce((sum, r) => sum + trackPx(r, 0), 0);
    const flexibleRow = STAGE_H - HEADER_H - PAD * 2 - gapsY - fixedY;
    expect(ringPanel).toBe(441);
    expect(flexibleRow - ringPanel - PAD).toBe(383);
  });

  it("keeps the milestone strip tall enough for its content", () => {
    const milestone = Number(rows[rows.length - 1].replace("px", ""));
    // 12→18px 字号标尺落地后实测：行盒 14(eyebrow) + 26(标题) + 18(统计)
    // + 2 个 4px 间距 + 4px 上下留白 ≈ 74，再加面板 1px 边框。
    // 84px 那一版只能塞下一行半，第三行会被压住，所以提到 112。
    expect(milestone).toBe(112);
  });

  it("has no third grid row left over from the old layout", () => {
    expect(rows.length).toBe(2);
  });
});
