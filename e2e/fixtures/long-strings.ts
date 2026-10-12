import { buildMockScreenPayload } from "../../src/lib/mock";
import { toPublicScreenPayload } from "../../src/lib/public-screen-payload";
export const LONG_CUSTOMER = "新疆维吾尔自治区乌鲁木齐经济技术开发区重型精密数控机床装备制造股份有限公司";
export const LONG_MODEL = "BK5032-IIIA/CNC-FANUC-0i-TF-PLUS";
export const LONG_ANSWER = "本月交付进度正在稳步推进，数控插床与数控插齿机按计划发往各区域。请结合发运台账查看设备型号、数量和日期；没有提供的数据不会推测。".repeat(5);
// Public payload contains no customer names. Test the synthetic customer label separately.
export function longScreenPayload(amount: number, rows: number) {
  const p = toPublicScreenPayload(buildMockScreenPayload());
  p.dashboard.stats.periodContractAmount = amount;
  p.dashboard.stats.totalUnpaidAmount = amount;
  const source = p.dashboard.shipmentPaths[0];
  p.dashboard.shipmentPaths = Array.from({length: rows}, (_,i) => ({ ...source, id:`long-${i}`, contract:{ ...source.contract, equipmentName:LONG_MODEL, equipmentModel:LONG_MODEL, customer:{region:["内蒙古自治区","广西壮族自治区","新疆维吾尔自治区"][i%3]} } }));
  for (const key of ["today","sevenDays","overdue"] as const) {
    const row = p.dashboard.shipmentReminders[key][0] ?? p.dashboard.shipmentReminders.sevenDays[0];
    p.dashboard.shipmentReminders[key] = Array.from({length:rows},(_,i)=>({...row,id:`${key}-${i}`,contractNo:`LONG-${i}-2026`,equipmentName:LONG_MODEL,equipmentModel:LONG_MODEL}));
  }
  return p;
}
