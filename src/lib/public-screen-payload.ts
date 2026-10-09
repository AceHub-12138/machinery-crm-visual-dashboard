import { calculateSalesTargetProgress } from "./target";
import { chinaMap, projectLonLat } from "./geo";
import { validatePublicPayload } from "./voice/public-payload";
import type { PublicSalesScreenPayload } from "./voice/public-payload";
import type { CrmDashboardStats, DashboardRange, MapPoint, SalesTargetItem, SalesTargetResponse, ScreenCrmPayload, ScreenMapRoute, ShipmentReminderItem, ShipmentPathItem } from "./types";

export type PublicReminder = Omit<ShipmentReminderItem, "customer">;
export type PublicRoute = Omit<ScreenMapRoute, "companyName" | "address">;
export type PublicShipment = Pick<ShipmentPathItem, "id" | "shipmentDate" | "shipmentStatus" | "equipmentName" | "quantity"> & {
  contract: { equipmentName: string; equipmentModel: string; customer: { region: string } };
};
export type PublicTarget = Omit<SalesTargetItem, "note" | "salesUserId"> & { salesUserId: null };
export type PublicScreenPayload = {
  business?: PublicSalesScreenPayload;
  generatedAt: string;
  source: ScreenCrmPayload["source"];
  dashboard: {
    range: DashboardRange;
    stats: CrmDashboardStats;
    shipmentReminders: { today: PublicReminder[]; sevenDays: PublicReminder[]; overdue: PublicReminder[] };
    shipmentPaths: PublicShipment[];
  };
  salesTargets: { period: SalesTargetResponse["period"]; targets: PublicTarget[] };
  map: { factory: MapPoint & { name: string }; routes: PublicRoute[]; coverageProvinces: string[]; resolvedCount: number; shipmentCount: number };
};

const statKeys = [
  "totalCustomers", "todayFollowUp", "overdueFollowUp", "sevenDayFollowUp", "periodNewCustomers", "periodNewContracts",
  "periodContractAmount", "periodPaidAmount", "periodUnpaidAmount", "periodShipments", "totalContractAmount", "totalPaidAmount",
  "totalUnpaidAmount", "unpaidContracts", "partialPaidContracts", "todayShipmentDue", "sevenDayShipmentDue", "overdueShipmentDue",
] as const satisfies readonly (keyof CrmDashboardStats)[];

function point(value: MapPoint): MapPoint { return { x: value.x, y: value.y, lng: value.lng, lat: value.lat }; }
function reminder(value: ShipmentReminderItem): PublicReminder {
  return { id: value.id, contractNo: value.contractNo, estimatedShipmentDate: value.estimatedShipmentDate, equipmentName: value.equipmentName, equipmentModel: value.equipmentModel };
}

/** 只构造公开 UI 使用的字段；禁止透传 CRM 对象或把敏感字段置空后继续传播。 */
export function toPublicScreenPayload(payload: ScreenCrmPayload): PublicScreenPayload {
  const { range, stats, shipmentReminders, shipmentPaths } = payload.dashboard;
  const period = payload.salesTargets.period;
  return {
    business: mockBusinessPayload(payload),
    generatedAt: payload.generatedAt,
    source: payload.source,
    dashboard: {
      range: { preset: range.preset, start: range.start, end: range.end, startDate: range.startDate, endDate: range.endDate },
      stats: Object.fromEntries(statKeys.map((key) => [key, stats[key]])) as CrmDashboardStats,
      shipmentReminders: { today: shipmentReminders.today.map(reminder), sevenDays: shipmentReminders.sevenDays.map(reminder), overdue: shipmentReminders.overdue.map(reminder) },
      shipmentPaths: shipmentPaths.map((item) => ({
        id: item.id, shipmentDate: item.shipmentDate, shipmentStatus: item.shipmentStatus, equipmentName: item.equipmentName, quantity: item.quantity,
        contract: { equipmentName: item.contract.equipmentName, equipmentModel: item.contract.equipmentModel, customer: { region: item.contract.customer.region } },
      })),
    },
    salesTargets: {
      period: { type: period.type, year: period.year, index: period.index, label: period.label },
      targets: payload.salesTargets.targets.filter((t) => t.salesUserId === null).map((t) => ({
        id: t.id, periodType: t.periodType, periodYear: t.periodYear, periodIndex: t.periodIndex, metric: t.metric, amount: t.amount,
        salesUserId: null, actualAmount: t.actualAmount, completionRate: t.completionRate, visualRate: t.visualRate, remainingAmount: t.remainingAmount,
        exceededAmount: t.exceededAmount, exceeded: t.exceeded, updatedAt: t.updatedAt,
      })),
    },
    map: {
      factory: { ...point(payload.map.factory), name: payload.map.factory.name },
      routes: payload.map.routes.map((r) => ({ id: r.id, status: r.status, region: r.region, city: r.city, equipmentName: r.equipmentName, contractNo: r.contractNo, origin: point(r.origin), destination: point(r.destination) })),
      coverageProvinces: [...payload.map.coverageProvinces], resolvedCount: payload.map.resolvedCount, shipmentCount: payload.map.shipmentCount,
    },
  };
}

