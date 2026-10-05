import type { CrmDashboardStats, DashboardRange, MapPoint, SalesTargetItem, SalesTargetResponse, ScreenCrmPayload, ScreenMapRoute, ShipmentReminderItem, ShipmentPathItem } from "./types";

export type PublicReminder = Omit<ShipmentReminderItem, "customer">;
export type PublicRoute = Omit<ScreenMapRoute, "companyName" | "address">;
export type PublicShipment = Pick<ShipmentPathItem, "id" | "shipmentDate" | "shipmentStatus" | "equipmentName" | "quantity"> & {
  contract: { equipmentName: string; equipmentModel: string; customer: { region: string } };
};
export type PublicTarget = Omit<SalesTargetItem, "note" | "salesUserId"> & { salesUserId: null };
export type PublicScreenPayload = {
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
