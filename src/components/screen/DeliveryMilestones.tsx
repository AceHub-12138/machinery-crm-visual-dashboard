"use client";

import { matchProvinceKey } from "@/lib/geo";
import { DATA_PENDING, hasNegativeMetric, formatCount, formatShortDate } from "@/lib/format";
import type { PublicSalesScreenPayload } from "@/lib/voice/public-payload";
import type { PublicShipment } from "@/lib/public-screen-payload";

/**
 * 交付里程碑。
 *
 * 对外展示板块 —— **刻意不显示客户名称、跟进正文、业务员姓名**。
 * 只呈现「什么设备、多少台、发往哪个大区、哪天出的」，既能体现交付能力，
 * 又不会把客户信息投到展厅墙上。数据完全来自 shipmentPaths，
 * 不依赖 recentFollows 里的客户内容。
 */

const REGION_GROUP: Record<string, string> = {
  山东: "华东",
  江苏: "华东",
  浙江: "华东",
  安徽: "华东",
  福建: "华东",
  江西: "华东",
  上海: "华东",
  北京: "华北",
  天津: "华北",
  河北: "华北",
  山西: "华北",
  内蒙古: "华北",
  河南: "华中",
  湖北: "华中",
  湖南: "华中",
  广东: "华南",
  广西: "华南",
  海南: "华南",
  辽宁: "东北",
  吉林: "东北",
  黑龙江: "东北",
  四川: "西南",
  重庆: "西南",
  贵州: "西南",
  云南: "西南",
  西藏: "西南",
  陕西: "西北",
  甘肃: "西北",
  青海: "西北",
  宁夏: "西北",
  新疆: "西北",
  台湾: "港澳台",
  香港: "港澳台",
  澳门: "港澳台",
};

const formatDay = formatShortDate;

export function DeliveryMilestones({ paths, delivery }: { paths: PublicShipment[]; delivery?: PublicSalesScreenPayload["delivery"] }) {
  // 最近交付在前
  const milestones = [...paths]
    .filter(path => path.shipmentStatus === "SHIPPED")
    .sort((a, b) => new Date(b.shipmentDate).getTime() - new Date(a.shipmentDate).getTime())
    .slice(0, 5);


  return (
    <div className="panel grid h-full grid-cols-[210px_1fr] items-stretch">
      <div className="flex flex-col justify-center gap-1 border-r border-[var(--hairline)] px-4">
        <p className="panel-eyebrow">Delivery</p>
        <p className="text-label leading-tight font-bold text-[var(--ink)]">交付里程碑</p>
        {/* 三个统计量拆成两个 span：18px 下整串「12 单 · 18 台 · 6 大区」
            实测 193px，比 178px 的可用宽度宽 —— 与其让它自己折在「大区」
            前面，不如显式分行：第一行数量、第二行覆盖大区，读起来也更顺。 */}
        <p className="num flex flex-wrap items-baseline gap-x-2 text-micro leading-none text-[var(--ink-3)]">
          <span>
            {delivery && hasNegativeMetric(delivery.summary.shipmentCount, delivery.summary.unitCount) ? DATA_PENDING : `${delivery ? formatCount(delivery.summary.shipmentCount) : "—"} 单 · ${delivery ? formatCount(delivery.summary.unitCount) : "—"} 台`}
          </span>
          <span className="text-[var(--ink-4)]">{delivery ? formatCount(delivery.summary.regionCount) : "—"} 省份</span>
        </p>
        <p className="text-micro text-[var(--ink-3)]">样本 {milestones.length}{delivery?.milestonesTotal === undefined ? "" : ` / 展示总量 ${formatCount(delivery.milestonesTotal)}`}</p>
      </div>

      {/* 三列自适应：`auto-fit + minmax(300px, 1fr)` 让 5 张卡按可用宽度
          自己决定排几列 —— 1680px 可用宽时正好 3 列（余下位置留给第 2 行），
          屏更宽时自动变 4～5 列。写死 `grid-cols-5` 时每张卡只有 ~344px，
          设备名升到 22px 后会撑满，只能靠 truncate 截断。 */}
      <div className="milestone-grid grid min-w-0 content-center gap-y-1.5 px-3 py-2 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
        {milestones.map((item) => {
          const region = matchProvinceKey(item.contract.customer.region);
          const group = REGION_GROUP[region] ?? "其他";
          return (
            <article key={item.id} className="milestone-item flex min-w-0 flex-col justify-center px-3">
              <div className="flex shrink-0 items-center justify-between gap-2">
                <span
                  className="rounded-[3px] px-2 py-0.5 text-micro leading-none font-bold"
                  style={{ background: "rgba(69, 216, 238, 0.13)", color: "var(--c-collect)" }}
                >
                  {group}
                </span>
                <span className="num text-micro leading-none text-[var(--ink-3)]">
                  {formatDay(item.shipmentDate)}
                </span>
              </div>

              <p title={item.contract.equipmentName} className="mt-1 truncate text-label leading-none font-medium text-[var(--ink)]">
                {item.contract.equipmentName}
              </p>
              <p title={`${item.contract.equipmentModel || "—"} · ${formatCount(item.quantity)} 台 · ${region}`} className="num mt-1 truncate text-caption leading-none text-[var(--ink-2)]">
                {item.contract.equipmentModel || "—"} · {formatCount(item.quantity)} 台 · {region}
              </p>
            </article>
          );
        })}
        {!milestones.length ? (
          <p className="col-span-full flex items-center justify-center text-caption text-[var(--ink-3)]">
            暂无交付记录
          </p>
        ) : null}
      </div>
    </div>
  );
}