/** mock 仅在服务端构造完整口径，浏览器和 demo 语音直接消费同一份字段。 */
function mockBusinessPayload(payload: ScreenCrmPayload): PublicSalesScreenPayload {
  const s = payload.dashboard.stats;
  const target = payload.salesTargets.targets.find(t => t.salesUserId === null);
  const progress = Number(target?.amount ?? 0) > 0 ? calculateSalesTargetProgress(s.periodContractAmount, target!.amount) : { targetAmount: "0.00", completionRate: 0, visualRate: 0, remainingAmount: "0.00", exceededAmount: "0.00", exceeded: false };
  // mock 的 shipmentPaths 是完整种子数据；真实平台适配绝不走此聚合。
  const regions = new Map<string, { province: string; shipmentCount: number; unitCount: number }>();
  for (const row of payload.dashboard.shipmentPaths) {
    const province = row.contract.customer.region;
    const region = regions.get(province) ?? { province, shipmentCount: 0, unitCount: 0 };
    region.shipmentCount++; region.unitCount += row.quantity; regions.set(province, region);
  }
  const reminders = (rows: ShipmentReminderItem[]) => rows.map(r => ({ key: r.id, contractNumber: r.contractNo,
    equipmentName: r.equipmentName, equipmentModel: r.equipmentModel, estimatedShipmentDate: r.estimatedShipmentDate, province: "", city: null }));
  const paths = payload.dashboard.shipmentPaths;
  return {
    version: 1, generatedAt: payload.generatedAt, displayNotice: false, modules: {},
    period: { label: payload.salesTargets.period.label, startDate: payload.dashboard.range.startDate, endDate: payload.dashboard.range.endDate },
    kpis: { totalCustomers: s.totalCustomers, periodNewCustomers: s.periodNewCustomers, todayFollowUp: s.todayFollowUp,
      overdueFollowUp: s.overdueFollowUp, sevenDayFollowUp: s.sevenDayFollowUp, periodNewContracts: s.periodNewContracts,
      periodContractAmount: String(s.periodContractAmount), periodPaidAmount: String(s.periodPaidAmount), periodUnpaidAmount: String(s.periodUnpaidAmount),
      periodShipments: s.periodShipments, unpaidContracts: s.unpaidContracts, partialPaidContracts: s.partialPaidContracts },
    collection: { totalContractAmount: String(s.totalContractAmount), totalPaidAmount: String(s.totalPaidAmount), totalUnpaidAmount: String(s.totalUnpaidAmount),
      collectionRate: s.totalContractAmount > 0 ? Number((s.totalPaidAmount / s.totalContractAmount * 100).toFixed(1)) : 0,
      targetConfigured: target !== undefined, targetAmount: progress.targetAmount, actualAmount: String(s.periodContractAmount),
      targetRate: progress.completionRate, targetVisualRate: progress.visualRate, remainingAmount: progress.remainingAmount,
      exceededAmount: progress.exceededAmount, exceeded: progress.exceeded },
    delivery: {
      summary: { shipmentCount: paths.length, unitCount: paths.reduce((n, p) => n + p.quantity, 0), regionCount: regions.size,
        todayDue: s.todayShipmentDue, sevenDayDue: s.sevenDayShipmentDue, overdueDue: s.overdueShipmentDue },
      regionUnits: [...regions.values()].sort((a, b) => b.unitCount - a.unitCount), unresolvedRegionTotals: { shipmentCount: 0, unitCount: 0 },
      routesTotal: paths.length, milestonesTotal: paths.filter(p => p.shipmentStatus === "SHIPPED").length,
      routes: payload.map.routes.map(r => ({ key: r.id, province: r.region, city: r.city,
        centerLng: r.destination.lng, centerLat: r.destination.lat, equipmentName: r.equipmentName,
        equipmentModel: paths.find(p => p.id === r.id)?.contract.equipmentModel ?? "", shipmentDate: paths.find(p => p.id === r.id)?.shipmentDate ?? "", unitCount: paths.find(p => p.id === r.id)?.quantity ?? 0 })),
      reminders: { today: reminders(payload.dashboard.shipmentReminders.today), sevenDays: reminders(payload.dashboard.shipmentReminders.sevenDays), overdue: reminders(payload.dashboard.shipmentReminders.overdue),
        todayTotal: s.todayShipmentDue, sevenDaysTotal: s.sevenDayShipmentDue, overdueTotal: s.overdueShipmentDue },
      milestones: paths.filter(p => p.shipmentStatus === "SHIPPED").map(p => ({ key: p.id, contractNumber: null, equipmentName: p.equipmentName,
        equipmentModel: p.contract.equipmentModel, shipmentDate: p.shipmentDate, shipmentStatus: p.shipmentStatus, unitCount: p.quantity })),
    },
  };
}

