import { defineConfig } from "@playwright/test";
// Dedicated port: never accidentally validate the preserved 3015 demo build.
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3017);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    browserName: "chromium", baseURL,
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    timezoneId: "Asia/Shanghai", reducedMotion: "reduce", trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/screen/sales`, reuseExistingServer: false,
    env: { TZ: "Asia/Shanghai" }, timeout: 60_000,
  },
});
