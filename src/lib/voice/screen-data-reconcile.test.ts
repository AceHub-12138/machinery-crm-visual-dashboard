import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import fixture from "../../../services/voice-orchestrator/fixtures/public-sales-screen.json";
import { validatePublicPayload } from "./public-payload";
import { buildIntentAnswer } from "./intent-answers";
import { buildRegionCard } from "./card-builders";
import { ShipmentPageClock, displayRate } from "./card-presentation";
import { isValidAnswerCard } from "./protocol";
import { fromPublicSalesScreenPayload, toPublicScreenPayload } from "../public-screen-payload";
import { buildMockScreenPayload } from "../mock";
import { formatClock, formatShortDate } from "../format";
import { KpiRail } from "../../components/screen/KpiRail";
import { TargetRing } from "../../components/screen/TargetRing";
import { DeliveryMilestones } from "../../components/screen/DeliveryMilestones";
import { ProgressCard } from "../../components/overlay/cards/ProgressCard";
import { CompletionRingCard } from "../../components/overlay/cards/CompletionRingCard";
import { buildInjectedContext, verifyAnswerNumbers } from "../../../services/voice-orchestrator/src/datasource/inject-context";

const payload = () => validatePublicPayload(structuredClone(fixture));
describe("屏幕与语音同源口径", () => {
  it("累计回款率采用接口值，本期实收与新合同欠款分别显示，实际不取旧目标零值", () => {
    const p = payload(); p.collection.collectionRate = 74.1;
    p.kpis.periodContractAmount = "100000"; p.kpis.periodPaidAmount = "150000"; p.kpis.periodUnpaidAmount = "80000";
    p.collection.actualAmount = "0";
    const screen = fromPublicSalesScreenPayload(p);
    const html = renderToStaticMarkup(createElement(KpiRail, { stats: screen.dashboard.stats, targetAmount: Number(p.collection.targetAmount), collection: screen.business!.collection }));
    expect(html).toContain("74.1%"); expect(html).toContain("累计回款率");
    expect(html).toContain("本期实际回款"); expect(html).toContain("本期新合同欠款");
    const answer = buildIntentAnswer("sales_progress", p);
    expect(answer.card).toMatchObject({ actualText: "¥10.0万", paidText: "¥15.0万", newContractUnpaidText: "¥8.0万" });
    expect(answer.spoken).toContain("本期实际回款 ¥15.0万");
    expect(answer.spoken).toContain("本期新合同欠款 ¥8.0万");
    expect(renderToStaticMarkup(createElement(TargetRing, { stats: screen.dashboard.stats, targets: screen.salesTargets, periodLabel: p.period.label, collection: p.collection }))).toContain("74.1");
  });
  it("未设置目标不显示百分比或进度条，屏幕、两张语音卡及播报一致", () => {
    const p = payload(); p.collection.targetConfigured = false; p.collection.targetAmount = "0";
    const screen = fromPublicSalesScreenPayload(p);
    const html = renderToStaticMarkup(createElement(KpiRail, { stats: screen.dashboard.stats, targetAmount: 0, collection: p.collection }));
    expect(html).toContain("目标未设置"); expect(html).not.toContain("达成 0");
    for (const intent of ["sales_progress", "target_rate"] as const) {
      const answer = buildIntentAnswer(intent, p);
      expect(isValidAnswerCard(answer.card)).toBe(true);
      expect(answer.spoken).toContain("本月目标尚未设置"); expect(answer.spoken).not.toContain("0%");
      const cardHtml = answer.card.kind === "target-progress"
        ? renderToStaticMarkup(createElement(ProgressCard, { card: answer.card, barFillRef: { current: null } }))
        : answer.card.kind === "completion-ring" ? renderToStaticMarkup(createElement(CompletionRingCard, { card: answer.card })) : "";
      expect(cardHtml).toContain("目标未设置"); expect(cardHtml).not.toContain("progressbar"); expect(cardHtml).not.toContain("目标完成率");
    }
    const mock = buildMockScreenPayload(); mock.salesTargets.targets = [];
    expect(toPublicScreenPayload(mock).business!.collection.targetConfigured).toBe(false);
  });
  it("已有历史零元目标与未设置不同，负计数明确提示并保留数值", () => {
    const p = payload(); p.collection.targetConfigured = true; p.collection.targetAmount = "0";
    for (const intent of ["sales_progress", "target_rate"] as const) {
      const answer = buildIntentAnswer(intent, p);
      expect(answer.card).toMatchObject({ targetConfigured: true, targetAvailable: false });
      expect(answer.spoken).toContain("目标为零"); expect(answer.spoken).not.toContain("尚未设置");
      expect(isValidAnswerCard(answer.card)).toBe(true);
    }
    p.kpis.periodNewCustomers = -3;
    const answer = buildIntentAnswer("new_customers", p);
    expect(answer.card.kind).toBe("brief"); expect(answer.spoken).toContain("-3");
    expect(answer.spoken).toContain("核对"); expect(isValidAnswerCard(answer.card)).toBe(true);
  });
  it("全量区域与地图样本独立，地区待确认不增加省份数", () => {
    const p = payload();
    p.delivery.regionUnits = Array.from({ length: 6 }, (_, i) => ({ province: `省份${i}`, shipmentCount: 10 + i, unitCount: 100 - i * 10 }));
    p.delivery.unresolvedRegionTotals = { shipmentCount: 2, unitCount: 7 };
    p.delivery.summary = { ...p.delivery.summary, regionCount: 6, shipmentCount: 77, unitCount: 457 };
    p.delivery.routes = p.delivery.routes.slice(0, 1);
    const card = buildRegionCard(p.delivery, p.period.label);
    expect(card.rows.reduce((n, r) => n + r.units, 0) + card.other!.units + card.unresolved!.units).toBe(457);
    expect(card.other).toEqual({ regions: 1, units: 50 }); expect(card.mapPoints).toHaveLength(1);
    expect(card.spoken).toContain("地区待确认 7 台");
    expect(verifyAnswerNumbers(card.spoken, buildInjectedContext(p)).ok).toBe(true);
    expect(validatePublicPayload(p)).toBe(p);
    p.delivery.regionUnits[0].unitCount++;
    expect(() => validatePublicPayload(p)).toThrow("区域总量不一致");
  });
  it("旧接口未提供全量省份时提示待更新，不回退到样本求和", () => {
    const p = payload(); delete p.delivery.regionUnits; delete p.delivery.unresolvedRegionTotals;
    const card = buildRegionCard(p.delivery, p.period.label);
    expect(card.rows).toEqual([]); expect(card.summaryText).toContain("区域明细待更新");
  });
  it("超过999%的合法卡保留真实播报，只限制可见标签", () => {
    const p = payload(); p.collection.targetRate = 1234.5;
    for (const intent of ["sales_progress", "target_rate"] as const) {
      const answer = buildIntentAnswer(intent, p);
      expect(isValidAnswerCard(answer.card)).toBe(true); expect(answer.spoken).toContain("1234.5%");
    }
    expect(displayRate(1234.5)).toBe(">999%");
  });
  it("金额负数保留，倍率不在适配器重复应用，额外敏感字段不进HTML数据", () => {
    const p = payload(); p.kpis.periodUnpaidAmount = "-120000";
    Object.assign(p.kpis, { companyName: "secret name", multipliers: { amount: 3 } });
    Object.assign(p.collection, { contactName: "secret contact" });
    Object.assign(p.modules, { operatingKpis: true, contactName: "secret contact" });
    Object.assign(p.delivery.regionUnits![0], { phone: "secret phone" });
    const screen = fromPublicSalesScreenPayload(p);
    const json = JSON.stringify(screen);
    expect(screen.business!.modules).toMatchObject({ operatingKpis: true });
    expect(screen.dashboard.stats.periodUnpaidAmount).toBe(-120000);
    expect(screen.business!.kpis.periodContractAmount).toBe(p.kpis.periodContractAmount);
    for (const text of ["secret name", "secret contact", "secret phone", "multipliers"]) expect(json).not.toContain(text);
    expect(buildIntentAnswer("sales_progress", p).spoken).toContain("¥-12.0万");
  });
  it("里程碑样本与完整总数同为整单已发集合，不混入部分发运", () => {
    const screen = toPublicScreenPayload(buildMockScreenPayload());
    const partial = structuredClone(screen.dashboard.shipmentPaths[0]);
    partial.shipmentStatus = "PARTIAL_SHIPPED"; partial.contract.equipmentName = "仅部分发出的设备";
    partial.shipmentDate = "2099-01-01";
    const html = renderToStaticMarkup(createElement(DeliveryMilestones, { paths: [partial, ...screen.dashboard.shipmentPaths], delivery: screen.business!.delivery }));
    expect(html).not.toContain("仅部分发出的设备"); expect(html).toContain("展示总量");
  });
  it("北京时间月初、跨午夜和DATE显示不依赖运行时区", () => {
    expect(formatClock(new Date("2026-09-30T18:00:00Z"))).toBe("2026-10-01 02:00:00");
    expect(formatShortDate("2026-09-30T18:00:00Z")).toBe("10-01");
    expect(formatShortDate("2026-10-01T00:00:00Z")).toBe("10-01");
  });
});
describe("发运分页播放生命周期", () => {
  it("四秒翻页、暂停时冻结时间、恢复后继续，播完不复位或继续翻页", () => {
    const clock = new ShipmentPageClock(3, 1, 0);
    expect(clock.update(4000, null, false, false)).toBe(1);
    expect(clock.update(14000, null, true, false)).toBe(1);
    expect(clock.update(15000, null, false, false)).toBe(1);
    expect(clock.update(18000, null, false, false)).toBe(2);
    expect(clock.update(30000, null, false, true)).toBe(2);
    expect(clock.update(50000, null, false, true)).toBe(2);
  });
  it("句级边界同步，句间空隙不跳回第一页，播完停当前页", () => {
    const clock = new ShipmentPageClock(3, 3, 0);
    expect(clock.update(100, 0, false, false)).toBe(0);
    expect(clock.update(200, 1, false, false)).toBe(1);
    expect(clock.update(300, null, false, false)).toBe(1);
    expect(clock.update(400, null, false, true)).toBe(1);
  });
});
