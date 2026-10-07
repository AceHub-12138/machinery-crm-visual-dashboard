/** 8c 阶段 1–2 验收。原型的两条库存问题在本阶段必须降级。 */
import type { Intent } from "./intents.ts";

export const INTENT_CASES: Array<{ question: string; expected: Intent }> = [
  { question: "本月销售情况怎么样", expected: "sales_progress" },
  { question: "这个月卖得咋样", expected: "sales_progress" },
  { question: "目标完成了百分之多少", expected: "target_rate" },
  { question: "哪个省发的货最多", expected: "region_shipments" },
  { question: "最近几天有哪些设备要发出去", expected: "upcoming_shipments" },
  { question: "这个月来了几个新客户", expected: "new_customers" },
  { question: "今天还有多少客户没跟进", expected: "followup_todo" },
  { question: "钱收回来多少了", expected: "collection" },
  { question: "成品仓还有多少台", expected: "unanswerable" },
  { question: "有没有什么料快不够了", expected: "unanswerable" },
  { question: "华南退货率是多少", expected: "unanswerable" },
  { question: "利润是多少", expected: "unanswerable" },
  { question: "好的谢谢,没有了", expected: "chitchat_or_end" },
];
