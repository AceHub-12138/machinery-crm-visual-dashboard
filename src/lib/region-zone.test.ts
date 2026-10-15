import { expect, it } from "vitest";
import { REGION_ZONES, regionZone } from "./region-zone";
it("maps all 34 provinces and regions exactly once into seven fixed zones", () => {
  const provinces = Object.values(REGION_ZONES).flat();
  expect(Object.keys(REGION_ZONES)).toHaveLength(7);
  expect(provinces).toHaveLength(34); expect(new Set(provinces).size).toBe(34);
  for (const [zone, rows] of Object.entries(REGION_ZONES)) for (const province of rows) expect(regionZone(province)).toBe(zone);
  expect(regionZone("广西壮族自治区")).toBe("华南"); expect(regionZone("新疆维吾尔自治区")).toBe("西北");
  expect(regionZone("地区未知")).toBe("地区待确认");
});
