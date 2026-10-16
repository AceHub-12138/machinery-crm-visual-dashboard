import { describe, expect, it } from "vitest";
import { freshness, STALE_AFTER_MS, UNAVAILABLE_AFTER_MS } from "./freshness";
const at = Date.parse("2026-10-13T02:00:00Z");
describe("snapshot freshness", () => {
  it("keeps exact boundaries fresh/stale and changes only after threshold", () => {
    expect(freshness(new Date(at).toISOString(), at + STALE_AFTER_MS).state).toBe("fresh");
    expect(freshness(new Date(at).toISOString(), at + STALE_AFTER_MS + 1)).toEqual({ state: "stale", label: "数据更新于 10:00" });
    expect(freshness(new Date(at).toISOString(), at + UNAVAILABLE_AFTER_MS).state).toBe("stale");
    expect(freshness(new Date(at).toISOString(), at + UNAVAILABLE_AFTER_MS + 1)).toEqual({ state: "unavailable", label: "数据暂不可用" });
  });
  it("fails closed for invalid or missing timestamps and clamps future clock skew", () => {
    expect(freshness("bad", at).state).toBe("unavailable");
    expect(freshness(null, at).state).toBe("unavailable");
    expect(freshness(new Date(at + 1000).toISOString(), at).state).toBe("fresh");
  });
});
