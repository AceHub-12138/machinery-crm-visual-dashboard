/**
 * 编排服务入口(独立 Node 进程;零 npm 依赖,TS 直跑):
 *
 *   node --experimental-strip-types services/voice-orchestrator/src/main.ts
 *
 * 配置:环境变量或 services/voice-orchestrator/.env.local(不落仓,见
 * config.ts);LLM key 缺省时自动落到离线 scripted 适配器(8b 默认,
 * 供 /voice-console 全链路演示与验收)。
 *
 * 安全基线(2026-09-28 审核):默认只绑 127.0.0.1;Origin 仅本机来源
 * (VOICE_HUB_ALLOWED_ORIGINS 可放开);可选 VOICE_HUB_TOKEN;日志不落
 * payload URL 与任何凭证值。
 */

import { fileURLToPath } from "node:url";
import { assertHubExposureSafe, loadConfig, loadEnvFileExplicit } from "./config.ts";
import { startVoiceHub } from "./ws/ws-server.ts";
import { createDataSource } from "./datasource/index.ts";
import { createMcpClientIfEnabled } from "./datasource/platform-mcp.ts";
import { TraceSink } from "./trace/metrics.ts";
import { createVoiceOrchestrator } from "./orchestrator.ts";
import { ScriptedAdapter } from "./llm/scripted.ts";
import { OpenAiCompatibleAdapter } from "./llm/zhipu.ts";
import { AudioStore } from "./tts/audio-store.ts";
import { VoiceLocalClient } from "./tts/voice-local-client.ts";
import { createInputHttpHandler } from "./http-input.ts";
import { createAudioHttpHandler } from "./tts/http-audio.ts";
import { redactText } from "./guard/redaction.ts";

const serviceRoot = fileURLToPath(new URL("..", import.meta.url));
loadEnvFileExplicit(serviceRoot);
const config = loadConfig();

function log(message: string): void {
  // 单行出口;敏感字段脱敏(plan §10.3)
  console.log(`[voice-orchestrator] ${redactText(message)}`);
}

if (process.env.VOICE_HUB_TOKEN) {
  log("VOICE_HUB_TOKEN 已废弃并被忽略,请改用 VOICE_HUB_CONSOLE_TOKEN / VOICE_HUB_SCREEN_TOKEN");
}
try {
  assertHubExposureSafe(config);
} catch (err) {
  console.error(`[voice-orchestrator] 拒绝启动:${(err as Error).message}`);
  process.exit(1);
}

const speechClient = new VoiceLocalClient(config.voiceLocalUrl);
const audio = new AudioStore({ client: speechClient,
  cacheDir: config.ttsCacheDir, style: config.ttsStyle, enabled: config.ttsEnabled, warn: log });
await audio.initialize();
log(`tts: ${audio.status.reason}`);

// hub 先起、orchestrator 后建:用一层间接引用接通连接/消息回调
let attachFn: ((conn: import("./ws/ws-server.ts").HubConnection) => void) | null = null;
let messageFn: ((conn: import("./ws/ws-server.ts").HubConnection, raw: string) => void) | null = null;
let detachFn: ((conn: import("./ws/ws-server.ts").HubConnection) => void) | null = null;

const hub = await startVoiceHub({
  port: config.port,
  host: config.host,
  allowedOrigins: config.hubAllowedOrigins.length > 0 ? config.hubAllowedOrigins : undefined,
  maxConnections: config.hubMaxConnections,
  onHttpRequest: async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (["/voice/wake", "/voice/utterance", "/voice/input-config", "/voice/listen"].includes(path)) { await inputHandler(req, res); return; }
    await createAudioHttpHandler({ store: audio, consoleToken: config.hubConsoleToken, screenToken: config.hubScreenToken, allowedOrigins: config.hubAllowedOrigins.length ? config.hubAllowedOrigins : undefined })(req, res);
  },
  onConnection: (conn) => attachFn?.(conn),
  onMessage: (conn, raw) => messageFn?.(conn, raw),
  onClose: (conn) => detachFn?.(conn),
  onError: (err) => log(`hub: ${err.message}`),
});
log(`WS hub listening on ws://${config.host}:${hub.port} (origin policy: ${config.hubAllowedOrigins.length > 0 ? "allowlist" : "local-only"}, auth: ${config.hubConsoleToken ? "enabled" : "disabled"})`);
// 红线:启动日志只打数据源模式,不打 URL(publicId 可能嵌在 URL 里)
log(`payload source: ${config.payloadMode}${config.payloadMode === "http" ? " (http mode)" : ""}`);

const dataSource = createDataSource({
  mode: config.payloadMode,
  fixturePath: config.fixturePath,
  baseUrl: config.payloadUrl,
  publicId: config.payloadPublicId,
});

const llm = config.llmApiKey
  ? new OpenAiCompatibleAdapter({
      baseUrl: config.llmBaseUrl,
      apiKey: config.llmApiKey,
      model: config.llmModel,
      reasoningEffort: config.llmReasoningEffort,
    })
  : new ScriptedAdapter();
log(`llm adapter: ${llm.name}${config.llmApiKey ? "" : " (no VOICE_LLM_API_KEY → scripted)"}`);

const mcp = createMcpClientIfEnabled({
  enabled: config.mcpEnabled,
  url: config.mcpUrl,
  apiKey: config.mcpApiKey,
});
log(`platform mcp: ${mcp ? `enabled (tools: ${config.mcpToolWhitelist.length > 0 ? config.mcpToolWhitelist.length + " whitelisted" : "NONE allowed"})` : "disabled (flag off)"}`);

const trace = new TraceSink(config.traceFile);

const orchestrator = createVoiceOrchestrator({
  hub,
  audio,
  speechClient,
  styleOverrides: config.styleOverrides,
  listenTimeoutMs: config.listenTimeoutMs,
  dataSource,
  llm,
  mcp,
  trace,
  llmTimeoutMs: config.llmTimeoutMs,
  partialPaceMs: config.partialPaceMs,
  partialMaxTotalMs: config.partialMaxTotalMs,
  prefetchTimeoutMs: config.prefetchTimeoutMs,
  questionMinGapMs: config.questionMinGapMs,
  questionWindowMs: config.questionWindowMs,
  questionWindowMax: config.questionWindowMax,
  mcpToolWhitelist: config.mcpToolWhitelist,
  hubAuth: config.hubConsoleToken
    ? { consoleToken: config.hubConsoleToken, screenToken: config.hubScreenToken }
    : null,
});

const inputHandler = createInputHttpHandler({ screenToken: config.hubScreenToken, allowedOrigins: config.hubAllowedOrigins.length ? config.hubAllowedOrigins : undefined, activity: orchestrator.inputActivity, wake: () => orchestrator.beginSession(true), utterance: (pcm, signal, ms, lease) => orchestrator.submitUtterance(pcm, signal, ms, lease), config: () => config.inputConfig });

attachFn = (conn) => orchestrator.attach(conn);
messageFn = (conn, raw) => orchestrator.handleClientMessage(conn, raw);
detachFn = (conn) => orchestrator.detach(conn);
for (const conn of hub.connections) orchestrator.attach(conn);

process.on("uncaughtException", (err) => {
  log(`uncaught: ${redactText(err.stack ?? err.message)}(进程保活,单轮失败不外溢)`);
});
process.on("unhandledRejection", (reason) => {
  log(`unhandled rejection: ${redactText(String(reason))}(进程保活)`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { audio.close(); void hub.close().finally(() => process.exit(0)); });
