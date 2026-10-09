import {readFileSync} from "node:fs";
const fixture = JSON.parse(readFileSync(new URL("../services/voice-orchestrator/fixtures/public-sales-screen.json", import.meta.url),"utf8"));
import { buildIntentAnswer } from "../src/lib/voice/intent-answers";
import { validatePublicPayload, type PublicSalesScreenPayload } from "../src/lib/voice/public-payload";
import type { Intent } from "../src/lib/voice/intents";
export const CARD_INTENTS: Intent[] = ["sales_progress","target_rate","region_shipments","upcoming_shipments","new_customers","followup_todo","collection","unanswerable"];
const locations: Array<[string,number,number]> = [["广东省",113.3,23.1],["湖南省",113,28.2],["辽宁省",123.4,41.8],["上海市",121.5,31.2],["浙江省",120.2,30.3],["江苏省",118.8,32.1],["河南省",113.6,34.7],["河北省",114.5,38],["山东省",117,36.7],["福建省",119.3,26.1],["四川省",104.1,30.7],["湖北省",114.3,30.6],["安徽省",117.3,31.8],["江西省",115.9,28.7],["山西省",112.5,37.9],["陕西省",108.9,34.3],["贵州省",106.7,26.6],["云南省",102.7,25],["甘肃省",103.8,36.1],["青海省",101.8,36.6]];
export function task12Payload(variant: "normal" | "long" | "zero" | "exceeded"): PublicSalesScreenPayload {
  const p = structuredClone(validatePublicPayload(fixture));
  if (variant === "long") {
    p.period.label = "2026年9月" + "统计周期名称很长".repeat(12);
    p.delivery.routes = locations.map(([province, lng, lat], i) => ({...p.delivery.routes[0], key:String(i), province, centerLng:lng, centerLat:lat, unitCount:i+1}));
    p.delivery.summary = {...p.delivery.summary, regionCount:20, shipmentCount:20, unitCount:210};
    p.delivery.milestones = Array.from({length:15}, (_,i) => ({...p.delivery.milestones[0], key:String(i), equipmentName:"数控插齿机长型号名称".repeat(6), equipmentModel:`Y${i}型号` + "EXTRA".repeat(12), contractNumber:"CT-LONG-0000" + i}));
    p.kpis.totalCustomers = 999999999; p.kpis.periodNewCustomers = 999999999;
    p.kpis.todayFollowUp = 999999999; p.kpis.sevenDayFollowUp = 999999999; p.kpis.overdueFollowUp = 999999999;
  }
  if (variant === "zero") {
    for (const key of Object.keys(p.kpis)) (p.kpis as unknown as Record<string,unknown>)[key] = typeof (p.kpis as unknown as Record<string,unknown>)[key] === "number" ? 0 : "0.00";
    for (const key of Object.keys(p.collection)) (p.collection as unknown as Record<string,unknown>)[key] = typeof (p.collection as unknown as Record<string,unknown>)[key] === "number" ? 0 : typeof (p.collection as unknown as Record<string,unknown>)[key] === "boolean" ? false : "0.00";
    p.delivery.routes=[]; p.delivery.milestones=[]; p.delivery.summary={shipmentCount:0,unitCount:0,regionCount:0,todayDue:0,sevenDayDue:0,overdueDue:0};
  }
  if (variant === "exceeded") Object.assign(p.collection, {targetRate:180,targetVisualRate:100,actualAmount:"27000000.00",exceeded:true,exceededAmount:"12000000.00",remainingAmount:"0.00"});
  return p;
}
export function task12Card(intent: Intent, variant: "normal" | "long" | "zero" | "exceeded") {
  const card = buildIntentAnswer(intent, task12Payload(variant)).card;
  // Explicit design-spec string stress; these artificial cards test layout only.
  if (variant === "long") {
    const widest = "¥99,999.9万";
    if (card.kind === "target-progress") { card.spoken=card.spoken.replace(card.actualText,widest).replace(card.targetText,widest).replace(card.remainingText,widest); card.actualText=widest; card.targetText=widest; card.remainingText=widest; }
    if (card.kind === "completion-ring") { card.collectedText=widest; card.targetText=widest; card.remainingText=widest; }
    if (card.kind === "collection-split") { card.paidText=widest; card.unpaidText=widest; }
  }
  return card;
}
