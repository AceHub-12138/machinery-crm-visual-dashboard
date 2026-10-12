import {formatCount} from "./format";
/** Temporary viewer wording; final semantics and copy are reviewed in Task 11. */
export function listingCopy(shown:number,total?:number) {
  return total===undefined ? `当前列出 ${formatCount(shown)} 条，完整记录请查看台账` : `当前列出 ${formatCount(shown)} 条，已收录 ${formatCount(total)} 条`;
}
export function audienceSummary(text:string) {
  return text.replace(/样本\s*(\d+)\s*\/\s*展示总量\s*(\d+)/gu,"当前列出 $1 条，已收录 $2 条").replace(/明细为样本/gu,"仅列出部分记录");
}
/** Accept only the existing masked public value; never invent an unmasked identifier. */
export function maskedContractTail(value:string|null|undefined) {
  return /^\*+(\d+)$/u.exec(value?.trim() ?? "")?.[1]?.slice(-4) ?? null;
}
export function cardContractTail(value:string) {
  return /^合同尾号\s*(\d+)$/u.exec(value.trim())?.[1]?.slice(-4) ?? null;
}
