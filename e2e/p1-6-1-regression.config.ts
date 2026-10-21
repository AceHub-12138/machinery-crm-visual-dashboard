import { defineConfig } from "@playwright/test";
import path from "node:path";
const label = process.env.P161_OVERLAY_MODE ?? "legacy";
const report = process.env.P161_REGRESSION_REPORT ?? `${label}-regression`;
export default defineConfig({
  testDir: ".", testMatch: ["voice-*.spec.ts", "p1-3.spec.ts"], workers: 1, fullyParallel: false, timeout: 60000,
  outputDir: path.resolve(`.review/p1-6-1/${report}`),
  reporter: [["list"], ["json", { outputFile: path.resolve(`docs/nexus-p1-6-1/evidence/${report}.json`) }]],
  use: { browserName: "chromium", baseURL: "http://127.0.0.1:3069", viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1, timezoneId: "Asia/Shanghai", reducedMotion: "reduce", trace: "retain-on-failure" },
  webServer: [
    { cwd: process.cwd(), command: "node e2e/nexus-fixture-server.mjs", url: "http://127.0.0.1:3199", reuseExistingServer: false },
    { cwd: process.cwd(), command: "node scripts/p1-5-c/local-server.mjs --port 3069", url: "http://127.0.0.1:3069/screen/sales", reuseExistingServer: false,
      env: { XIAOCHUAN_MOTION_PERMISSION: "local-gsap", SCREEN_PLATFORM_URL: "http://127.0.0.1:3199", SCREEN_PUBLIC_ID: "fixture-only", TZ: "Asia/Shanghai" }, timeout: 60000 },
  ],
});
