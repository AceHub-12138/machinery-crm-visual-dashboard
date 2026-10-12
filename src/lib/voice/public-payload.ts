/**
 * 公开销售大屏 payload 的本地镜像类型(8b 数据源契约)。
 *
 * 权威来源(严格只读参考,禁止 import):
 *   平台仓 machinery-crm-v108-release/src/modules/screen/public-types.ts
 *   → PublicSalesScreenPayload(kpis / collection / delivery 三段白名单)
 *
 * 逐字段对齐红线(plan §16.2 B①):本地 fixture 与本类型必须一一对应;
 * 迁移到平台 = 只改 fetch 的 URL 与 publicId 两个值,类型零改动。
 * 平台侧字段只增不改时,本镜像按需补齐(增量兼容)。
 */

export type PublicSalesScreenPayload = {
  version: 1;
  generatedAt: string;
  displayNotice: boolean;
  /** 平台 SalesScreenConfig["modules"](模块可见性配置;语音链路不消费,透传) */
  modules: Record<string, unknown>;
  period: {
    label: string;
    startDate: string;
    endDate: string;
  };
  kpis: {
    totalCustomers: number;
    periodNewCustomers: number;
    todayFollowUp: number;
    overdueFollowUp: number;
    sevenDayFollowUp: number;
    /** 本期有效 CNY 合同数，与本期合同额同一集合。 */
    periodNewContracts: number;
    periodContractAmount: string;
    periodPaidAmount: string;
    periodUnpaidAmount: string;
    periodShipments: number;
    /** 累计有效 CNY 未回款合同数。 */
    unpaidContracts: number;
    /** 累计有效 CNY 部分回款合同数。 */
    partialPaidContracts: number;
  };
  collection: {
    totalContractAmount: string;
    totalPaidAmount: string;
    totalUnpaidAmount: string;
    collectionRate: number;
    /** 同月公司目标取最后修改的一条（updatedAt desc，id asc）。 */
    targetConfigured?: boolean;
    targetAmount: string;
    actualAmount: string;
    targetRate: number;
    targetVisualRate: number;
    remainingAmount: string;
    exceededAmount: string;
    exceeded: boolean;
  };
  delivery: {
    summary: {
      shipmentCount: number;
      unitCount: number;
      regionCount: number;
      todayDue: number;
      sevenDayDue: number;
      overdueDue: number;
    };
    /** 全量区域放在 delivery.regionUnits，区别于地图样本 routes。 */
    regionUnits?: Array<{ province: string; shipmentCount: number; unitCount: number }>;
    unresolvedRegionTotals?: { shipmentCount: number; unitCount: number };
    routesTotal?: number;
    milestonesTotal?: number;
    routes: PublicRouteSample[];
    reminders: {
      todayTotal?: number;
      sevenDaysTotal?: number;
      overdueTotal?: number;
      today: PublicReminderSample[];
      sevenDays: PublicReminderSample[];
      overdue: PublicReminderSample[];
    };
    milestones: PublicMilestoneSample[];
  };
};

export type PublicRouteSample = {
  key: string;
  province: string;
  city: string | null;
  centerLat: number;
  centerLng: number;
  equipmentName: string;
  equipmentModel: string;
  shipmentDate: string;
  unitCount: number;
};

export type PublicReminderSample = {
  key: string;
  contractNumber: string | null;
  equipmentName: string;
  equipmentModel: string;
  estimatedShipmentDate: string;
  province: string;
  city: string | null;
};

export type PublicMilestoneSample = {
  key: string;
  contractNumber: string | null;
  equipmentName: string;
  equipmentModel: string;
  shipmentDate: string;
  shipmentStatus: string;
  unitCount: number;
};

/**
 * fail-closed 结构校验(plan §10 风格:不可信输入一律显式拒绝)。
 * 只校验语音链路消费到的骨架与字段类型;金额字符串必须是有限的十进制数。
 * 校验失败抛 DataSourceError 由调用方归一为降级路径。
 */
