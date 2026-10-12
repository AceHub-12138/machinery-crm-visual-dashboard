/** 原始负值保留在 payload；公开画面只呈现核对提示。 */
export const DATA_PENDING = "数据待核对";
export function hasNegativeMetric(...values: Array<number | string>) {
  return values.some(value => Number(value) < 0);
}
export function formatPercent(value: number, digits = 1, cap = false) {
  if (value < 0) return DATA_PENDING;
  return `${cap && value > 999 ? ">999" : value.toFixed(digits)}%`;
}

export function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function beijingParts(date: Date) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map(p => [p.type, p.value]));
}
export function formatLocalDate(date: Date) {
  const p = beijingParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}
export function formatClock(date: Date) {
  const p = beijingParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export function formatMoneyParts(value: number | string): { currency: string; number: string; unit: string } {
  if (typeof value === "string") {
    const match = /^(¥)?\s*(-?[\d,.]+)\s*(万|亿)?$/u.exec(value.trim());
    if (!match) return { currency: "", number: value, unit: "" };
    if (Number(match[2].replaceAll(",", "")) < 0) return { currency: "", number: DATA_PENDING, unit: "" };
    return { currency: match[1] ?? "", number: match[2], unit: match[3] ?? "" };
  }
  if (value < 0) return { currency: "", number: DATA_PENDING, unit: "" };
  const abs = Math.abs(value);
  if (abs >= 100000000) {
    return { currency: "¥", number: (value / 100000000).toLocaleString("zh-CN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }), unit: "亿" };
  }
  if (abs >= 10000) {
    return { currency: "¥", number: (value / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 1, minimumFractionDigits: 1 }), unit: "万" };
  }
  return { currency: "¥", number: value.toLocaleString("zh-CN", { maximumFractionDigits: 0 }), unit: "" };
}

export function formatMoney(value: number) {
  const { currency, number, unit } = formatMoneyParts(value);
  return `${currency}${number}${unit}`;
}

export function formatMoneyFull(value: number | string | null | undefined) {
  if (Number(value) < 0) return DATA_PENDING;
  return `¥${Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatShortDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const p = beijingParts(date);
  return `${p.month}-${p.day}`;
}

export function formatCount(value: number) {
  if (value < 0) return DATA_PENDING;
  return value.toLocaleString("zh-CN");
}
