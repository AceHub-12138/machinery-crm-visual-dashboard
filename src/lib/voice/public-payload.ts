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
    periodNewContracts: number;
    periodContractAmount: string;
    periodPaidAmount: string;
    periodUnpaidAmount: string;
    periodShipments: number;
    unpaidContracts: number;
    partialPaidContracts: number;
  };
  collection: {
    totalContractAmount: string;
    totalPaidAmount: string;
    totalUnpaidAmount: string;
    collectionRate: number;
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
    routes: PublicRouteSample[];
    reminders: {
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
 * 只校验语音链路消费到的骨架与字段类型;金额字符串留 Number() 兜底。
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
    if (typeof kpis[key] !== "number") fail(`kpis.${key} 必须为 number`);
  }
  const collection = p.collection as Record<string, unknown>;
  for (const key of Object.keys(COLLECTION_TEXT_FIELDS)) {
    if (typeof collection[key] !== "string") fail(`collection.${key} 必须为 string`);
  }
  for (const key of ["collectionRate", "targetRate", "targetVisualRate"] as const) {
    if (typeof collection[key] !== "number") fail(`collection.${key} 必须为 number`);
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
