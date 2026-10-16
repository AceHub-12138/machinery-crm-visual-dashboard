import { expect, it } from "vitest";
import { feedCity, latestRoutes } from "./feed-mask";
import fixture from "../../services/voice-orchestrator/fixtures/public-sales-screen.json";
const route = { ...fixture.delivery.routes[0], province: "广东省", city: "广州" };
it("counts orders rather than units across the entire route sample, including rows outside feed", () => {
  expect(feedCity({ ...route, unitCount: 99 }, [route])).toBe("华南 · 广东省");
  expect(feedCity(route, [route, { ...route, key: "2" }])).toBe("华南 · 广东省");
  expect(feedCity(route, [route, { ...route, key: "2" }, { ...route, key: "3" }])).toBe("华南 · 广东省 · 广州");
  expect(feedCity(route, [route, { ...route, province: "其他省" }, { ...route, province: "其他省" }])).toBe("华南 · 广东省");
  expect(feedCity({ ...route, city: null }, [route])).toBe("华南 · 广东省");
});
it("sorts newest five without mutating source and keeps linkage keys", () => {
  const routes = Array.from({ length: 7 }, (_, i) => ({ ...route, key: String(i), shipmentDate: `2026-10-0${i + 1}` }));
  expect(latestRoutes(routes).map(r => r.key)).toEqual(["6", "5", "4", "3", "2"]);
  expect(routes[0].key).toBe("0");
});
