"use client";

import { formatCount } from "@/lib/format";

import { useMemo, useState } from "react";
import {
  chinaMap,
  chinaSilhouette,
  createScreenArc,
  screenMapViewBox,
  screenMapBounds,
  matchProvinceKey,
  sphereCenter,
  sphereRings,
} from "@/lib/geo";
import type { PublicScreenPayload, PublicRoute } from "@/lib/public-screen-payload";

/* 高度色阶：0 发货 → 最高发货。用于省级填充。 */
const HEAT_SCALE = [
  "var(--heat-0)",
  "var(--heat-1)",
  "var(--heat-2)",
  "var(--heat-3)",
  "var(--heat-4)",
  "var(--heat-5)",
] as const;

/** 邻国按视觉远近取色，越远越暗，形成球面纵深。 */
const NEIGHBOR_FILL = ["var(--c-neighbor-0)", "var(--c-neighbor-1)", "var(--c-neighbor-2)"] as const;
const NEIGHBOR_LABEL_FILL = [
  "rgba(206, 222, 242, 0.78)",
  "rgba(186, 206, 230, 0.6)",
  "rgba(166, 188, 214, 0.42)",
] as const;

/**
 * 标签字号（画布单位）。
 *
 * 画布是 1204×879，渲染到 868×634 面板上约 ×0.72 —— 所以这里的数字
 * 要除以 0.72 才是屏幕像素。省名 19 → 屏幕 13.7px，城市 22 → 15.8px。
 * 大屏视距 4m 以上，再小就读不清了，所以宁可少放几个标签。
 */
const LABEL_SIZES = { province: 28, city: 30, neighbor: 26 } as const;

type Placed = {
  id: string;
  text: string;
  x: number;
  y: number;
  size: number;
  cls: string;
  fill: string;
  anchor: "start" | "middle" | "end";
};

/** 8 方向候选，按优先级排列：右 → 左 → 上 → 下 → 四角。 */
const OFFSETS: Array<[number, number, Placed["anchor"]]> = [
  [1, 0, "start"],
  [-1, 0, "end"],
  [0, -1, "middle"],
  [0, 1, "middle"],
  [0.8, -1, "start"],
  [-0.8, -1, "end"],
  [0.8, 1, "start"],
  [-0.8, 1, "end"],
];

/**
 * 文本框高度必须按「行高」而不是「字号」估：
 * 汉字实际墨迹高度接近 fontSize，再加留白，包围盒用 0.88 + 0.32 才安全。
 * 用字号估会低估近 30%，京/津、皖/苏这种紧邻的省名就会叠在一起。
 */
const BOX_ASCENT = 0.88;
const BOX_DESCENT = 0.32;

function estimateWidth(text: string, size: number, anchor: Placed["anchor"]) {
  const width = text.length * size;
  if (anchor === "middle") return { left: -width / 2, right: width / 2 };
  if (anchor === "end") return { left: -width, right: 0 };
  return { left: 0, right: width };
}

/**
 * 标签防重叠：城市 > 省名 > 邻国，先到先占位。
 * 每个标签试 8 个方向，取第一个不冲突的位置；都放不下就丢弃，
 * 所以地图上永远不会出现两段文字叠在一起。
 */
function placeLabels(
  tiers: Array<{
    items: Array<{ id: string; text: string; x: number; y: number; fill: string; cls: string; size: number }>;
  }>,
): Placed[] {
  const placed: Placed[] = [];
  const boxes: Array<{ l: number; r: number; t: number; b: number }> = [];

  for (const tier of tiers) {
    for (const item of tier.items) {
      const { id, text, x: ax, y: ay, size, cls, fill } = item;
      const gap = size * 0.16;
      for (const [dx, dy, anchor] of OFFSETS) {
        // 纵向步进按行高（约 1.2×size）算，避免上下两个标签只错开半行
        const x = ax + dx * size;
        const y = ay + dy * (size * 1.05);
        const { left, right } = estimateWidth(text, size, anchor);
        const box = {
          l: x + left - gap,
          r: x + right + gap,
          t: y - size * BOX_ASCENT - gap,
          b: y + size * BOX_DESCENT + gap,
        };
        const hit = boxes.some(
          (other) => box.l < other.r && box.r > other.l && box.t < other.b && box.b > other.t,
        );
        if (hit) continue;
        boxes.push(box);
        placed.push({ id, text, x, y, size, cls, fill, anchor });
        break;
      }
    }
  }
  return placed;
}

