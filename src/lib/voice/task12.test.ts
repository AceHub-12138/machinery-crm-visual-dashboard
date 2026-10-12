import { describe, it, expect } from "vitest";
import fixture from "../../../services/voice-orchestrator/fixtures/public-sales-screen.json";
import { buildIntentAnswer } from "./intent-answers";
import { buildBriefCard, buildRegionCard, buildCustomersShipmentsCard } from "./card-builders";
import { CARD_FOLLOWUPS, cardFollowups, shipmentPages, shipmentPageAt } from "./card-presentation";
import { classifyScriptedQuestion, type Intent } from "./intents";
import { isValidAnswerCard } from "./protocol";
import { buildInjectedContext, verifyAnswerNumbers } from "../../../services/voice-orchestrator/src/datasource/inject-context";
import { validatePublicPayload } from "./public-payload";
import { demoAnswerForCycle } from "./demo-script";
import { buildMockScreenPayload } from "../mock";
import { toPublicScreenPayload } from "../public-screen-payload";
import { overlayGeometry } from "./params";
const payload = validatePublicPayload(fixture);
const intents: Intent[] = ["sales_progress", "target_rate", "region_shipments", "upcoming_shipments", "new_customers", "followup_todo", "collection", "unanswerable"];

describe("Task 12 data contracts and boundaries", () => {
  it.each(intents)("%s produces a validated card and unchanged guarded speech", intent => {
    const answer = buildIntentAnswer(intent, payload);
    expect(isValidAnswerCard(answer.card)).toBe(true);
    expect(verifyAnswerNumbers(answer.spoken, buildInjectedContext(payload)).ok).toBe(true);
    expect(answer.sentences.length).toBeLessThanOrEqual(3);
    if (intent === "new_customers") expect(answer.spoken).toBe(buildBriefCard("", ["先生,本期新增客户 18 家。", "客户总数 286 家。"]).spoken);
    if (intent === "followup_todo") expect(answer.spoken).toBe(buildBriefCard("", ["先生,今日待跟进 9 项,七日内 21 项。", "其中逾期 6 项,建议优先处理。"]).spoken);
    if (intent === "collection") expect(answer.spoken).toBe("先生,累计回款率 57.4%,已回 ¥2,790.0万,未回 ¥2,072.0万。");
  });
  it("new fields reject missing values, NaN, negative counts, strings and out-of-bounds coordinates", () => {
    for (const intent of ["new_customers", "followup_todo", "collection"] as Intent[]) {
      const card = buildIntentAnswer(intent, payload).card;
      const fields = Object.keys(card).filter(k => !["kind", "title", "spoken"].includes(k));
      for (const field of fields) {
        const missing = { ...card } as Record<string, unknown>; delete missing[field];
        expect(isValidAnswerCard(missing)).toBe(false);
        for (const value of [null, {}, Infinity, NaN]) expect(isValidAnswerCard({...card, [field]: value})).toBe(false);
      }
    }
    const region = buildRegionCard(payload.delivery, payload.period.label);
    expect(isValidAnswerCard({...region, mapPoints: [{region: "广东", lng: 999, lat: 10}]})).toBe(false);
    expect(isValidAnswerCard({...region, other: {regions: -1, units: 0}})).toBe(false);
    expect(isValidAnswerCard({...buildIntentAnswer("new_customers", payload).card, newCustomers: "18"})).toBe(false);
    expect(isValidAnswerCard({...buildIntentAnswer("followup_todo", payload).card, today: -1})).toBe(false);
  });
  it("only supported followups are exposed; greeting, goodbye and unheard have no strip", () => {
    for (const questions of Object.values(CARD_FOLLOWUPS)) {
      expect(questions.length).toBe(2);
      for (const q of questions) expect(classifyScriptedQuestion(q)).not.toBe("unanswerable");
    }
    for (const intent of ["greeting", "chitchat_or_end"] as Intent[]) expect(cardFollowups(buildIntentAnswer(intent, payload).card)).toEqual([]);
    for (const q of cardFollowups(buildIntentAnswer("unanswerable", payload).card)) expect(classifyScriptedQuestion(q)).not.toBe("unanswerable");
    expect(cardFollowups(buildBriefCard("小川", ["抱歉先生,刚才没有听清,请再说一次。"]))).toEqual([]);
  });
  it("15 shipments form 3×5, 20 shipments preserve all overflow as a summary slot", () => {
    const long = { ...payload.delivery, milestones: Array.from({length: 20}, (_, i) => ({...payload.delivery.milestones[0], key: String(i)})) };
    const card = buildCustomersShipmentsCard(long, payload.period.label);
    const pages = shipmentPages(card.rows, card.omittedCount);
    expect(pages.map(p => p.length)).toEqual([5,5,5]);
    expect(pages[2][4]).toEqual({otherCount: 6});
    expect(card.rows).toHaveLength(14);
    expect(card.omittedCount).toBe(6);
    const fifteen = buildCustomersShipmentsCard({...long, milestones: long.milestones.slice(0,15)}, "本期");
    expect(shipmentPages(fifteen.rows, fifteen.omittedCount).map(p => p.length)).toEqual([5,5,5]);
    expect(fifteen.omittedCount).toBe(0);
    expect(shipmentPages([])).toEqual([[]]);
  });
  it("a sentence maps its page; extra pages fall back to 4s; all pages stay bounded", () => {
    expect(shipmentPageAt(2000,3,1,3)).toBe(1);
    expect(shipmentPageAt(8000,3,0,1)).toBe(2);
    expect(shipmentPageAt(0,3,1,2)).toBe(1);
    expect(shipmentPageAt(4000,3,1,2)).toBe(2);
    expect(shipmentPageAt(12000,3,null,1)).toBe(0);
  });
  it("20 provinces keep all map points while only top five ranked rows render", () => {
    const routes = Array.from({length:20}, (_,i) => ({...payload.delivery.routes[0], province: `省${i}`, unitCount:i+1}));
    const card = buildRegionCard({...payload.delivery, routes}, "本期");
    expect(card.mapPoints).toHaveLength(20); expect(card.rows).toHaveLength(5);
    expect(card.other).toEqual({regions:15, units:120});
    expect(isValidAnswerCard(card)).toBe(true);
  });
  it("demo cycles cover seven data templates in sequence using the screen's data", () => {
    const screen = toPublicScreenPayload(buildMockScreenPayload());
    const kinds = Array.from({length:7}, (_,i) => demoAnswerForCycle(screen,i).card.kind);
    expect(new Set(kinds).size).toBe(7);
    expect(demoAnswerForCycle(screen,7).card).toEqual(demoAnswerForCycle(screen,0).card);
    const altered = structuredClone(screen); altered.dashboard.stats.periodNewCustomers = 77;
    expect(demoAnswerForCycle(altered,4).card).toMatchObject({kind:"customer-kpi", newCustomers:77});
  });
  it("answer geometry scales both widths and upper core position at 720p", () => {
    const full = overlayGeometry(1920,1080,"answering",true);
    expect(full.core).toEqual({x:960,y:225}); expect(full.cardAnchor).toEqual({x:960,y:300,width:1040});
    const small = overlayGeometry(1280,720,"followup");
    expect(small.core.y).toBe(150); expect(small.scale).toBeCloseTo(2/3);
    expect(small.cardAnchor.width).toBeCloseTo(880*2/3);
    expect(overlayGeometry(1920,1080,"closing").core.y).toBe(470);
  });
});