/** 真实接口的显示层适配准备；不取网、不加倍率、不从 routes 计算汇总。 */
export function fromPublicSalesScreenPayload(p: PublicSalesScreenPayload): PublicScreenPayload {
  validatePublicPayload(p);
  const k = p.kpis, c = p.collection, d = p.delivery;
  const factory = { x: chinaMap.factory.x, y: chinaMap.factory.y, lng: chinaMap.factory.lon, lat: chinaMap.factory.lat, name: chinaMap.factory.name };
  const routes = d.routes.map(r => ({ id: r.key, status: "SHIPPED" as const, region: r.province, city: r.city ?? r.province,
    equipmentName: r.equipmentName, contractNo: "", origin: factory,
    destination: { ...projectLonLat(r.centerLng, r.centerLat), lng: r.centerLng, lat: r.centerLat } }));
  const reminders = (rows: PublicSalesScreenPayload["delivery"]["reminders"]["today"]) => rows.map(r => ({ id: r.key,
    contractNo: r.contractNumber ?? r.province, equipmentName: r.equipmentName, equipmentModel: r.equipmentModel, estimatedShipmentDate: r.estimatedShipmentDate }));
  const business = projectBusinessPayload(p);
  return { business, generatedAt: p.generatedAt, source: "public",
    dashboard: { range: { preset: "month", start: p.period.startDate, end: p.period.endDate, startDate: p.period.startDate, endDate: p.period.endDate },
      stats: { ...Object.fromEntries(statKeys.filter(key => key in k).map(key => [key, Number(k[key as keyof typeof k])])),
        totalContractAmount: Number(c.totalContractAmount), totalPaidAmount: Number(c.totalPaidAmount), totalUnpaidAmount: Number(c.totalUnpaidAmount),
        todayShipmentDue: d.summary.todayDue, sevenDayShipmentDue: d.summary.sevenDayDue, overdueShipmentDue: d.summary.overdueDue } as CrmDashboardStats,
      shipmentReminders: { today: reminders(d.reminders.today), sevenDays: reminders(d.reminders.sevenDays), overdue: reminders(d.reminders.overdue) },
      shipmentPaths: d.milestones.map(m => ({ id: m.key, shipmentDate: m.shipmentDate, shipmentStatus: "SHIPPED", equipmentName: m.equipmentName, quantity: m.unitCount,
        contract: { equipmentName: m.equipmentName, equipmentModel: m.equipmentModel, customer: { region: "" } } })),
    },
    salesTargets: { period: { type: "MONTH", year: Number(p.period.startDate.slice(0, 4)), index: Number(p.period.startDate.slice(5, 7)), label: p.period.label }, targets: [] },
    map: { factory, routes, coverageProvinces: d.regionUnits?.map(r => r.province) ?? [], resolvedCount: routes.length, shipmentCount: d.summary.shipmentCount },
  };
}

