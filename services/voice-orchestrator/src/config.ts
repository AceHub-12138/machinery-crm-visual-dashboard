/**
 * 编排服务配置(plan §16.2 B/C)。
 *
 * 红线:LLM 模型与 key、平台 MCP key 全走环境变量,不落仓;
 * .env.local 由本模块读取(Node --env-file 在缺文件时会退出,这里自带
 * 宽松加载:文件不存在即全默认,不影响 fixture 主路径)。
 *
 * 迁移到平台(§16.2 B①)只改两个值:
 *   VOICE_PAYLOAD_MODE=http
 *   VOICE_PAYLOAD_URL=https://<platform-host>   VOICE_PAYLOAD_PUBLIC_ID=<id>
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VOICE_HUB_DEFAULT_PORT } from "../../../src/lib/voice/protocol.ts";

export type OrchestratorConfig = {
  port: number;
  /** hub 监听地址;安全审核后默认只绑本机回环,跨机须显式 VOICE_HUB_HOST=0.0.0.0 */
  host: string;
  /** 对话台/大屏令牌(首帧 hub.auth);要么都空(仅限回环),要么都设且 ≥16 字符、互不相同 */
  hubConsoleToken: string;
  hubScreenToken: string;
  /** Origin 白名单(逗号分隔,精确匹配);缺省仅允许本机来源 */
  hubAllowedOrigins: string[];
  hubMaxConnections: number;
  /** 预取数据源:fixture(默认) | http(平台) */
  payloadMode: "fixture" | "http";
  payloadUrl: string;
  payloadPublicId: string;
  fixturePath: string;
  /** 本地 LLM（OpenAI 兼容）。apiKey 为空 ⇒ 离线 scripted；model 必须显式配置 */
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  llmReasoningEffort: string;
  llmTimeoutMs: number;
  /** 平台 MCP(长尾兜底);默认关闭——视觉仓阶段无 Key(plan §16.2) */
  mcpEnabled: boolean;
  mcpUrl: string;
  mcpApiKey: string;
  /** MCP 工具白名单(逗号分隔;空 = 全部拒绝)。工具名/参数来自 LLM,
   * 问题是攻击者可控的(提示词注入),不能只依赖平台端只读 key。 */
  mcpToolWhitelist: string[];
  /** 打点 JSONL 落盘路径(空串 = 不落盘,只随 trace.turn 事件上报) */
  traceFile: string;
  /** asr.partial 逐字节奏(毫秒/字;仅为大屏视觉效果,上限内) */
  partialPaceMs: number;
  partialMaxTotalMs: number;
  /** 每连接提问限流:最小间隔与滑动窗口上限 */
  questionMinGapMs: number;
  questionWindowMs: number;
  questionWindowMax: number;
  prefetchTimeoutMs: number;
  voiceLocalUrl: string;
  ttsEnabled: boolean;
  ttsStyle: string;
  ttsCacheDir: string;
  styleOverrides: Record<string, string>;
  inputConfig: { hangoverMs: number; micReopenDelayMs: number; kwsThreshold: number; kwsScore: number; kwsEnergy: number; wakePhrase: string };
};

