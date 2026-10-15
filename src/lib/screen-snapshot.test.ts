import { describe, expect, it, vi } from "vitest";
import fixture from "../../services/voice-orchestrator/fixtures/public-sales-screen.json";
import { createSnapshotReader } from "./screen-snapshot";
const config = { platformUrl: "http://127.0.0.1:3199", publicId: "fixture-only" };
const response = (p: unknown) => new Response(JSON.stringify(p));
describe("whole shared snapshots", () => {
  it("does not use mock for missing config or failed first load", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    const read = createSnapshotReader(fetcher);
    expect(await read(null)).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
    expect(await read(config)).toBeNull();
  });
  it("retains last success on HTTP, network, malformed or older responses, then replaces the whole snapshot", async () => {
    const first = structuredClone(fixture), next = structuredClone(fixture);
    next.generatedAt = "2026-10-13T00:00:00Z"; next.kpis.totalCustomers = 999;
    const malformed = structuredClone(next); malformed.delivery.routes[0].centerLat = 999;
    const fetcher = vi.fn().mockResolvedValueOnce(response(first)).mockResolvedValueOnce(new Response("offline", { status: 503 })).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response(malformed)).mockResolvedValueOnce(response(next)).mockResolvedValueOnce(response(first));
    const read = createSnapshotReader(fetcher);
    const good = await read(config);
    expect(good?.source).toBe("public");
    for (let i = 0; i < 3; i++) expect(await read(config)).toBe(good);
    const replacement = await read(config);
    expect(replacement).not.toBe(good); expect(replacement?.business?.kpis.totalCustomers).toBe(999);
    expect(await read(config)).toBe(replacement);
    expect(fetcher.mock.calls[0][0].pathname).toBe("/api/screen/sales/fixture-only");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "error" });
  });
  it("never carries previous company's cached payload across configuration changes", async () => {
    const read = createSnapshotReader(vi.fn().mockResolvedValueOnce(response(fixture)).mockRejectedValue(new Error("offline")));
    expect(await read(config)).not.toBeNull();
    expect(await read({ ...config, publicId: "other" })).toBeNull();
  });
});
it("does not install an old source's in-flight response after a source change", async () => {
  let resolveFirst!: (response: Response) => void;
  const first = new Promise<Response>(resolve => { resolveFirst = resolve; });
  const fetcher = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(response(fixture));
  const read = createSnapshotReader(fetcher);
  const pending = read(config);
  const current = await read({ ...config, publicId: "another-fixture" });
  resolveFirst(response(fixture));
  expect(await pending).toBeNull(); expect(current?.source).toBe("public");
});