/** 明确白名单，禁止额外字段随 API 或 Server Component HTML 透传。 */
function projectBusinessPayload(p: PublicSalesScreenPayload): PublicSalesScreenPayload {
  const fields = <T extends object>(value: T, keys: readonly (keyof T)[]): T => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]])) as T;
  return {
    version: 1, generatedAt: p.generatedAt, displayNotice: p.displayNotice,
    modules: Object.fromEntries(["operatingKpis", "deliveryMap", "collection", "deliveryAlerts", "deliveryMilestones"].filter(key => typeof p.modules?.[key] === "boolean").map(key => [key, p.modules[key]])),
    period: fields(p.period, ["label", "startDate", "endDate"]),
    kpis: fields(p.kpis, ["totalCustomers", "periodNewCustomers", "todayFollowUp", "overdueFollowUp", "sevenDayFollowUp", "periodNewContracts", "periodContractAmount", "periodPaidAmount", "periodUnpaidAmount", "periodShipments", "unpaidContracts", "partialPaidContracts"]),
    collection: fields(p.collection, ["totalContractAmount", "totalPaidAmount", "totalUnpaidAmount", "collectionRate", "targetConfigured", "targetAmount", "actualAmount", "targetRate", "targetVisualRate", "remainingAmount", "exceededAmount", "exceeded"]),
    delivery: {
      summary: fields(p.delivery.summary, ["shipmentCount", "unitCount", "regionCount", "todayDue", "sevenDayDue", "overdueDue"]),
      ...(p.delivery.regionUnits === undefined ? {} : { regionUnits: p.delivery.regionUnits.map(r => fields(r, ["province", "shipmentCount", "unitCount"])) }),
      ...(p.delivery.unresolvedRegionTotals === undefined ? {} : { unresolvedRegionTotals: fields(p.delivery.unresolvedRegionTotals, ["shipmentCount", "unitCount"]) }),
      ...(p.delivery.routesTotal === undefined ? {} : { routesTotal: p.delivery.routesTotal }),
      ...(p.delivery.milestonesTotal === undefined ? {} : { milestonesTotal: p.delivery.milestonesTotal }),
      routes: p.delivery.routes.map(r => fields(r, ["key", "province", "city", "centerLat", "centerLng", "equipmentName", "equipmentModel", "shipmentDate", "unitCount"])),
      reminders: { ...fields(p.delivery.reminders, ["todayTotal", "sevenDaysTotal", "overdueTotal"]),
        today: p.delivery.reminders.today.map(r => fields(r, ["key", "contractNumber", "equipmentName", "equipmentModel", "estimatedShipmentDate", "province", "city"])),
        sevenDays: p.delivery.reminders.sevenDays.map(r => fields(r, ["key", "contractNumber", "equipmentName", "equipmentModel", "estimatedShipmentDate", "province", "city"])),
        overdue: p.delivery.reminders.overdue.map(r => fields(r, ["key", "contractNumber", "equipmentName", "equipmentModel", "estimatedShipmentDate", "province", "city"])),
      },
      milestones: p.delivery.milestones.map(m => fields(m, ["key", "contractNumber", "equipmentName", "equipmentModel", "shipmentDate", "shipmentStatus", "unitCount"])),
    },
  };
}
