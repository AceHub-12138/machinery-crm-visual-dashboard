/**
 * 8b 验收问题集(plan §16.2 验收:「/voice-console 跑通 8 条问题全链路」)。
 *
 * 与 scripts/voice-bakeoff/lines.json 的关系:话术口语沿用其统一文案
 * (唤醒/追问/告别/降级四条非数据句直接复用);数据句在 8b 不再是
 * 固定台词,而是由注入口径现场生成——因此这里的 8 条是「问题」而非
 * 「答案」,每条声明预期模板,供对话台快捷键与验收断言使用。
 *
 * 覆盖矩阵:
 *   #1 target-progress  #2 completion-ring  #3 region  #4 customers-shipments
 *   #5~#7 brief(kpis / collection 兜底结论)   #8 覆盖缺口 → 降级话术(防幻觉)
 */

export type DemoQuestion = {
  id: number;
  question: string;
  /** 预期答案卡模板;覆盖缺口问题为 "unanswerable"(必降级) */
  expectCard: "target-progress" | "completion-ring" | "region" | "customers-shipments" | "brief" | "unanswerable";
  note: string;
};

export const DEMO_QUESTIONS: DemoQuestion[] = [
  {
    id: 1,
    question: "本月销售情况怎么样?",
    expectCard: "target-progress",
    note: "主模板:合同额目标进度(大额数字+进度条)",
  },
  {
    id: 2,
    question: "本月目标完成率是多少?",
    expectCard: "completion-ring",
    note: "完成率环卡:collection.targetRate / remainingAmount",
  },
  {
    id: 3,
    question: "各区域发货分布怎么样?",
    expectCard: "region",
    note: "区域对比卡:delivery.routes 按省聚合",
  },
  {
    id: 4,
    question: "近期有哪些发货安排?",
    expectCard: "customers-shipments",
    note: "客户/发货卡:delivery.milestones + reminders",
  },
  {
    id: 5,
    question: "本月新增了多少客户?",
    expectCard: "brief",
    note: "结论卡:kpis.periodNewCustomers / totalCustomers",
  },
  {
    id: 6,
    question: "今天有多少跟进待办?",
    expectCard: "brief",
    note: "结论卡:kpis.todayFollowUp / overdueFollowUp / sevenDayFollowUp",
  },
  {
    id: 7,
    question: "本月回款情况怎么样?",
    expectCard: "brief",
    note: "结论卡:collection.totalPaidAmount / collectionRate",
  },
  {
    id: 8,
    question: "华南退货率是多少?",
    expectCard: "unanswerable",
    note: "防幻觉红线:payload/MCP 均无退货数据,必须原句降级",
  },
];
