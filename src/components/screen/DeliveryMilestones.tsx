"use client";

import { useMemo, useState } from "react";
import { ClipText } from "@/components/screen/ClipText";
import { matchProvinceKey } from "@/lib/geo";
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

function formatDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function DeliveryMilestones({ paths }: { paths: PublicShipment[] }) {
  const ordered = useMemo(() => [...paths].sort((a,b) => Date.parse(b.shipmentDate)-Date.parse(a.shipmentDate)),[paths]);
  const [paging,setPaging] = useState({paths,page:0});
  const pages = Math.max(1,Math.ceil(ordered.length / 5));
  const page = paging.paths === paths ? paging.page % pages : 0;
  const milestones = ordered.slice(page*5,page*5+5);
  const totalUnits = paths.reduce((sum,item)=>sum+(item.quantity||0),0);
  const regionCount = new Set(paths.map(item=>REGION_GROUP[matchProvinceKey(item.contract.customer.region)]??"其他")).size;
  return <div className="panel grid h-full grid-cols-[210px_minmax(0,1fr)] items-stretch">
    <div className="flex min-w-0 flex-col justify-center gap-1 border-r border-[var(--hairline)] px-4">
      <p className="text-label leading-tight font-bold text-[var(--ink)]">交付里程碑</p>
      <p className="num flex flex-wrap gap-x-2 text-micro leading-tight text-[var(--ink-3)]"><span className="num-unit">{paths.length} 单 · {totalUnits} 台</span><span className="num-unit">{regionCount} 大区</span></p>
      {pages>1 ? <div className="flex items-center gap-2 text-micro leading-tight text-[var(--ink-3)]"><span>第 {page+1}/{pages} 页</span><button type="button" aria-label="下一页交付里程碑" className="text-micro text-[var(--brand-orange-hot)]" onClick={()=>setPaging(prev=>({paths,page:((prev.paths===paths?prev.page:0)+1)%pages}))}>下一页 ›</button></div> : null}
    </div>
    <div className="milestone-timeline grid min-w-0 grid-cols-5 items-center px-3 py-1" data-page={page+1}>
      {milestones.map(item=>{
        const region=matchProvinceKey(item.contract.customer.region);
        const group=REGION_GROUP[region]??"其他";
        const label=`${group} · ${item.contract.equipmentModel || item.contract.equipmentName}`;
        return <article key={item.id} className="milestone-node min-w-0 px-3">
          <time className="num num-unit text-micro leading-tight text-[var(--ink-3)]" dateTime={item.shipmentDate}>{formatDay(item.shipmentDate)}</time>
          <div className="milestone-track" aria-hidden="true"><i /></div>
          <ClipText full={`${group} · ${item.contract.equipmentName} ${item.contract.equipmentModel}`} className="clip-1 text-label leading-tight font-medium text-[var(--ink)]">{label}</ClipText>
          <p className="num num-unit mt-1 text-micro leading-tight text-[var(--ink-2)]">{item.quantity} 台 · {region}</p>
        </article>;
      })}
      {!milestones.length ? <p className="col-span-full text-center text-caption text-[var(--ink-3)]">暂无交付记录</p> : null}
    </div>
  </div>;
}
