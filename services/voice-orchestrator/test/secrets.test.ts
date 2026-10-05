import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { OpenAiCompatibleAdapter } from "../src/llm/zhipu.ts";
import { PlatformMcpClient } from "../src/datasource/platform-mcp.ts";

describe("密钥不可经对象序列化泄露(审核 L2)", () => {
  it("OpenAiCompatibleAdapter / PlatformMcpClient 的 apiKey 不出现在 JSON.stringify 与 util.inspect 中", () => {
    const llm = new OpenAiCompatibleAdapter({ baseUrl: "http://x", apiKey: "sk-SHOULD-NOT-LEAK", model: "m" });
    const mcp = new PlatformMcpClient({ url: "http://x", apiKey: "mcp-SHOULD-NOT-LEAK" });
    for (const obj of [llm, mcp]) {
      expect(JSON.stringify(obj)).not.toContain("SHOULD-NOT-LEAK");
      expect(inspect(obj, { depth: 5, showHidden: true })).not.toContain("SHOULD-NOT-LEAK");
    }
  });
});
