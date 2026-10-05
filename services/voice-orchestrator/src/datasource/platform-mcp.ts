/**
 * 平台 MCP 只读客户端(plan §16.2 B③;红线:只读工具,无任何写)。
 *
 * 对接平台仓 /api/mcp(标准 MCP 端点,API Key 鉴权,full-read-only 模式)。
 * 视觉仓阶段(8b):代码就绪 + feature flag 默认关(无 Key);
 * 会话内 initialize 后复用 Mcp-Session-Id 与 HTTP keep-alive 连接(长连接复用)。
 *
 * 传输:MCP Streamable HTTP——POST JSON-RPC,响应可能是 application/json
 * 或 text/event-stream(SSE 帧),两者都解析。
 */

export type McpClientOptions = {
  url: string;
  apiKey: string;
  /** 鉴权头风格:"bearer"(默认,Authorization: Bearer …) | "x-api-key" */
  authStyle?: "bearer" | "x-api-key";
  protocolVersion?: string;
  fetchImpl?: typeof fetch;
};

export type McpToolDescriptor = { name: string; description?: string };

export type McpCallResult = {
  content: Array<{ type: string; text?: string }>;
  isError: boolean;
};

export class McpTransportError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "McpTransportError";
    this.status = status;
  }
}

export class PlatformMcpClient {
  #sessionId: string | null = null;
  private nextId = 1;
  private readonly fetchImpl: typeof fetch;
  private readonly protocolVersion: string;
  readonly #options: McpClientOptions;

  constructor(options: McpClientOptions) {
    this.#options = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.protocolVersion = options.protocolVersion ?? "2025-03-26";
  }

  /** initialize + initialized 通知;返回服务端能力(工具清单延迟到 listTools)。 */
  async initialize(signal?: AbortSignal): Promise<{ serverName: string; tools: McpToolDescriptor[] }> {
    const result = await this.rpc("initialize", {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: "voice-orchestrator", version: "8b.0" },
    }, signal);
    await this.notify("notifications/initialized", signal);
    const toolsResult = await this.rpc("tools/list", {}, signal);
    const tools = (toolsResult?.tools ?? []) as McpToolDescriptor[];
    return { serverName: result?.serverInfo?.name ?? "mcp", tools };
  }

  async listTools(signal?: AbortSignal): Promise<McpToolDescriptor[]> {
    const result = await this.rpc("tools/list", {}, signal);
    return (result?.tools ?? []) as McpToolDescriptor[];
  }

  /** 只读工具调用(长尾问题兜底路径)。 */
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    const result = await this.rpc("tools/call", { name, arguments: args }, signal);
    return {
      content: result?.content ?? [],
      isError: Boolean(result?.isError),
    };
  }

  async close(signal?: AbortSignal): Promise<void> {
    if (!this.#sessionId) return;
    const session = this.#sessionId;
    this.#sessionId = null;
    try {
      await this.fetchImpl(this.#options.url, {
        method: "DELETE",
        signal,
        headers: this.headers(session),
      });
    } catch {
      /* 会话关闭失败不抛——连接清理尽力而为 */
    }
  }

  /* ---- JSON-RPC 内核 ---- */

  private async rpc(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<JsonRpcResult | null> {
    const body = { jsonrpc: "2.0" as const, id: this.nextId++, method, params };
    const response = await this.fetchImpl(this.#options.url, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...this.headers(),
      },
      body: JSON.stringify(body),
    });

    // Streamable HTTP:会话 id 在响应头下发,后续请求原样携带(长连接复用)
    const session = response.headers.get("mcp-session-id");
    if (session) this.#sessionId = session;

    if (!response.ok) {
      throw new McpTransportError(`MCP ${method} HTTP ${response.status}`, response.status);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("text/event-stream")
      ? await parseSseResponse(response, body.id)
      : ((await response.json()) as JsonRpcEnvelope | null);
    if (payload?.error) {
      throw new McpTransportError(`MCP ${method} error: ${payload.error.message ?? "unknown"}`);
    }
    return payload?.result ?? null;
  }

  private async notify(method: string, signal?: AbortSignal): Promise<void> {
    await this.fetchImpl(this.#options.url, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", ...this.headers() },
      body: JSON.stringify({ jsonrpc: "2.0", method, params: {} }),
    });
  }

  private headers(session: string | null = this.#sessionId): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.#options.authStyle === "x-api-key") headers["x-api-key"] = this.#options.apiKey;
    else headers.authorization = `Bearer ${this.#options.apiKey}`;
    if (session) headers["mcp-session-id"] = session;
    return headers;
  }
}

type JsonRpcResult = {
  serverInfo?: { name?: string };
  tools?: McpToolDescriptor[];
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

type JsonRpcEnvelope = { id?: number; result?: JsonRpcResult; error?: { message?: string } } | null;

/** 解析 SSE:text/event-stream 中取与请求 id 匹配的 JSON-RPC 响应帧。 */
async function parseSseResponse(response: Response, requestId: number): Promise<JsonRpcEnvelope> {
  const text = await response.text();
  for (const chunk of text.split(/\r?\n\r?\n/)) {
    const dataLine = chunk
      .split(/\r?\n/)
      .find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    try {
      const payload = JSON.parse(dataLine.slice("data:".length).trim()) as JsonRpcEnvelope;
      if (payload?.id === requestId || payload?.result || payload?.error) return payload;
    } catch {
      /* 非法帧跳过 */
    }
  }
  throw new McpTransportError("MCP SSE 流中没有可用响应帧");
}

/** feature flag 出口:关闭时返回 null(编排主路径零 MCP 依赖)。 */
export function createMcpClientIfEnabled(options: {
  enabled: boolean;
  url: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): PlatformMcpClient | null {
  if (!options.enabled || !options.url || !options.apiKey) return null;
  return new PlatformMcpClient({ url: options.url, apiKey: options.apiKey, fetchImpl: options.fetchImpl });
}
