export function calculateSalesTargetProgress(actualValue: unknown, targetValue: unknown) {
  const actual = Number(actualValue ?? 0);
  const target = Number(targetValue ?? 0);
  if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) {
    throw new Error("销售目标金额无效");
  }

  const completionRate = Number(((actual / target) * 100).toFixed(1));
  const exceeded = actual > target;
  return {
    actualAmount: actual.toFixed(2),
    targetAmount: target.toFixed(2),
    completionRate,
    visualRate: Math.max(0, Math.min(100, completionRate)),
    remainingAmount: Math.max(target - actual, 0).toFixed(2),
    exceededAmount: Math.max(actual - target, 0).toFixed(2),
    exceeded,
  };
}

export function currentMonthPeriod(now = new Date()) {
  const beijing = new Date(now.getTime() + 8 * 3600000);
  const year = beijing.getUTCFullYear();
  const month = beijing.getUTCMonth() + 1;
  return {
    type: "MONTH" as const,
    year,
    index: month,
    label: `${year}年${month}月`,
  };
}
