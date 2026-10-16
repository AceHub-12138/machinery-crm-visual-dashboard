export const STALE_AFTER_MS = 10 * 60_000;
export const UNAVAILABLE_AFTER_MS = 24 * 60 * 60_000;
export function freshness(generatedAt: string | null, now: number) {
  const at = generatedAt ? Date.parse(generatedAt) : NaN;
  if (!Number.isFinite(at)) return { state: "unavailable" as const, label: "数据暂不可用" };
  const age = Math.max(0, now - at);
  if (age > UNAVAILABLE_AFTER_MS) return { state: "unavailable" as const, label: "数据暂不可用" };
  const time = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  return age > STALE_AFTER_MS ? { state: "stale" as const, label: `数据更新于 ${time}` } : { state: "fresh" as const, label: "" };
}
