import { chinaOutline, projectLonLat } from "@/lib/geo";
import { calculateSalesTargetProgress, currentMonthPeriod } from "@/lib/target";
import type {
  CrmDashboardResponse,
  ScreenCrmPayload,
  ScreenMapRoute,
  ShipmentPathItem,
  ShipmentReminderItem,
} from "@/lib/types";

const FACTORY = chinaOutline.factory;

const destinations: Array<{
  id: string;
  company: string;
  region: string;
  city: string;
  address: string;
  lon: number;
  lat: number;
  status: ShipmentPathItem["shipmentStatus"];
  equipment: string;
  model: string;
  contractNo: string;
  quantity: number;
  shipmentDate: string;
}> = [
  {
    id: "shp-sh",
    company: "上海精工传动有限公司",
    region: "上海市",
    city: "上海",
    address: "上海市闵行区紫竹科学园区",
    lon: 121.43,
    lat: 31.12,
    status: "SHIPPED",
    equipment: "数控插床",
    model: "BK5030",
    contractNo: "****0318",
    quantity: 2,
    shipmentDate: "2026-09-08",
  },
  {
    id: "shp-sz",
    company: "苏州重载装备股份公司",
    region: "江苏省",
    city: "苏州",
    address: "苏州市工业园区星湖街",
    lon: 120.73,
    lat: 31.32,
    status: "SHIPPED",
    equipment: "数控插齿机",
    model: "YK5120",
    contractNo: "****0281",
    quantity: 1,
    shipmentDate: "2026-09-04",
  },
  {
    id: "shp-nb",
    company: "宁波海工齿轮厂",
    region: "浙江省",
    city: "宁波",
    address: "宁波市镇海区临港装备园",
    lon: 121.60,
    lat: 29.95,
    status: "PARTIAL_SHIPPED",
    equipment: "插齿插键复合机床",
    model: "B5032",
    contractNo: "****0302",
    quantity: 2,
    shipmentDate: "2026-09-11",
  },
  {
    id: "shp-qd",
    company: "青岛港机制造集团",
    region: "山东省",
    city: "青岛",
    address: "青岛市黄岛区临港产业带",
    lon: 120.19,
    lat: 35.96,
    status: "SHIPPED",
    equipment: "数控键槽铣床",
    model: "X5032",
    contractNo: "****0276",
    quantity: 1,
    shipmentDate: "2026-08-29",
  },
  {
    id: "shp-wh",
    company: "武汉重型机床配套厂",
    region: "湖北省",
    city: "武汉",
    address: "武汉市东西湖区临空港",
    lon: 114.14,
    lat: 30.62,
    status: "SHIPPED",
    equipment: "数控插床",
    model: "BK5040",
    contractNo: "****0255",
    quantity: 1,
    shipmentDate: "2026-08-21",
  },
  {
    id: "shp-cd",
    company: "成都航发精密机械",
    region: "四川省",
    city: "成都",
    address: "成都市双流区西航港",
    lon: 103.95,
    lat: 30.57,
    status: "SHIPPED",
    equipment: "五轴加工中心",
    model: "DC-VMC650",
    contractNo: "****0219",
    quantity: 1,
    shipmentDate: "2026-08-12",
  },
  {
    id: "shp-sy",
    company: "沈阳机床配套协同中心",
    region: "辽宁省",
    city: "沈阳",
    address: "沈阳市铁西区装备制造园",
    lon: 123.40,
    lat: 41.79,
    status: "PARTIAL_SHIPPED",
    equipment: "数控插床",
    model: "BK5032",
    contractNo: "****0331",
    quantity: 2,
    shipmentDate: "2026-09-13",
  },
  {
    id: "shp-gz",
    company: "广州南沙船舶配件厂",
    region: "广东省",
    city: "广州",
    address: "广州市南沙区龙穴岛",
    lon: 113.53,
    lat: 22.77,
    status: "SHIPPED",
    equipment: "普通插床",
    model: "B5032",
    contractNo: "****0198",
    quantity: 3,
    shipmentDate: "2026-07-30",
  },
  {
    id: "shp-xa",
    company: "西安航天传动科技",
    region: "陕西省",
    city: "西安",
    address: "西安市高新区丈八一路",
    lon: 108.89,
    lat: 34.20,
    status: "SHIPPED",
    equipment: "数控插齿机",
    model: "YK5132",
    contractNo: "****0244",
    quantity: 1,
    shipmentDate: "2026-08-18",
  },
  {
    id: "shp-zz",
    company: "郑州矿山机械股份",
    region: "河南省",
    city: "郑州",
    address: "郑州市上街区铝城路",
    lon: 113.18,
    lat: 34.81,
    status: "SHIPPED",
    equipment: "数控键槽铣床",
    model: "X5040",
    contractNo: "****0268",
    quantity: 1,
    shipmentDate: "2026-08-26",
  },
  {
    id: "shp-cs",
    company: "长沙工程机械配套厂",
    region: "湖南省",
    city: "长沙",
    address: "长沙市望城区铜官循环经济园",
    lon: 112.82,
    lat: 28.36,
    status: "PARTIAL_SHIPPED",
    equipment: "数控插床",
    model: "BK5030",
    contractNo: "****0326",
    quantity: 2,
    shipmentDate: "2026-09-10",
  },
  {
    id: "shp-hrb",
    company: "哈尔滨动力装备集团",
    region: "黑龙江省",
    city: "哈尔滨",
    address: "哈尔滨市平房区哈南工业新城",
    lon: 126.62,
    lat: 45.59,
    status: "SHIPPED",
    equipment: "普通刨床",
    model: "B2016A",
    contractNo: "****0186",
    quantity: 1,
    shipmentDate: "2026-07-18",
  },
];

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00.000Z`;
}

function reminder(
  id: string,
  company: string,
  contractNo: string,
  equipmentName: string,
  equipmentModel: string,
  date: string,
): ShipmentReminderItem {
  return {
    id,
    contractNo,
    estimatedShipmentDate: date,
    equipmentName,
    equipmentModel,
    customer: { id: `cus-${id}`, companyName: company },
  };
}

export function buildMockScreenPayload(now = new Date()): ScreenCrmPayload {
  const shifted = new Date(now.getTime() + 8 * 3600000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const date = shifted.getUTCDate();
  const day = 86400000;
  const todayDate = Date.UTC(year, month, date);
  const dateLabel = (offset: number) => new Date(todayDate + offset * day).toISOString().slice(0, 10);
  const periodStart = new Date(Date.UTC(year, month, 1) - 8 * 3600000);
  const periodEnd = new Date(todayDate + day - 8 * 3600000);
  const today = dateLabel(0);
  const tomorrow = dateLabel(1);
  const inThree = dateLabel(3);
  const overdueA = dateLabel(-4);
  const overdueB = dateLabel(-9);

  const origin = projectLonLat(FACTORY.lon, FACTORY.lat);
  const shipmentPaths: ShipmentPathItem[] = destinations.map((item) => ({
    id: item.id,
    receivingAddress: item.address,
    shipmentDate: item.shipmentDate,
    shipmentStatus: item.status,
    equipmentName: item.equipment,
    quantity: item.quantity,
    contract: {
      id: `ct-${item.id}`,
      contractNo: item.contractNo,
      equipmentName: item.equipment,
      equipmentModel: item.model,
      customer: { id: `cus-${item.id}`, companyName: item.company, region: item.region },
    },
    location: { lng: item.lon, lat: item.lat, address: item.address },
  }));

  const routes: ScreenMapRoute[] = destinations.map((item) => ({
    id: item.id,
    status: item.status,
    companyName: item.company,
    region: item.region,
    city: item.city,
    equipmentName: `${item.equipment} ${item.model}`,
    contractNo: item.contractNo,
    address: item.address,
    origin,
    destination: projectLonLat(item.lon, item.lat),
  }));

  const dashboard: CrmDashboardResponse = {
    range: {
      preset: "month",
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      startDate: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
      endDate: today,
    },
    filters: {
      province: "",
      region: "",
      salesUserId: "",
      customerStatus: "",
      contractStatus: "",
      shipmentStatus: "",
    },
    salesUsers: [
      { id: "u-chen", name: "陈浩" },
      { id: "u-liu", name: "刘芳" },
      { id: "u-wang", name: "王磊" },
    ],
    stats: {
      totalCustomers: 286,
      todayFollowUp: 9,
      overdueFollowUp: 6,
      sevenDayFollowUp: 21,
      periodNewCustomers: 18,
      periodNewContracts: 11,
      periodContractAmount: 12860000,
      periodPaidAmount: 7420000,
      periodUnpaidAmount: 5440000,
      periodShipments: 7,
      // 累计口径必须自洽：已回 + 未回 = 合同额（4862 万 = 2790 万 + 2072 万），
      // 否则大屏上的回款率会算出与「已回/待回」互相矛盾的数字。
      totalContractAmount: 48620000,
      totalPaidAmount: 27900000,
      totalUnpaidAmount: 20720000,
      unpaidContracts: 8,
      partialPaidContracts: 14,
      todayShipmentDue: 2,
      sevenDayShipmentDue: 5,
      overdueShipmentDue: 3,
    },
    shipmentReminders: {
      today: [
        reminder("due-1", "无锡精密传动有限公司", "DC-2026-0342", "数控插床", "BK5030", today),
        reminder("due-2", "合肥液压件厂", "DC-2026-0338", "数控键槽铣床", "X5032", today),
      ],
      sevenDays: [
        reminder("due-3", "大连船舶齿轮厂", "DC-2026-0348", "数控插齿机", "YK5120", tomorrow),
        reminder("due-4", "太原重工配套中心", "DC-2026-0351", "数控插床", "BK5040", inThree),
        reminder("due-5", "南昌轨道交通装备", "DC-2026-0355", "普通插床", "B5032", inThree),
      ],
      overdue: [
        reminder("ov-1", "兰州石油机械厂", "DC-2026-0294", "数控插床", "BK5032", overdueA),
        reminder("ov-2", "包头矿用减速机厂", "DC-2026-0271", "数控插齿机", "YK5132", overdueB),
        reminder("ov-3", "徐州工程机械配套", "DC-2026-0288", "数控键槽铣床", "X5040", overdueB),
      ],
    },
    recentFollows: [
      {
        id: "fl-1",
        followType: "VISIT",
        content: "客户确认 BK5030 第二台交期，要求随车附带键槽铣选配方案。",
        createdAt: new Date(now.getTime() - 2 * 3600000).toISOString(),
        customer: { id: "cus-wx", companyName: "无锡精密传动有限公司" },
        user: { name: "陈浩" },
      },
      {
        id: "fl-2",
        followType: "CALL",
        content: "回款计划已对齐财务，本周五前支付第二笔 40%。",
        createdAt: new Date(now.getTime() - 5 * 3600000).toISOString(),
        customer: { id: "cus-hf", companyName: "合肥液压件厂" },
        user: { name: "刘芳" },
      },
      {
        id: "fl-3",
        followType: "QUOTE",
        content: "YK5120 外贸报价已发出，等待样品齿形确认。",
        createdAt: new Date(now.getTime() - 26 * 3600000).toISOString(),
        customer: { id: "cus-dl", companyName: "大连船舶齿轮厂" },
        user: { name: "王磊" },
      },
    ],
    shipmentPaths,
  };

  const period = currentMonthPeriod(now);
  const companyProgress = calculateSalesTargetProgress(12860000, 15000000);
  const chenProgress = calculateSalesTargetProgress(4620000, 5000000);

  return {
    generatedAt: now.toISOString(),
    source: "mock",
    dashboard,
    salesTargets: {
      period,
      targets: [
        {
          id: "tgt-company",
          periodType: "MONTH",
          periodYear: period.year,
          periodIndex: period.index,
          metric: "CONTRACT_AMOUNT",
          amount: "15000000.00",
          salesUserId: null,
          note: "全公司月度合同额目标",
          ...companyProgress,
          updatedAt: isoDate(period.year, period.index, 1),
        },
        {
          id: "tgt-chen",
          periodType: "MONTH",
          periodYear: period.year,
          periodIndex: period.index,
          metric: "CONTRACT_AMOUNT",
          amount: "5000000.00",
          salesUserId: "u-chen",
          note: null,
          ...chenProgress,
          updatedAt: isoDate(period.year, period.index, 1),
        },
      ],
    },
    map: {
      factory: { ...origin, name: FACTORY.name },
      routes,
      coverageProvinces: [...new Set(destinations.map((item) => item.region))],
      resolvedCount: routes.length,
      shipmentCount: shipmentPaths.length,
    },
  };
}
