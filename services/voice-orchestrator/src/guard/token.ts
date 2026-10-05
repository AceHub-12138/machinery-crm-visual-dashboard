/**
 * 常数时间令牌比较(审核 H1)。
 */

import { timingSafeEqual } from "node:crypto";

export function tokensMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length !== b.length) {
    // 长度不等也要做一次比较,避免时序侧信道泄露长度
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}