export function loadEnvFileExplicit(dir: string, names = [".env.local", ".env"]): void {
  for (const name of names) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  return {
    port: int(env.VOICE_HUB_PORT, VOICE_HUB_DEFAULT_PORT),
    host: env.VOICE_HUB_HOST ?? "127.0.0.1",
    hubConsoleToken: env.VOICE_HUB_CONSOLE_TOKEN ?? "",
    hubScreenToken: env.VOICE_HUB_SCREEN_TOKEN ?? "",
    hubAllowedOrigins: splitList(env.VOICE_HUB_ALLOWED_ORIGINS),
    hubMaxConnections: int(env.VOICE_HUB_MAX_CONNECTIONS, 32),
    payloadMode: env.VOICE_PAYLOAD_MODE === "http" ? "http" : "fixture",
    payloadUrl: env.VOICE_PAYLOAD_URL ?? "",
    payloadPublicId: env.VOICE_PAYLOAD_PUBLIC_ID ?? "",
    fixturePath: env.VOICE_FIXTURE_PATH ?? defaultFixturePath(),
    llmBaseUrl: env.VOICE_LLM_BASE_URL ?? "http://127.0.0.1:1234/v1",
    llmApiKey: env.VOICE_LLM_API_KEY ?? "",
    llmModel: env.VOICE_LLM_MODEL ?? "",
    llmReasoningEffort: env.VOICE_LLM_REASONING_EFFORT ?? "none",
    llmTimeoutMs: int(env.VOICE_LLM_TIMEOUT_MS, 8000),
    mcpEnabled: env.VOICE_MCP_ENABLED === "1" || env.VOICE_MCP_ENABLED === "true",
    mcpUrl: env.VOICE_MCP_URL ?? "",
    mcpApiKey: env.VOICE_MCP_API_KEY ?? "",
    mcpToolWhitelist: splitList(env.VOICE_MCP_TOOLS),
    traceFile: env.VOICE_TRACE_FILE ?? defaultTraceFile(),
    partialPaceMs: int(env.VOICE_PARTIAL_PACE_MS, 45),
    partialMaxTotalMs: int(env.VOICE_PARTIAL_MAX_MS, 1200),
    questionMinGapMs: int(env.VOICE_QUESTION_MIN_GAP_MS, 1500),
    questionWindowMs: int(env.VOICE_QUESTION_WINDOW_MS, 60_000),
    questionWindowMax: int(env.VOICE_QUESTION_WINDOW_MAX, 8),
    prefetchTimeoutMs: int(env.VOICE_PREFETCH_TIMEOUT_MS, 5000),
    voiceLocalUrl: env.VOICE_LOCAL_URL ?? "http://127.0.0.1:8810",
    ttsEnabled: env.VOICE_TTS_ENABLED === "1" || env.VOICE_TTS_ENABLED === "true",
    ttsStyle: env.VOICE_TTS_STYLE ?? "default",
    styleOverrides: parseStyles(env.VOICE_SPEECH_STYLE_MAP),
    inputConfig: { hangoverMs: Math.min(1500, int(env.VOICE_VAD_HANGOVER_MS, 500)), micReopenDelayMs: int(env.VOICE_MIC_REOPEN_DELAY_MS, 300), kwsThreshold: Math.min(1, int(env.VOICE_KWS_THRESHOLD, .25)), kwsScore: int(env.VOICE_KWS_SCORE, 1), kwsEnergy: int(env.VOICE_KWS_ENERGY, .01), wakePhrase: env.VOICE_WAKE_PHRASE ?? "你好，小川" },
    ttsCacheDir: env.VOICE_TTS_CACHE_DIR ?? join(serviceRoot(), "logs", "tts-cache"),
  };
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** 启动前暴露面校验(审核 H1):不通过即抛错,main.ts 负责退出 */
export function assertHubExposureSafe(
  cfg: Pick<OrchestratorConfig, "host" | "hubConsoleToken" | "hubScreenToken"> & { ttsEnabled?: boolean },
): void {
  const c = cfg.hubConsoleToken;
  const s = cfg.hubScreenToken;
  if (!c && !s) {
    if (cfg.ttsEnabled) throw new Error("VOICE_TTS_ENABLED requires both hub tokens for HTTP audio authentication");
    if (!isLoopbackHost(cfg.host)) {
      throw new Error(
        `VOICE_HUB_HOST=${cfg.host} 不是回环地址,必须同时设置 VOICE_HUB_CONSOLE_TOKEN 与 VOICE_HUB_SCREEN_TOKEN`,
      );
    }
    return;
  }
  if (!c || !s) throw new Error("VOICE_HUB_CONSOLE_TOKEN 与 VOICE_HUB_SCREEN_TOKEN 必须同时设置");
  if (c.length < 16 || s.length < 16) throw new Error("hub 令牌长度至少 16 个字符");
  if (c === s) throw new Error("对话台令牌与大屏令牌不能相同");
}

function int(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function serviceRoot(): string {
  // 本文件位于 services/voice-orchestrator/src/
  return join(import.meta.dirname ?? ".", "..");
}

function defaultFixturePath(): string {
  return join(serviceRoot(), "fixtures", "public-sales-screen.json");
}

function defaultTraceFile(): string {
  return join(serviceRoot(), "logs", "voice-trace.jsonl");
}

function parseStyles(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.entries(value).some(([k,v]) => !/^[a-z_]+$/.test(k) || typeof v !== "string" || !/^[a-z_]{1,32}$/.test(v))) throw new Error("Invalid VOICE_SPEECH_STYLE_MAP");
  return value;
}
