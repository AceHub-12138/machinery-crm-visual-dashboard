export function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function formatLocalDate(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatClock(date: Date) {
  return `${formatLocalDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function formatMoney(value: number) {
  const abs = Math.abs(value);
  if (abs >= 100000000) {
    return `¥${(value / 100000000).toLocaleString("zh-CN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}亿`;
  }
  if (abs >= 10000) {
    return `¥${(value / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}万`;
  }
  return `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
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