function heatIndex(count: number, max: number) {
  if (count <= 0) return 0;
  return (
    1 +
    Math.min(
      HEAT_SCALE.length - 2,
      Math.floor((count / Math.max(max, 1)) * (HEAT_SCALE.length - 1.001)),
    )
  );
}

export function ShipmentMap({ payload }: { payload: PublicScreenPayload }) {
  const provinces = chinaMap.provinces;
  const neighbors = chinaMap.neighbors;
  const factory = payload.map?.factory ?? chinaMap.factory;
  const routes = useMemo(() => payload.map?.routes ?? [], [payload]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = routes.find((route) => route.id === activeId) ?? routes[0];

  const heat = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of (payload.business?.delivery.regionUnits ?? [])) {
      counts.set(matchProvinceKey(row.province), row.unitCount);
    }
    return { counts, max: Math.max(1, ...counts.values()) };
  }, [payload.business]);

  const arcs = useMemo(
    () =>
      routes.map((route: PublicRoute, index: number) => ({
        route,
        ...createScreenArc(route.origin, route.destination),
        // 错峰 0.06s：整屏读起来是一条呼吸节奏，而不是 12 条各自乱跑
        delay: `${(index * 0.06).toFixed(2)}s`,
        color: route.status === "PARTIAL_SHIPPED" ? "var(--c-pending)" : "var(--c-collect)",
        duration: `${(2.6 + (index % 5) * 0.18).toFixed(2)}s`,
      })),
    [routes],
  );

  const labels = useMemo(() => {
    const cities = Array.from(new Map(routes.map((route) => [route.city, route])).values()).map(
      (route) => ({
        id: `city-${route.city}`,
        text: route.city,
        x: route.destination.x,
        y: route.destination.y,
        size: LABEL_SIZES.city,
        cls: "map-label-city",
        fill: "#f6fbff",
      }),
    );

    // 先放有数据的省，再放其余；同级内从西到东 —— 西部省份稀疏，
    // 先占位可以给东部密集区（京津冀、江浙沪）留出更多余量。
    const provinceItems = provinces
      .filter((province) => province.label)
      .map((province) => ({
        province,
        count: heat.counts.get(matchProvinceKey(province.name)) || 0,
      }))
      .sort(
        (a, b) =>
          Number(b.count > 0) - Number(a.count > 0) ||
          a.province.x - b.province.x ||
          a.province.y - b.province.y,
      )
      .map(({ province, count }) => ({
        id: `prov-${province.adcode}`,
        text: province.short,
        x: province.x,
        y: province.y,
        size: LABEL_SIZES.province,
        cls: "map-label",
        fill: count > 0 ? "#ffe6cc" : "#a9b6c8",
      }));

    const neighborItems = neighbors
      .filter((item) => item.x !== undefined && item.y !== undefined)
      .map((item) => ({
        id: `nb-${item.name}`,
        text: item.name,
        x: item.x as number,
        y: item.y as number,
        size: LABEL_SIZES.neighbor,
        cls: "map-label-neighbor",
        fill: NEIGHBOR_LABEL_FILL[Math.min(2, item.order)],
      }));

    return placeLabels([{ items: cities }, { items: provinceItems }, { items: neighborItems }]).map(label=>{
      if(!["上海","宁波","日本"].includes(label.text))return label;
      const width=label.text.length*label.size;
      const left=label.x+(label.anchor === "end" ? -width : label.anchor === "middle" ? -width/2 : 0);
      const delta=Math.max(screenMapBounds.x+8-left,Math.min(0,screenMapBounds.x+screenMapBounds.width-8-left-width));
      return {...label,x:label.x+delta};
    }).filter(label=>{
      const width=label.text.length*label.size;
      const left=label.x+(label.anchor === "end" ? -width : label.anchor === "middle" ? -width/2 : 0);
      return left>=screenMapBounds.x+8 && left+width<=screenMapBounds.x+screenMapBounds.width-8 && label.y-label.size>=screenMapBounds.y && label.y+label.size*.35<=screenMapBounds.y+screenMapBounds.height;
    });
  }, [heat, neighbors, provinces, routes]);

  const coveredProvinces = payload.map.coverageProvinces.length;

  /** 省级排行：按 region 归并。用来填满地图两侧的空白，同时给出量级对比。 */
  const provinceRanking = useMemo(() => (payload.business?.delivery.regionUnits ?? []).map(row => ({ name: matchProvinceKey(row.province) || row.province, count: row.unitCount })).sort((a, b) => b.count - a.count), [payload.business]);

  const shippedCount = routes.filter((route) => route.status === "SHIPPED").length;
  const pendingCount = routes.length - shippedCount;
  const maxRank = provinceRanking[0]?.count ?? 1;

  return (
    <div className="relative h-full overflow-hidden">
      <div className="map-titlebar pointer-events-none absolute top-0 right-0 left-0 z-10 flex items-center justify-between px-5 py-4">
        <div>
          <p className="panel-eyebrow">NATIONAL DELIVERY NETWORK · 部分发运地点</p>
          <h2 className="mt-1.5 text-label leading-none font-bold tracking-[0.08em] text-[var(--ink)]">
            全国交付态势
          </h2>
        </div>
        <div className="flex items-center gap-7 text-right">
          <div>
            <p className="text-micro leading-none text-[var(--ink-3)]">累计发运</p>
            <p className="num mt-1.5 text-label leading-none text-[var(--ink)]">{payload.business ? formatCount(payload.business.delivery.summary.shipmentCount) : "—"}</p>
          </div>
          <div>
            <p className="text-micro leading-none text-[var(--ink-3)]">覆盖省份</p>
            <p className="num mt-1.5 text-label leading-none text-[var(--c-collect)]">{payload.business ? formatCount(payload.business.delivery.summary.regionCount) : "—"}</p>
          </div>
          <div>
            <p className="text-micro leading-none text-[var(--ink-3)]">累计台数</p>
            <p className="num mt-1.5 text-label leading-none text-[var(--c-received)]">{payload.business ? formatCount(payload.business.delivery.summary.unitCount) : "—"}</p>
          </div>
        </div>
      </div>

      {/* SVG 铺满面板宽度：画布宽高比（1204/924≈1.30）与面板可用区接近，
          缩放系数由宽度定；纵向把视口放大并上移，中国本土才落回面板正中。
          为什么需要这一步、28.5px 是怎么来的，见 globals.css 的 .map-svg。

          wrapper 用 `flex` 而非块级流：块级流里 SVG 的**基线**会参与行盒
          计算（line-height 那点空隙能让 top 差出几个像素，中国就不是正中了）。 */}
      <div className="absolute inset-0 flex">
        <svg
          className="map-svg"
          viewBox={screenMapViewBox}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`全国发货网络图：滕州工厂发往 ${routes.length} 个收货点，覆盖 ${coveredProvinces} 个省级区域`}
        >
        <defs>
          {/* 边缘光：模糊副本叠在原图下方 */}
          <filter id="edge-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4.5" />
          </filter>
          <filter id="edge-glow-tight" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.8" />
          </filter>
          <filter id="arc-glow" x="-36%" y="-36%" width="172%" height="172%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="node-glow" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* 球面明暗：左上受光、右下入暗，配合同心环造成球体错觉。
              用覆盖整幅画布的矩形 + 径向渐变，角落不会出现硬边。 */}
          <radialGradient id="sphere-shade" cx="38%" cy="30%" r="86%">
            <stop offset="0%" stopColor="rgba(96, 150, 210, 0.11)" />
            <stop offset="46%" stopColor="rgba(14, 22, 34, 0)" />
            <stop offset="100%" stopColor="rgba(2, 5, 10, 0.62)" />
          </radialGradient>

          {/* 顶面光照：左下暖、右上冷 */}
          <linearGradient id="terrain-light" x1="0" y1="1" x2="0.85" y2="0">
            <stop offset="0%" stopColor="rgba(255, 168, 96, 0.16)" />
            <stop offset="38%" stopColor="rgba(255, 168, 96, 0.04)" />
            <stop offset="72%" stopColor="rgba(8, 12, 20, 0.16)" />
            <stop offset="100%" stopColor="rgba(3, 6, 12, 0.42)" />
          </linearGradient>

          <radialGradient id="factory-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="34%" stopColor="#9df3ff" />
            <stop offset="100%" stopColor="rgba(69, 216, 238, 0)" />
          </radialGradient>

          {/* 中国整体外发光：让边缘光有「溢出来」的感觉 */}
          <filter id="china-outer-glow" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="b" />
            </feMerge>
          </filter>
        </defs>

        {/* ---- 球面网格与光环 ---- */}
        <g pointerEvents="none">
          {sphereRings.map((ring) => (
            <ellipse
              key={ring.scale}
              className={ring.glow ? "map-sphere-ring map-sphere-ring-glow" : "map-sphere-ring"}
              cx={sphereCenter.x}
              cy={sphereCenter.y}
              rx={(chinaMap.width / 2) * ring.scale}
              ry={(chinaMap.height / 2) * ring.scale}
              strokeWidth={ring.width}
              strokeOpacity={ring.opacity}
              strokeDasharray={ring.dash}
            />
          ))}

          {/* 经纬网：颜色/线宽放在 <g> 上由子 path 继承；emphasis 类只覆盖描边色 */}
          <g className="map-graticule" fill="none" stroke="var(--c-graticule)" strokeWidth="1.1">
            {chinaMap.graticule.parallels.map((line) => (
              <path
                key={`p-${line.lat}`}
                className={line.emphasis ? "map-graticule-emphasis" : undefined}
                d={line.d}
              />
            ))}
            {chinaMap.graticule.meridians.map((line) => (
              <path
                key={`m-${line.lon}`}
                className={line.emphasis ? "map-graticule-emphasis" : undefined}
                d={line.d}
              />
            ))}
          </g>

          {/* 球面明暗：整幅画布，角落不留硬边 */}
          <rect x="0" y="0" width={chinaMap.width} height={chinaMap.height} fill="url(#sphere-shade)" />
        </g>

        {/* ---- 邻国（由近到远逐级变淡，构成球面纵深） ---- */}
        <g pointerEvents="none">
          {[0, 1, 2].map((order) => (
            <g key={`order-${order}`}>
              {neighbors
                .filter((item) => item.order === order)
                .map((item) => (
                  <path key={item.name} className="map-neighbor" d={item.d} fill={NEIGHBOR_FILL[order]} />
                ))}
            </g>
          ))}
        </g>

        {/* ---- 中国：省级顶面 ---- */}
        <g>
          {provinces.map((province) => {
            const count = heat.counts.get(matchProvinceKey(province.name)) || 0;
            return (
              <path
                key={province.adcode}
                className="map-province"
                d={province.d}
                fill={HEAT_SCALE[heatIndex(count, heat.max)]}
              />
            );
          })}
        </g>

        {/* ---- 中国顶面光照 ---- */}
        <g pointerEvents="none">
          <path d={chinaSilhouette} fill="url(#terrain-light)" />
        </g>

        {/* ---- 中国边缘光：外发光 + 暖色描边 + 亮芯 ---- */}
        <g pointerEvents="none">
          <path
            d={chinaSilhouette}
            className="map-china-edge-warm"
            strokeWidth="6"
            filter="url(#china-outer-glow)"
          />
          <path
            d={chinaSilhouette}
            className="map-china-edge-core"
            strokeWidth="3"
            filter="url(#edge-glow-tight)"
          />
          <path d={chinaSilhouette} className="map-china-edge-core" strokeWidth="1.5" />
        </g>

        {/* ---- 标签 ---- */}
        <g pointerEvents="none">
          {labels.map((label) => (
            <text
              key={label.id}
              className={label.cls}
              data-map-label={label.text}
              x={label.x}
              y={label.y}
              fontSize={label.size}
              textAnchor={label.anchor}
              fill={label.fill}
            >
              {label.text}
            </text>
          ))}
        </g>

        {/* ---- 航线 ---- */}
        <g>
          {arcs.map((arc) => {
            const isActive = active?.id === arc.route.id;
            return (
              <g key={arc.route.id}>
                <path d={arc.d} className="map-arc" stroke={arc.color} strokeOpacity={0.1} strokeWidth="7" />
                <path
                  d={arc.d}
                  className="map-arc"
                  stroke={arc.color}
                  strokeOpacity={isActive ? 0.95 : 0.42}
                  strokeWidth={isActive ? 3 : 2}
                  filter="url(#arc-glow)"
                />
                <path
                  className="map-flow"
                  d={arc.d}
                  stroke={arc.color}
                  strokeOpacity={isActive ? 0.9 : 0.5}
                  strokeWidth="2.6"
                  style={{ animationDuration: arc.duration, animationDelay: arc.delay }}
                />
              </g>
            );
          })}
        </g>

        {/* ---- 收货点 ---- */}
        <g>
          {routes.map((route) => {
            const isActive = active?.id === route.id;
            const tone = route.status === "PARTIAL_SHIPPED" ? "var(--c-pending)" : "var(--c-collect)";
            return (
              <g
                key={route.id}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                focusable="true"
                aria-label={`${route.city}，${route.status === "PARTIAL_SHIPPED" ? "部分发货" : "已发货"}`}
                onClick={() => setActiveId(route.id)}
                onFocus={() => setActiveId(route.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveId(route.id);
                  }
                }}
                onMouseEnter={() => setActiveId(route.id)}
              >
                <circle cx={route.destination.x} cy={route.destination.y} r="17" fill="transparent" />
                {isActive ? (
                  <circle
                    cx={route.destination.x}
                    cy={route.destination.y}
                    r="11"
                    fill="none"
                    stroke={tone}
                    strokeOpacity="0.45"
                    strokeWidth="1.4"
                  />
                ) : null}
                <circle
                  className="map-node"
                  cx={route.destination.x}
                  cy={route.destination.y}
                  r={isActive ? 6.6 : 4.9}
                  fill="#050a12"
                  stroke={tone}
                  strokeWidth={isActive ? 3 : 2.4}
                  filter="url(#node-glow)"
                />
              </g>
            );
          })}
        </g>

        {/* ---- 工厂：全图唯一视觉锚点 ---- */}
        <g pointerEvents="none">
          <circle
            className="factory-core"
            cx={factory.x}
            cy={factory.y}
            r="54"
            fill="none"
            stroke="rgba(69, 216, 238, 0.28)"
            strokeWidth="1.2"
            strokeDasharray="3 7"
          />
          <circle
            cx={factory.x}
            cy={factory.y}
            r="36"
            fill="none"
            stroke="rgba(69, 216, 238, 0.4)"
            strokeWidth="1.4"
          />
          <circle cx={factory.x} cy={factory.y} fill="url(#factory-core)" r="30" />
          <circle
            cx={factory.x}
            cy={factory.y}
            r="7"
            fill="#eafcff"
            stroke="var(--c-collect)"
            strokeWidth="2.4"
            filter="url(#node-glow)"
          />
        </g>
      </svg>
      </div>

      {/* ================= 两侧数据角标 =================
          投影后的陆地只有西南、东南两块是空的，四张卡就贴在这两个角上：
          · 左侧：发货来源 + 省级排行（x 0–150，只压到新疆/西藏西缘）
          · 右侧：发货状态 + 色阶图例（x ≥ 1046，只压到日本海与菲律宾海）
          卡片做成半透明，压在邻国上也不会显得「糊住」。 */}

      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex w-[150px] flex-col gap-2">
        <div className="map-hud px-2.5 py-2">
          <p className="text-micro leading-none tracking-[0.14em] text-[var(--ink-3)]">发货来源</p>
          <p className="mt-1.5 text-caption leading-tight font-bold text-[var(--ink)]">滕州工厂</p>
          <p className="mt-1 text-micro leading-none text-[var(--ink-3)]">山东 · 滕州</p>
        </div>


      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex w-[22%] flex-col gap-2">
        <div data-map-hud="ranking" className="map-hud px-2.5 py-2">
          <p className="text-micro leading-none tracking-[0.14em] text-[var(--ink-3)]">省级排行</p>
          <ul className="mt-1.5 space-y-1.5">
            {provinceRanking.slice(0, 4).map((row) => (
              <li key={row.name}>
                <div className={row.count < 0 ? "flex flex-col gap-1" : "flex items-baseline justify-between gap-1.5"}>
                  <span title={row.name} className="truncate text-micro leading-none text-[var(--ink-2)]">
                    {row.name}
                  </span>
                  <span className="num text-micro leading-none text-[var(--ink)]">{formatCount(row.count)}</span>
                </div>
                <span
                  className="mt-1 block h-1 rounded-full"
                  style={{
                    width: `${row.count < 0 ? 0 : Math.max(14, (row.count / Math.max(1, maxRank)) * 100)}%`,
                    background: HEAT_SCALE[Math.min(HEAT_SCALE.length - 1, 2 + Math.max(0, row.count))],
                  }}
                />
              </li>
            ))}
          </ul>
          {payload.business?.delivery.unresolvedRegionTotals?.shipmentCount ? <p className="text-micro">地区待确认 {formatCount(payload.business.delivery.unresolvedRegionTotals.unitCount)} 台</p> : null}
          {provinceRanking.length > 4 ? <p className="mt-2 text-micro text-[var(--ink-3)]">其他 {provinceRanking.length - 4} 省</p> : null}
        </div>
      </div>
      <div data-map-hud="details" className="pointer-events-none absolute top-[96px] right-3 z-10 flex w-[22%] flex-col gap-2">
        <div className="map-hud px-2.5 py-2">
          <p className="text-micro leading-none tracking-[0.14em] text-[var(--ink-3)]">图中发运状态</p>
          <ul className="mt-1.5 space-y-1.5">
            <li>
              <div className="flex items-center gap-1.5">
                <i className="size-2.5 shrink-0 rounded-full bg-[var(--c-collect)]" />
                <span className="text-micro leading-none text-[var(--ink-2)]">已发货</span>
                <span className="num ml-auto text-caption leading-none text-[var(--ink)]">
                  {shippedCount}
                </span>
              </div>
              <span
                className="mt-1 block h-1 rounded-full bg-[var(--c-collect)] opacity-60"
                style={{ width: `${(shippedCount / Math.max(1, routes.length)) * 100}%` }}
              />
            </li>
            <li>
              <div className="flex items-center gap-1.5">
                <i className="size-2.5 shrink-0 rounded-full bg-[var(--c-pending)]" />
                <span className="text-micro leading-none text-[var(--ink-2)]">部分发货</span>
                <span className="num ml-auto text-caption leading-none text-[var(--ink)]">
                  {pendingCount}
                </span>
              </div>
              <span
                className="mt-1 block h-1 rounded-full bg-[var(--c-pending)] opacity-60"
                style={{ width: `${(pendingCount / Math.max(1, routes.length)) * 100}%` }}
              />
            </li>
          </ul>
        </div>

        {/* 高度色阶图例：带刻度 */}
        <div className="map-hud px-2.5 py-2">
          <p className="text-micro leading-none tracking-[0.14em] text-[var(--ink-3)]">省级发货量</p>
          <div className="mt-1.5 flex items-end gap-[3px]">
            {HEAT_SCALE.map((color, index) => (
              <span
                key={color}
                className="block flex-1 rounded-[2px]"
                style={{ background: color, height: `${9 + index * 4}px` }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-micro leading-none text-[var(--ink-3)]">
            <span>0</span>
            <span className="num text-[var(--brand-orange-hot)]">{heat.max} 台</span>
          </div>
        </div>
      </div>
    </div>
  );
}
