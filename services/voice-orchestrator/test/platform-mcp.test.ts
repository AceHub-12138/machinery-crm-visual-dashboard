import { describe, expect, it } from "vitest";
import {
  createMcpClientIfEnabled,
  McpTransportError,
  PlatformMcpClient,
} from "../src/datasource/platform-mcp.ts";

/** 记录请求并按脚本应答的 fetch 替身。 */
function scriptedFetch(handler: (url: string, init: RequestInit) => { body: unknown; headers?: Record<string, string>; contentType?: string }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const out = handler(url, init);
    return new Response(
      out.contentType === "sse" ? sse(out.body) : JSON.stringify(out.body),
      { status: 200, headers: { "content-type": out.contentType === "sse" ? "text/event-stream" : "application/json", ...(out.headers ?? {}) } },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function sse(body: unknown): string {
  return `: ping\n\ndata: ${JSON.stringify(body)}\n\n`;
}

describe("platform mcp — 客户端(B③;flag 关闭时代码就绪)", () => {
  it("initialize 捕获 session id 并在后续请求复用(长连接语义)", async () => {
    const { fetchImpl, calls } = scriptedFetch((_, init) => {
      const body = JSON.parse(String(init.body));
      if (body.method === "initialize") {
        return { body: { jsonrpc: "2.0", id: body.id, result: { serverInfo: { name: "platform-mcp" } } }, headers: { "mcp-session-id": "sess-42" } };
      }
      if (body.method === "tools/list") {
        return { body: { jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "query_sales_summary" }] } } };
      }
      return { body: { jsonrpc: "2.0", id: body.id, result: {} } };
    });

    const client = new PlatformMcpClient({ url: "https://platform/api/mcp", apiKey: "k-test", fetchImpl });
    const info = await client.initialize();
    expect(info.serverName).toBe("platform-mcp");
    expect(info.tools[0].name).toBe("query_sales_summary");

    // 第二次调用携带会话 id(API Key 鉴权头也在)
    await client.listTools();
    const second = calls[2];
    expect((second.init.headers as Record<string, string>)["mcp-session-id"]).toBe("sess-42");
    expect((second.init.headers as Record<string, string>).authorization).toBe("Bearer k-test");
  });

  it("callTool 走 JSON-RPC tools/call,结果解析 content", async () => {
    const { fetchImpl, calls } = scriptedFetch((_, init) => {
      const body = JSON.parse(String(init.body));
      if (body.method === "tools/call") {
        return {
          body: { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "¥1,286.0万" }], isError: false } },
          headers: { "mcp-session-id": "sess-7" },
        };
      }
      return { body: { jsonrpc: "2.0", id: body.id, result: {} }, headers: { "mcp-session-id": "sess-7" } };
    });
    const client = new PlatformMcpClient({ url: "https://platform/api/mcp", apiKey: "k", fetchImpl });
    const result = await client.callTool("query_sales_summary", { period: "2026-09" });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe("¥1,286.0万");
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent).toMatchObject({ jsonrpc: "2.0", method: "tools/call", params: { name: "query_sales_summary" } });
    expect((calls[0].init.headers as Record<string, string>).accept).toContain("text/event-stream");
  });

  it("SSE 响应帧也能解析", async () => {
    const { fetchImpl } = scriptedFetch((_, init) => {
      const body = JSON.parse(String(init.body));
      return { body: { jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "t1" }] } }, contentType: "sse", headers: { "mcp-session-id": "s" } };
    });
    const client = new PlatformMcpClient({ url: "https://p/api/mcp", apiKey: "k", fetchImpl });
    expect(await client.listTools()).toEqual([{ name: "t1" }]);
  });

  it("JSON-RPC error → McpTransportError", async () => {
    const { fetchImpl } = scriptedFetch(() => ({
      body: { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "method not found" } },
    }));
    const client = new PlatformMcpClient({ url: "https://p/api/mcp", apiKey: "k", fetchImpl });
    await expect(client.listTools()).rejects.toBeInstanceOf(McpTransportError);
  });

  it("x-api-key 鉴权风格可配", async () => {
    const { fetchImpl, calls } = scriptedFetch(() => ({ body: { jsonrpc: "2.0", id: 1, result: {} } }));
    const client = new PlatformMcpClient({ url: "https://p/api/mcp", apiKey: "kx", authStyle: "x-api-key", fetchImpl });
    await client.listTools();
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("kx");
  });

  it("feature flag 关闭 → createMcpClientIfEnabled 返回 null", () => {
    expect(createMcpClientIfEnabled({ enabled: false, url: "https://p", apiKey: "k" })).toBeNull();
    expect(createMcpClientIfEnabled({ enabled: true, url: "", apiKey: "k" })).toBeNull();
    expect(createMcpClientIfEnabled({ enabled: true, url: "https://p", apiKey: "" })).toBeNull();
  });
});
