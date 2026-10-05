import { describe, expect, it } from "vitest";
import {
  createDataSource,
  dataSourceError,
  FixturePayloadSource,
  HttpPayloadSource,
} from "../src/datasource/index.ts";
import { join } from "node:path";

const fixturePath = join(import.meta.dirname ?? ".", "..", "fixtures", "public-sales-screen.json");

describe("datasource — fixture 源(8b 默认)", () => {
  it("加载并校验通过", async () => {
    const source = new FixturePayloadSource(fixturePath);
    const payload = await source.fetchPayload();
    expect(payload.version).toBe(1);
    expect(payload.collection.targetRate).toBe(85.7);
    expect(payload.delivery.routes).toHaveLength(12);
  });

  it("文件缺失 → DataSourceError(code=datasource)", async () => {
    const source = new FixturePayloadSource("./no-such-file.json");
    await expect(source.fetchPayload()).rejects.toMatchObject({ code: "datasource" });
  });

  it("结构不合法 → fail-closed 拒绝", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "voice-fixture-"));
    const badPath = join(dir, "bad.json");
    await writeFile(badPath, JSON.stringify({ version: 2 }), "utf8");
    const source = new FixturePayloadSource(badPath);
    await expect(source.fetchPayload()).rejects.toMatchObject({ code: "datasource" });
  });
});

describe("datasource — http 源(平台迁移路径)", () => {
  const payload = JSON.stringify({
    version: 1,
    generatedAt: "t",
    displayNotice: false,
    modules: {},
    period: { label: "L", startDate: "a", endDate: "b" },
    kpis: { totalCustomers: 1, periodNewCustomers: 1, todayFollowUp: 1, overdueFollowUp: 1, sevenDayFollowUp: 1, periodNewContracts: 1, periodContractAmount: "1", periodPaidAmount: "1", periodUnpaidAmount: "1", periodShipments: 1, unpaidContracts: 1, partialPaidContracts: 1 },
    collection: { totalContractAmount: "1", totalPaidAmount: "1", totalUnpaidAmount: "1", collectionRate: 1, targetAmount: "1", actualAmount: "1", targetRate: 1, targetVisualRate: 1, remainingAmount: "1", exceededAmount: "1", exceeded: false },
    delivery: { summary: { shipmentCount: 0, unitCount: 0, regionCount: 0, todayDue: 0, sevenDayDue: 0, overdueDue: 0 }, routes: [], reminders: { today: [], sevenDays: [], overdue: [] }, milestones: [] },
  });

  function okFetch(body: string, status = 200): typeof fetch {
    return (async () => new Response(body, { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  }

  it("URL 模板:/api/screen/sales/{publicId}", async () => {
    let captured = "";
    const fetchImpl = (async (url: string) => {
      captured = url;
      return new Response(payload, { status: 200 });
    }) as unknown as typeof fetch;
    const source = new HttpPayloadSource("https://crm.example.com/", "pub-123", fetchImpl);
    const result = await source.fetchPayload();
    expect(result.version).toBe(1);
    expect(captured).toBe("https://crm.example.com/api/screen/sales/pub-123");
  });

  it("HTTP 500 → DataSourceError 带 status", async () => {
    const source = new HttpPayloadSource("https://crm.example.com", "pub-123", okFetch("boom", 500));
    const err = await source.fetchPayload().catch((e) => e);
    expect(err.code).toBe("datasource");
    expect(err.status).toBe(500);
  });

  it("JSON 结构不合法 → fail-closed", async () => {
    const source = new HttpPayloadSource("https://crm.example.com", "pub-123", okFetch('{"oops":1}'));
    await expect(source.fetchPayload()).rejects.toMatchObject({ code: "datasource" });
  });

  it("createDataSource:http 模式缺配置直接抛", () => {
    expect(() => createDataSource({ mode: "http", fixturePath: "", baseUrl: "", publicId: "" })).toThrowError();
    expect(dataSourceError("x").code).toBe("datasource");
  });
});
