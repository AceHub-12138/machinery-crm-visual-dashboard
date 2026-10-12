export function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function formatLocalDate(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatClock(date: Date) {
  return `${formatLocalDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function formatMoneyParts(value: number | string): { currency: string; number: string; unit: string } {
  if (typeof value === "string") {
    const match = /^(¥)?\s*(-?[\d,.]+)\s*(万|亿)?$/u.exec(value.trim());
    if (!match) return { currency: "", number: value, unit: "" };
    // Wire values are already formatted by the deterministic card builder.
    return { currency: match[1] ?? "", number: match[2], unit: match[3] ?? "" };
  }
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
  return `¥${Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatShortDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatCount(value: number) {
  return value.toLocaleString("zh-CN");
}
