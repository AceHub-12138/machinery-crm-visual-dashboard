import { describe, expect, it } from "vitest";
import fixture from "../../../services/voice-orchestrator/fixtures/public-sales-screen.json";
import { buildTargetProgressCard } from "./demo-script";
import {
  aggregateRegions,
  buildBriefCard,
  buildCompletionRingCard,
  buildCustomersShipmentsCard,
  buildRegionCard,
  buildTargetProgressCardFromPublic,
  clampAnswerText,
  VOICE_COVERAGE_FALLBACK,
} from "./card-builders";
import { isValidAnswerCard } from "./protocol";
import { validatePublicPayload } from "./public-payload";
import type { PublicSalesScreenPayload } from "./public-payload";
import { buildMockScreenPayload } from "@/lib/mock";
import { calculateSalesTargetProgress } from "@/lib/target";
import { formatMoney, formatShortDate } from "@/lib/format";

/** fixture JSON 经类型窄化(校验函数运行时再兜一层)。 */
const payload = validatePublicPayload(fixture) as PublicSalesScreenPayload;

/**
 * 口径一致性 diff 测试(plan §11 8b 验收:「答案数字与 /api/screen/crm 完全一致」)。
 *
 * 屏幕基线由 buildMockScreenPayload 驱动;语音卡片由 fixture(公开 payload 口径)
 * 驱动。两组数字必须能互相推导——任何一侧改数而另一侧未跟,这里直接红。
 */
describe("card-builders — 口径一致性 diff(fixture ↔ 屏幕基线)", () => {
  it("fixture 通过 fail-closed 结构校验", () => {
    expect(payload.version).toBe(1);
    expect(payload.kpis).toBeDefined();
    expect(payload.collection).toBeDefined();
    expect(payload.delivery).toBeDefined();
  });

  it("fixture 金额与 mock 大屏 stats 完全一致", () => {
    const mock = buildMockScreenPayload(new Date("2026-09-28T04:00:00.000Z"));
    expect(payload.kpis.periodContractAmount).toBe(mock.dashboard.stats.periodContractAmount.toFixed(2));
    expect(payload.kpis.periodPaidAmount).toBe(mock.dashboard.stats.periodPaidAmount.toFixed(2));
    expect(payload.kpis.periodUnpaidAmount).toBe(mock.dashboard.stats.periodUnpaidAmount.toFixed(2));
    expect(payload.collection.totalContractAmount).toBe(mock.dashboard.stats.totalContractAmount.toFixed(2));
    expect(payload.collection.totalPaidAmount).toBe(mock.dashboard.stats.totalPaidAmount.toFixed(2));
    expect(payload.collection.totalUnpaidAmount).toBe(mock.dashboard.stats.totalUnpaidAmount.toFixed(2));
    expect(payload.collection.targetAmount).toBe(Number(mock.salesTargets.targets[0].amount).toFixed(2));
    expect(payload.kpis.totalCustomers).toBe(mock.dashboard.stats.totalCustomers);
    expect(payload.kpis.periodNewCustomers).toBe(mock.dashboard.stats.periodNewCustomers);
    expect(payload.kpis.todayFollowUp).toBe(mock.dashboard.stats.todayFollowUp);
  });

  it("collection.targetRate == target.ts 对同一组数的计算", () => {
    const progress = calculateSalesTargetProgress(
      Number(payload.collection.actualAmount),
      Number(payload.collection.targetAmount),
    );
    expect(payload.collection.targetRate).toBe(progress.completionRate);
    expect(payload.collection.remainingAmount).toBe(progress.remainingAmount);
    expect(payload.collection.exceeded).toBe(progress.exceeded);
  });

  it("目标进度卡:公开口径构造 == 8a demo 构造(逐字段)", () => {
    const mock = buildMockScreenPayload(new Date("2026-09-28T04:00:00.000Z"));
    const fromDemo = buildTargetProgressCard(mock.salesTargets.targets, payload.period.label);
    const fromPublic = buildTargetProgressCardFromPublic(payload.collection, payload.period.label);
    expect(fromPublic).toEqual(fromDemo);
  });
});

