import { defineConfig } from "@playwright/test";
import path from "node:path";
const root = process.env.P162_PERF_ROOT ?? path.resolve(".review/p1-6-2/performance");
const label = process.env.P162_PERF_LABEL ?? "control";
export default defineConfig({ testDir: ".", testMatch: "p1-6-2-performance.spec.ts", workers: 1, fullyParallel: false, timeout: 60000,
  outputDir: path.join(root, label, "playwright"), reporter: [["list"], ["json", { outputFile: path.join(root, label, "results.json") }]],
  use: { browserName: "chromium", baseURL: "http://127.0.0.1:3072", viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: "no-preference", timezoneId: "Asia/Shanghai" },
  webServer: [
    { cwd: process.cwd(), command: "node e2e/nexus-fixture-server.mjs", url: "http://127.0.0.1:3199", reuseExistingServer: false },
    { cwd: process.cwd(), command: "node scripts/p1-5-c/local-server.mjs --port 3072", url: "http://127.0.0.1:3072/screen/sales", reuseExistingServer: false,
      env: { XIAOCHUAN_MOTION_PERMISSION: "local-gsap", TZ: "Asia/Shanghai", SCREEN_PLATFORM_URL: "http://127.0.0.1:3199", SCREEN_PUBLIC_ID: "fixture-only" }, timeout: 60000 },
  ],
});
