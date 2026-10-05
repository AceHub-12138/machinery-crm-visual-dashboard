import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    browserName: "chromium", baseURL: "http://127.0.0.1:3015",
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    timezoneId: "Asia/Shanghai", reducedMotion: "reduce", trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec next start --hostname 127.0.0.1 --port 3015",
    url: "http://127.0.0.1:3015/screen/sales", reuseExistingServer: !process.env.CI,
    env: { TZ: "Asia/Shanghai" }, timeout: 60_000,
  },
});