describe("card-builders — 卡片数字 == payload 字段", () => {
  it("完成率环卡:环读数/差额逐字段来自 collection", () => {
    const card = buildCompletionRingCard(payload.collection, payload.period.label);
    expect(card.kind).toBe("completion-ring");
    expect(card.ratePercent).toBe(payload.collection.targetRate);
    expect(card.collectedText).toBe(formatMoney(Number(payload.collection.actualAmount)));
    expect(card.targetText).toBe(formatMoney(Number(payload.collection.targetAmount)));
    expect(card.remainingText).toBe(formatMoney(Number(payload.collection.remainingAmount)));
  });

  it("区域对比卡:行数据 == fixture.routes 独立重算", () => {
    const card = buildRegionCard(payload.delivery, payload.period.label);

    // 独立重算(不用 aggregateRegions):按省手工归并
    const tally = new Map<string, { shipments: number; units: number }>();
    let totalUnits = 0;
    for (const route of payload.delivery.routes) {
      const bucket = tally.get(route.province) ?? { shipments: 0, units: 0 };
      bucket.shipments += 1;
      bucket.units += route.unitCount;
      totalUnits += route.unitCount;
      tally.set(route.province, bucket);
    }
    const expected = [...tally.entries()]
      .map(([region, bucket]) => ({
        region,
        shipments: bucket.shipments,
        units: bucket.units,
        sharePercent: Number(((bucket.units / totalUnits) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.units - a.units || a.region.localeCompare(b.region, "zh-CN"));

    expect(card.rows).toEqual(expected.slice(0, 5));
    expect(aggregateRegions(payload.delivery.routes)).toEqual(expected);
    expect(card.summaryText).toBe(
      `覆盖 ${payload.delivery.summary.regionCount} 个省市 · ${payload.delivery.summary.shipmentCount} 车次 / ${payload.delivery.summary.unitCount} 台`,
    );
  });

  it("客户/发货卡:摘要计数 == summary，行 == milestones 最近 5 条", () => {
    const card = buildCustomersShipmentsCard(payload.delivery, payload.period.label);
    expect(card.summaryText).toBe(
      `今日到期 ${payload.delivery.summary.todayDue}` +
        ` · 七日内 ${payload.delivery.summary.sevenDayDue}` +
        ` · 逾期 ${payload.delivery.summary.overdueDue}`,
    );

    const latest = [...payload.delivery.milestones]
      .sort((a, b) => b.shipmentDate.localeCompare(a.shipmentDate))
      .slice(0, 5);
    expect(card.rows).toHaveLength(latest.length);
    card.rows.forEach((row, i) => {
      const milestone = latest[i];
      expect(row.equipmentText).toBe(`${milestone.equipmentName} ${milestone.equipmentModel}`);
      expect(row.detailText).toBe(`合同 ${milestone.contractNumber}`);
      expect(row.dateLabel).toBe(formatShortDate(milestone.shipmentDate));
    });
  });

  it("覆盖缺口兜底话术为固定原句(防幻觉红线)", () => {
    expect(VOICE_COVERAGE_FALLBACK).toBe("抱歉先生,我暂时无法调取这项数据。");
  });
  it("超额完成率不截成100%，超额话术不再说还差", () => {
    const collection = { ...payload.collection, targetRate: 110.2, exceeded: true, exceededAmount: "1530000.00", remainingAmount: "0.00" };
    const ring = buildCompletionRingCard(collection, payload.period.label);
    expect(ring.ratePercent).toBe(110.2);
    expect(ring.spoken).toContain("110.2%");
    for (const card of [ring, buildTargetProgressCardFromPublic(collection, payload.period.label)]) {
      expect(card.spoken).toContain("已超额 ¥153.0万");
      expect(card.spoken).not.toContain("还差");
      expect(isValidAnswerCard(card)).toBe(true);
    }
  });
  it("发货完整计数不受提醒样本数量影响", () => {
    const delivery = { ...payload.delivery, summary: { ...payload.delivery.summary, todayDue: 17, sevenDayDue: 25, overdueDue: 9 } };
    const card = buildCustomersShipmentsCard(delivery, payload.period.label);
    expect(card.summaryText).toBe("今日到期 17 · 七日内 25 · 逾期 9");
    expect(card.spoken).toContain("今日到期 17 台、逾期未发 9 台");
  });
});

describe("答案文本截断与卡片上限对齐(审核 第 8 步)", () => {
  it("clampAnswerText:短文本原样返回,超长截断并以 … 结尾", () => {
    expect(clampAnswerText("本月完成 62%")).toBe("本月完成 62%");
    const long = clampAnswerText("长".repeat(1000));
    expect(long.length).toBeLessThanOrEqual(280);
    expect(long.endsWith("…")).toBe(true);
  });

  it("buildBriefCard:LLM 超长回答装卡后仍能通过前端校验", () => {
    expect(isValidAnswerCard(buildBriefCard("小川", ["长".repeat(1000)]))).toBe(true);
    expect(isValidAnswerCard(buildBriefCard("小川", Array.from({ length: 30 }, () => "长".repeat(290))))).toBe(true);
  });

  it("fixture 生成的每种专用卡片都能通过前端校验", () => {
    const label = payload.period.label;
    const cards = [
      buildTargetProgressCardFromPublic(payload.collection, label),
      buildCompletionRingCard(payload.collection, label),
      buildRegionCard(payload.delivery, label),
      buildCustomersShipmentsCard(payload.delivery, label),
    ];
    for (const card of cards) expect(isValidAnswerCard(card)).toBe(true);
  });
});