export function validatePublicPayload(raw: unknown): PublicSalesScreenPayload {
  const fail = (why: string): never => {
    throw new Error(`public payload 结构不合法: ${why}`);
  };
  if (typeof raw !== "object" || raw === null) fail("根节点不是对象");
  const p = raw as Record<string, unknown>;
  if (p.version !== 1) fail("version 必须为 1");
  if (typeof p.period !== "object" || p.period === null) fail("period 缺失");
  if (typeof (p.period as Record<string, unknown>).label !== "string") fail("period.label 缺失");

  for (const seg of ["kpis", "collection", "delivery"] as const) {
    if (typeof p[seg] !== "object" || p[seg] === null) fail(`${seg} 段缺失`);
  }
  const kpis = p.kpis as Record<string, unknown>;
  for (const key of Object.keys(KPIS_NUMBER_FIELDS)) {
    if (typeof kpis[key] !== "number" || !Number.isFinite(kpis[key])) fail(`kpis.${key} 必须为 number`);
  }
  for (const key of ["periodContractAmount", "periodPaidAmount", "periodUnpaidAmount"]) {
    if (typeof kpis[key] !== "string" || !/^-?\d+(\.\d+)?$/.test(kpis[key] as string) || !Number.isFinite(Number(kpis[key]))) fail(`kpis.${key} 金额不合法`);
  }
  const collection = p.collection as Record<string, unknown>;
  for (const key of Object.keys(COLLECTION_TEXT_FIELDS)) {
    if (typeof collection[key] !== "string" || !/^-?\d+(\.\d+)?$/.test(collection[key] as string) || !Number.isFinite(Number(collection[key]))) fail(`collection.${key} 必须为 string`);
  }
  for (const key of ["collectionRate", "targetRate", "targetVisualRate"] as const) {
    if (typeof collection[key] !== "number" || !Number.isFinite(collection[key])) fail(`collection.${key} 必须为 number`);
  }
  const delivery = p.delivery as Record<string, unknown>;
  if (typeof delivery.summary !== "object" || delivery.summary === null) fail("delivery.summary 缺失");
  for (const list of ["routes", "milestones"] as const) {
    if (!Array.isArray(delivery[list])) fail(`delivery.${list} 必须为数组`);
  }
  if (typeof delivery.reminders !== "object" || delivery.reminders === null) fail("delivery.reminders 缺失");
  for (const list of ["today", "sevenDays", "overdue"] as const) {
    if (!Array.isArray((delivery.reminders as Record<string, unknown>)[list])) {
      fail(`delivery.reminders.${list} 必须为数组`);
    }
  }
  if (collection.targetConfigured !== undefined && typeof collection.targetConfigured !== "boolean") fail("targetConfigured 必须为 boolean");
  const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value);
  for (const key of ["routesTotal", "milestonesTotal"]) if (delivery[key] !== undefined && !integer(delivery[key])) fail(`delivery.${key} 必须为整数`);
  const reminders = delivery.reminders as Record<string, unknown>;
  for (const key of ["todayTotal", "sevenDaysTotal", "overdueTotal"]) if (reminders[key] !== undefined && !integer(reminders[key])) fail(`reminders.${key} 必须为整数`);
  if (delivery.regionUnits !== undefined && (!Array.isArray(delivery.regionUnits) || !delivery.regionUnits.every(row => row && typeof row.province === "string" && integer(row.shipmentCount) && integer(row.unitCount)))) fail("regionUnits 不合法");
  const unresolved = delivery.unresolvedRegionTotals as Record<string, unknown> | undefined;
  if (unresolved !== undefined && (!unresolved || !integer(unresolved.shipmentCount) || !integer(unresolved.unitCount))) fail("unresolvedRegionTotals 不合法");
  const summaryFields = ["shipmentCount", "unitCount", "regionCount", "todayDue", "sevenDayDue", "overdueDue"];
  if (summaryFields.some(key => !integer((delivery.summary as Record<string, unknown>)[key]))) fail("summary 计数不合法");
  if (Array.isArray(delivery.regionUnits) && unresolved) {
    const summary = delivery.summary as Record<string, unknown>;
    const regions = delivery.regionUnits as Array<{province: string; shipmentCount: number; unitCount: number}>;
    if (new Set(regions.map(r => r.province)).size !== regions.length || regions.length !== summary.regionCount ||
      regions.reduce((n, r) => n + r.unitCount, 0) + Number(unresolved.unitCount) !== summary.unitCount ||
      regions.reduce((n, r) => n + r.shipmentCount, 0) + Number(unresolved.shipmentCount) !== summary.shipmentCount) fail("区域总量不一致");
  }
  return raw as PublicSalesScreenPayload;
}

const KPIS_NUMBER_FIELDS = {
  totalCustomers: 1,
  periodNewCustomers: 1,
  todayFollowUp: 1,
  overdueFollowUp: 1,
  sevenDayFollowUp: 1,
  periodNewContracts: 1,
  periodShipments: 1,
  unpaidContracts: 1,
  partialPaidContracts: 1,
} as const;

const COLLECTION_TEXT_FIELDS = {
  totalContractAmount: 1,
  totalPaidAmount: 1,
  totalUnpaidAmount: 1,
  targetAmount: 1,
  actualAmount: 1,
  remainingAmount: 1,
  exceededAmount: 1,
} as const;
