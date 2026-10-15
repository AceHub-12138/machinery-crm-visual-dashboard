import { fromPublicSalesScreenPayload } from "./public-screen-payload";
import type { PublicScreenPayload } from "./public-screen-payload";
import type { PublicSalesScreenPayload } from "./voice/public-payload";

export type SnapshotConfig = { platformUrl: string; publicId: string };
/** Factory provides isolation per configured source, testable without production access. */
export function createSnapshotReader(fetcher: typeof fetch = fetch) {
  let lastGood: PublicScreenPayload | null = null;
  let lastKey = "";
  return async (config: SnapshotConfig | null) => {
    if (!config) return null;
    const key = `${config.platformUrl}/${config.publicId}`;
    if (key !== lastKey) { lastGood = null; lastKey = key; }
    try {
      const base = new URL(config.platformUrl);
      if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || !config.publicId) return null;
      const url = new URL(`/api/screen/sales/${encodeURIComponent(config.publicId)}`, base);
      const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(8000), redirect: "error" });
      if (!response.ok) return key === lastKey ? lastGood : null;
      const raw: unknown = await response.json();
      validateScreenSnapshot(raw);
      const next = fromPublicSalesScreenPayload(raw);
      if (key !== lastKey) return null;
      // Never regress to an older response during a concurrent refresh.
      if (!lastGood || Date.parse(next.generatedAt) >= Date.parse(lastGood.generatedAt)) lastGood = next;
      return lastGood;
    } catch { return key === lastKey ? lastGood : null; }
  };
}
/** Additional presentation fields omitted by the read-only voice validator. */
export function validateScreenSnapshot(raw: unknown): asserts raw is PublicSalesScreenPayload {
  const p = raw as PublicSalesScreenPayload;
  if (!p || !Number.isFinite(Date.parse(p.generatedAt)) || typeof p.displayNotice !== "boolean" || !p.period || !/^\d{4}-\d{2}-\d{2}$/.test(p.period.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(p.period.endDate) || !p.delivery || !Array.isArray(p.delivery.routes)) throw new Error("Invalid screen snapshot");
  const keys = new Set<string>();
  for (const row of p.delivery.routes) {
    if (!row || typeof row.key !== "string" || keys.has(row.key) || typeof row.province !== "string" || !(row.city === null || typeof row.city === "string") || !Number.isFinite(row.centerLat) || Math.abs(row.centerLat) > 90 || !Number.isFinite(row.centerLng) || Math.abs(row.centerLng) > 180 || typeof row.equipmentName !== "string" || typeof row.equipmentModel !== "string" || typeof row.shipmentDate !== "string" || !Number.isSafeInteger(row.unitCount)) throw new Error("Invalid screen route");
    keys.add(row.key);
  }
}
