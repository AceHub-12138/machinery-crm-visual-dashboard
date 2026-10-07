/** 显示字符串 → 中文读法；保留显示口径，只转换读音，不重新计算业务数值。 */
const DIGITS = "零一二三四五六七八九";
const GROUP_UNITS = ["", "万", "亿", "万亿", "亿亿"];

function readGroup(value: number, useLiang: boolean): string {
  const units = ["千", "百", "十", ""];
  let text = "";
  let zero = false;
  for (let i = 0; i < 4; i++) {
    const divisor = 10 ** (3 - i);
    const digit = Math.floor(value / divisor) % 10;
    if (digit === 0) { if (text) zero = true; continue; }
    if (zero) text += "零";
    text += (useLiang && digit === 2 && i === 0 ? "两" : DIGITS[digit]) + units[i];
    zero = false;
  }
  return text;
}

function readInteger(raw: string, useLiang = true): string {
  const value = raw.replace(/^0+(?=\d)/, "");
  if (/^0+$/.test(value)) return "零";
  // 超出数量读法范围时逐字读，不经 Number 转换而损失精度。
  if (value.length > GROUP_UNITS.length * 4) return [...value].map((d) => DIGITS[Number(d)]).join("");
  const groups: number[] = [];
  for (let end = value.length; end > 0; end -= 4) groups.push(Number(value.slice(Math.max(0, end - 4), end)));
  let text = "";
  let skipped = false;
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i];
    if (group === 0) { if (text) skipped = true; continue; }
    if (text && (skipped || group < 1000)) text += "零";
    text += (useLiang && group === 2 && i > 0 ? "两" : readGroup(group, useLiang)) + GROUP_UNITS[i];
    skipped = false;
  }
  return text.replace(/^一十/, "十");
}

function readNumber(raw: string, trimFractionZeros = false, useLiang = true): string {
  const negative = raw.startsWith("-");
  const [integer, originalFraction] = raw.replace(/^[+-]/, "").split(".");
  const fraction = trimFractionZeros ? originalFraction?.replace(/0+$/, "") : originalFraction;
  return (negative ? "负" : "") + readInteger(integer, useLiang && !fraction) +
    (fraction ? `点${[...fraction].map((digit) => DIGITS[Number(digit)]).join("")}` : "");
}

export function normalizeSpokenText(display: string): string {
  let text = display.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "");
  // ISO 日期保留年份，防止跨年缓存的日期产生歧义；短日期按月日读。
  text = text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, year: string, month: string, day: string) =>
    `${[...year].map((d) => DIGITS[Number(d)]).join("")}年${readInteger(month)}月${readInteger(day)}日`);
  text = text.replace(/(?<![\d-])(\d{2})-(\d{2})(?![\d-])/g, (_, month: string, day: string) =>
    `${readInteger(month)}月${readInteger(day)}日`);
  text = text.replace(/(?<!\d)(\d{4})年/g, (_, year: string) => `${[...year].map((d) => DIGITS[Number(d)]).join("")}年`);
  text = text.replace(/[¥￥]\s*(-?\d+(?:\.\d+)?)(亿|万)?(?:元)?/g, (_, value: string, unit: string | undefined) => {
    const twoUnits = /^(-?)2(?:\.0+)?$/.exec(value);
    return `${twoUnits && unit ? `${twoUnits[1] ? "负" : ""}两` : readNumber(value, true)}${unit ?? ""}元`;
  });
  text = text.replace(/(-?\d+(?:\.\d+)?)\s*[%％]/g, (_, value: string) =>
    value.startsWith("-") ? `负百分之${readNumber(value.slice(1), false, false)}` : `百分之${readNumber(value, false, false)}`);
  text = text.replace(/-?\d+(?:\.\d+)?/g, (value, offset: number, source: string) => {
    const ordinal = source[offset - 1] === "第";
    const following = source.slice(offset + value.length);
    if (!ordinal && value === "2" && /^\s*(?:台|家|项|个|条|件|天|周|次|位|名|人|种|批|份|套|千|万|亿)/.test(following)) return "两";
    return readNumber(value, false, !ordinal && !value.includes("."));
  });
  return text.replace(/\s+/g, "");
}

export type SpokenSentence = {
  index: number;
  text: string;
  spokenText: string;
  /** JS 字符串 UTF-16 偏移，displayEnd 为开区间。 */
  displayStart: number;
  displayEnd: number;
};

/** 不以小数点切句；显示偏移始终对应未经归一化的原文。 */
export function buildSpokenSentences(display: string): SpokenSentence[] {
  const sentences: SpokenSentence[] = [];
  const pattern = /[^。！？!?]+[。！？!?]*|[。！？!?]+/g;
  for (const match of display.matchAll(pattern)) {
    if (!match[0].trim()) continue;
    sentences.push({
      index: sentences.length, text: match[0], spokenText: normalizeSpokenText(match[0]),
      displayStart: match.index!, displayEnd: match.index! + match[0].length,
    });
  }
  return sentences;
}
