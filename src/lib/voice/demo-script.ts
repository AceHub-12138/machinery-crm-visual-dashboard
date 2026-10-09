/**
 * 8a 脚本回放数据(plan §11:不依赖语音和 MCP,循环演示全流程)。
 *
 * 文案复用 scripts/voice-bakeoff/lines.json 的统一文案(唤醒/追问/告别/降级);
 * 数据句不复用 id=2 的固定数字,而是从 mock 口径(target.ts)现场推导——
 * 与答案卡、基线大屏永远同源(plan §7 数据一致性红线)。
 *
 * Task 12: seven data templates rotate by cycle. Error recovery stays covered
 * by live integration tests, while unattended demos display supported data.
 */

import { formatMoney } from "../format.ts";
import { calculateSalesTargetProgress } from "../target.ts";
import { synthAmplitude, synthSpeechAmplitude } from "./params.ts";
import type { AnswerCardData } from "./session-machine.ts";
import type { PublicScreenPayload } from "../public-screen-payload.ts";
import type { PublicSalesScreenPayload } from "./public-payload.ts";
import { buildIntentAnswer } from "./intent-answers.ts";
import { classifyScriptedQuestion } from "./intents.ts";
import { DEMO_QUESTIONS } from "./demo-questions.ts";

export const DEMO_LINES = {
  wake: "我在,先生。请讲。", // lines.json #1
  followup: "先生,还有其他问题需要我帮您处理吗?", // #5
  decline: "为您服务是我的荣幸,先生。", // #6
  fallback: "抱歉先生,数据暂时无法调取,请稍后再试。", // #7
} as const;

export const DEMO_QUESTION = "本月销售情况怎么样?";

/** 演示驱动节奏(全部参数化;与状态机规格常量解耦)。 */
export const DEMO_TIMING = {
  /** 基线停留(两轮之间) */
  ambientHoldMs: 2200,
  /** listening 收音时长 */
  listenMs: 2800,
  /** ASR 逐字间隔 */
  partialStepMs: 130,
  /** 正常轮:thinking 时长 */
  thinkOkMs: 1700,
  /** 降级轮:压缩版思考超时(真机 8000) */
  thinkTimeoutMs: 3200,
  /** 播报完到追问的持卡时长 */
  answerHoldMs: 4200,
  followupPromptMs: 2400,
  idleExitMs: 1800,
  /** 降级话术播报时长 */
  errorHoldMs: 3200,
  /** 退场渐隐接回基线(≥方案 500ms 过渡) */
  exitFadeMs: 520,
} as const;

/** Demo answers derive from the displayed public screen, rather than a second fixture. */
export function demoAnswerForCycle(screen: PublicScreenPayload, cycle: number) {
  if (screen.business) {
    const question = DEMO_QUESTIONS[((cycle % 7) + 7) % 7].question;
    return { question, ...buildIntentAnswer(classifyScriptedQuestion(question), screen.business) };
  }
  const stats = screen.dashboard.stats;
  const target = screen.salesTargets.targets.find(t => t.salesUserId === null);
  const progress = calculateSalesTargetProgress(target?.actualAmount ?? 0, target?.amount ?? 0);
  const routes = screen.map.routes;
  const paths = screen.dashboard.shipmentPaths;
  const payload: PublicSalesScreenPayload = {
    version: 1, generatedAt: screen.generatedAt, displayNotice: false, modules: {},
    period: { label: screen.salesTargets.period.label, startDate: screen.dashboard.range.startDate, endDate: screen.dashboard.range.endDate },
    kpis: { ...stats, periodContractAmount: String(stats.periodContractAmount), periodPaidAmount: String(stats.periodPaidAmount), periodUnpaidAmount: String(stats.periodUnpaidAmount) },
    collection: { totalContractAmount: String(stats.totalContractAmount), totalPaidAmount: String(stats.totalPaidAmount), totalUnpaidAmount: String(stats.totalUnpaidAmount),
      collectionRate: stats.totalContractAmount > 0 ? Number((stats.totalPaidAmount / stats.totalContractAmount * 100).toFixed(1)) : 0,
      targetAmount: progress.targetAmount, actualAmount: progress.actualAmount, targetRate: progress.completionRate, targetVisualRate: progress.visualRate,
      remainingAmount: progress.remainingAmount, exceededAmount: progress.exceededAmount, exceeded: progress.exceeded },
    delivery: {
      summary: { shipmentCount: screen.map.shipmentCount, unitCount: paths.reduce((sum, p) => sum + p.quantity, 0), regionCount: screen.map.coverageProvinces.length,
        todayDue: stats.todayShipmentDue, sevenDayDue: stats.sevenDayShipmentDue, overdueDue: stats.overdueShipmentDue },
      routes: routes.filter(r => r.destination.lng !== undefined && r.destination.lat !== undefined).map(r => ({ key: r.id, province: r.region, city: r.city,
        centerLng: r.destination.lng!, centerLat: r.destination.lat!, equipmentName: r.equipmentName, equipmentModel: "", shipmentDate: paths.find(p => p.id === r.id)?.shipmentDate ?? "", unitCount: paths.find(p => p.id === r.id)?.quantity ?? 0 })),
      reminders: { today: [], sevenDays: [], overdue: [] },
      milestones: paths.map(p => ({ key: p.id, contractNumber: routes.find(r => r.id === p.id)?.contractNo ?? null, equipmentName: p.equipmentName,
        equipmentModel: p.contract.equipmentModel, shipmentDate: p.shipmentDate, shipmentStatus: p.shipmentStatus, unitCount: p.quantity })),
    },
  };
  const question = DEMO_QUESTIONS[((cycle % 7) + 7) % 7].question;
  return { question, ...buildIntentAnswer(classifyScriptedQuestion(question), payload) };
}

/** 目标进度卡(首个精做模板):数据只从 payload 的公司目标行推导。 */
export function buildTargetProgressCard(
  targets: Array<{ salesUserId: string | null; amount: string; actualAmount: string | null }>,
  periodLabel: string,
): AnswerCardData {
  const company = targets.find((item) => item.salesUserId === null);
  const progress = calculateSalesTargetProgress(company?.actualAmount ?? 0, company?.amount ?? 0);

  const actualText = formatMoney(Number(progress.actualAmount));
  const targetText = formatMoney(Number(progress.targetAmount));
  const remainingText = progress.exceeded
    ? `已超额 ${formatMoney(Number(progress.exceededAmount))}`
    : formatMoney(Number(progress.remainingAmount));

  return {
    kind: "target-progress",
    title: `${periodLabel} · 合同额目标进度`,
    actualText,
    targetText,
    remainingText,
    completionRate: progress.completionRate,
    targetConfigured: company !== undefined,
    targetAvailable: company !== undefined && Number(company.amount) > 0,
    spoken: `先生,${periodLabel}合同额 ${actualText},完成月度目标的 ${progress.completionRate}%,${progress.exceeded ? remainingText : `距离目标还差 ${remainingText}`}。`,
  };
}

/** 按状态给一段合成振幅曲线(8a 无麦克风;8c 换 AnalyserNode 数值源)。 */
export function demoAmplitude(name: string, since: number, nowMs: number): number {
  switch (name) {
    case "listening":
      return synthAmplitude(nowMs, 3);
    case "thinking":
      return 0.55 + 0.1 * synthAmplitude(nowMs, 5);
    case "answering":
      return synthSpeechAmplitude(nowMs - since, 7);
    case "waking":
      return synthAmplitude(nowMs, 1) * 0.6;
    default:
      return 0.35;
  }
}
