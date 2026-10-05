import { describe, expect, it } from "vitest";
import { assertHubExposureSafe, isLoopbackHost, loadConfig } from "../src/config.ts";

const T1 = "console-token-0123456789";
const T2 = "screen-token-0123456789";

describe("config — hub 暴露面校验(审核 H1)", () => {
  it("isLoopbackHost", () => {
    for (const h of ["127.0.0.1", "localhost", "::1"]) expect(isLoopbackHost(h)).toBe(true);
    for (const h of ["0.0.0.0", "192.168.1.5", "::", ""]) expect(isLoopbackHost(h)).toBe(false);
  });
  it("回环 + 无令牌:放行", () => {
    expect(() => assertHubExposureSafe({ host: "127.0.0.1", hubConsoleToken: "", hubScreenToken: "" })).not.toThrow();
  });
  it("非回环 + 无令牌:拒绝启动", () => {
    expect(() => assertHubExposureSafe({ host: "0.0.0.0", hubConsoleToken: "", hubScreenToken: "" })).toThrow();
  });
  it("只设一个令牌:拒绝", () => {
    expect(() => assertHubExposureSafe({ host: "127.0.0.1", hubConsoleToken: T1, hubScreenToken: "" })).toThrow();
  });
  it("令牌过短 / 两个令牌相同:拒绝", () => {
    expect(() => assertHubExposureSafe({ host: "0.0.0.0", hubConsoleToken: "short", hubScreenToken: T2 })).toThrow();
    expect(() => assertHubExposureSafe({ host: "0.0.0.0", hubConsoleToken: T1, hubScreenToken: T1 })).toThrow();
  });
  it("非回环 + 双令牌合规:放行", () => {
    expect(() => assertHubExposureSafe({ host: "0.0.0.0", hubConsoleToken: T1, hubScreenToken: T2 })).not.toThrow();
  });
  it("loadConfig 读取双令牌", () => {
    // 本仓 Next 类型增强使 NodeJS.ProcessEnv 含必填 NODE_ENV,需经 unknown 二次断言
    const c = loadConfig({ VOICE_HUB_CONSOLE_TOKEN: T1, VOICE_HUB_SCREEN_TOKEN: T2 } as unknown as NodeJS.ProcessEnv);
    expect(c.hubConsoleToken).toBe(T1);
    expect(c.hubScreenToken).toBe(T2);
  });
});
