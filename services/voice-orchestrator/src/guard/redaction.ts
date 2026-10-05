/**
 * 日志脱敏(plan §10.3;沿用 sales-screen step3 约定)。
 *
 * 红线:任何日志/打点/trace 落盘不得出现 publicId 与凭证类字段。
 *
 * 2026-09-28 安全审核后重写;2026-09-30 二次审核修复:
 * - 指标键(llmFirstToken/tokens…)不再被 "token" 包含匹配误伤(M2);
 * - 补 VOICE_*_KEY=、裸 Bearer、sk-…、URL user:pass@、URL ?token= 漏网(M3)。
 */

const SENSITIVE_KEY_FRAGMENTS = [
  "publicid",
  "apikey",
  "authorization",
  "accesstoken",
  "refreshtoken",
  "password",
  "passwd",
  "secret",
  "token",
  "credential",
  "cookie",
];

/** 指标类键名:含 "token" 字样但值是计数/耗时,不是凭证(审核 M2) */
const METRIC_KEY_ALLOWLIST = new Set([
  "llmfirsttoken",
  "tokens",
  "tokencount",
  "prompttokens",
  "completiontokens",
  "totaltokens",
  "maxtokens",
]);

const R = "[REDACTED]";

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, "");
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (METRIC_KEY_ALLOWLIST.has(normalized)) return false;
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/** 结构化记录脱敏:命中敏感键(不区分大小写、包含匹配,指标键除外)整字段打码(不改原对象)。 */
export function redactRecord<T>(record: T): T {
  return redactDeep(record) as T;
}

function redactDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDeep);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? R : redactDeep(item);
    }
    return out;
  }
  return value;
}

/** 自由文本脱敏。顺序有意义,不要调换。 */
export function redactText(text: string): string {
  let out = text;
  // ⓪ URL 查询参数:?token=… / &api_key=…(必须先于①:①会把整段 URL 当作一个值跳过)
  out = out.replace(/([?&])([^=&#\s]+)=([^&#\s]*)/g, (match, lead: string, key: string) =>
    isSensitiveKey(key) ? `${lead}${key}=${R}` : match,
  );
  // ① 键值对 / JSON 形态:键名可带引号、可带前缀(VOICE_LLM_API_KEY);值可带引号或 Bearer 前缀;已是 [REDACTED] 的值跳过(幂等)
  out = out.replace(
    /("?)([A-Za-z_][A-Za-z0-9_-]*)\1(\s*[=:]\s*)(?!\[REDACTED\])("[^"]*"|'[^']*'|(?:bearer\s+)?[^\s,;}&)\]]+)/gi,
    (match, quote: string, key: string, sep: string, value: string) => {
      if (!isSensitiveKey(key)) return match;
      const wrapped = value.startsWith('"') ? `"${R}"` : R;
      return `${quote}${key}${quote}${sep}${wrapped}`;
    },
  );
  // ② 裸 Bearer 凭证
  out = out.replace(/\bbearer\s+(?!\[REDACTED\])[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${R}`);
  // ③ 常见密钥值形态(无键名也打码)
  out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, R);
  // ④ URL 内嵌账号密码 scheme://user:pass@host
  out = out.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/]*@/gi, `$1${R}@`);
  // ⑤ URL 路径形态:/api/screen/sales/{publicId}
  out = out.replace(/\/api\/screen\/sales\/[A-Za-z0-9._~-]+/gi, `/api/screen/sales/${R}`);
  // ⑥ 自然语句里的 public id xxx
  out = out.replace(/\bpublic[\s_-]?id\s+(?!\[REDACTED\])[A-Za-z0-9._~-]+/gi, (m) => m.replace(/\S+$/, R));
  return out;
}
