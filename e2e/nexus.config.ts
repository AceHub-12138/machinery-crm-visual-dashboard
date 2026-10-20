import path from "node:path";
import { defineConfig } from "@playwright/test";
const port = Number(process.env.NEXUS_TEST_PORT ?? 3026);
export default defineConfig({
  testDir: ".", testMatch: "nexus.spec.ts", fullyParallel: false, workers: 1, timeout: 45_000,
  use: { browserName: "chromium", baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1792, height: 832 }, deviceScaleFactor: 1, timezoneId: "Asia/Shanghai", trace: "retain-on-failure" },
  webServer: [
    { cwd: path.resolve(import.meta.dirname, ".."), command: "node e2e/nexus-fixture-server.mjs", url: "http://127.0.0.1:3199", reuseExistingServer: false },
    { cwd: path.resolve(import.meta.dirname, ".."), command: `node scripts/p1-5-c/local-server.mjs --port ${port}`, url: `http://127.0.0.1:${port}/screen/sales?source=mock`, reuseExistingServer: false, env: { NEXUS_QUALITY_PERMISSION: 'local-candidate', SCREEN_PLATFORM_URL: "http://127.0.0.1:3199", SCREEN_PUBLIC_ID: "fixture-only", TZ: "Asia/Shanghai" } },
  ],
});
