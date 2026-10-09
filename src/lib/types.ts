export type DashboardRange = {
  preset: string;
  start: string;
  end: string;
  startDate: string;
  endDate: string;
};

export type CrmDashboardStats = {
  totalCustomers: number;
  todayFollowUp: number;
  overdueFollowUp: number;
  sevenDayFollowUp: number;
  periodNewCustomers: number;
  periodNewContracts: number;
  periodContractAmount: number;
  periodPaidAmount: number;
  periodUnpaidAmount: number;
  periodShipments: number;
  totalContractAmount: number;
  totalPaidAmount: number;
  totalUnpaidAmount: number;
  unpaidContracts: number;
  partialPaidContracts: number;
  todayShipmentDue: number;
  sevenDayShipmentDue: number;
  overdueShipmentDue: number;
};

export type ShipmentReminderItem = {
  id: string;
  contractNo: string;
  estimatedShipmentDate: string;
  equipmentName: string;
  equipmentModel: string;
  customer: { id: string; companyName: string };
};

export type ShipmentPathItem = {
  id: string;
  receivingAddress: string;
  shipmentDate: string;
  shipmentStatus: "SHIPPED" | "PARTIAL_SHIPPED";
  equipmentName: string;
  quantity: number;
  contract: {
    id: string;
    contractNo: string;
    equipmentName: string;
    equipmentModel: string;
    customer: { id: string; companyName: string; region: string };
  };
  location: { lng: number; lat: number; address: string };
};

export type CrmDashboardResponse = {
  range: DashboardRange;
  filters: {
    province: string;
    region: string;
    salesUserId: string;
    customerStatus: string;
    contractStatus: string;
    shipmentStatus: string;
  };
  salesUsers: Array<{ id: string; name: string }>;
  stats: CrmDashboardStats;
  shipmentReminders: {
    today: ShipmentReminderItem[];
    sevenDays: ShipmentReminderItem[];
    overdue: ShipmentReminderItem[];
  };
  recentFollows: Array<{
    id: string;
    followType: string;
    content: string;
    createdAt: string;
    customer: { id: string; companyName: string };
    user: { name: string };
  }>;
  shipmentPaths: ShipmentPathItem[];
};

export type SalesTargetMetric = "CONTRACT_AMOUNT" | "PAID_AMOUNT";
export type SalesTargetPeriodType = "MONTH" | "YEAR";

export type SalesTargetItem = {
  id: string;
  periodType: SalesTargetPeriodType;
  periodYear: number;
  periodIndex: number;
  metric: SalesTargetMetric;
  amount: string;
  salesUserId: string | null;
  note: string | null;
  actualAmount: string | null;
  completionRate: number | null;
  visualRate: number | null;
  remainingAmount: string | null;
  exceededAmount: string | null;
  exceeded: boolean | null;
  updatedAt: string;
};

export type SalesTargetResponse = {
  period: { type: SalesTargetPeriodType; year: number; index: number; label: string };
  targets: SalesTargetItem[];
};

export type MapPoint = {
  x: number;
  y: number;
  lng: number;
  lat: number;
};

export type ScreenMapRoute = {
  id: string;
  status: ShipmentPathItem["shipmentStatus"];
  companyName: string;
  region: string;
  city: string;
  equipmentName: string;
  contractNo: string;
  address: string;
  origin: MapPoint;
  destination: MapPoint;
};

export type ScreenCrmPayload = {
  generatedAt: string;
  source: "mock" | "public";
  dashboard: CrmDashboardResponse;
  salesTargets: SalesTargetResponse;
  map: {
    factory: MapPoint & { name: string };
    routes: ScreenMapRoute[];
    coverageProvinces: string[];
    resolvedCount: number;
    shipmentCount: number;
  };
};
