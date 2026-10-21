import path from "node:path";
import { defineConfig } from "@playwright/test";
// Dedicated port: never accidentally validate the preserved 3015 demo build.
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3017);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./e2e",
  // Motion-specific suites run in their own configs with reducedMotion=no-preference.
  testIgnore: ["**/p1-6.spec.ts", "**/p1-6-1.spec.ts", "**/nexus.spec.ts", "**/nexus-motion.spec.ts", "**/p1-5-c*.spec.ts", "**/gsap-poc.spec.ts", "**/p1-5-b.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    browserName: "chromium", baseURL,
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    timezoneId: "Asia/Shanghai", reducedMotion: "reduce", trace: "retain-on-failure",
  },
  webServer: [
    { cwd: path.resolve("."), command: "node e2e/nexus-fixture-server.mjs", url: "http://127.0.0.1:3199", reuseExistingServer: false },
  {
    command: `node scripts/p1-5-c/local-server.mjs --port ${port}`,
    url: `${baseURL}/screen/sales`, reuseExistingServer: false,
    env: { NEXUS_QUALITY_PERMISSION: 'local-candidate', TZ: "Asia/Shanghai", SCREEN_PLATFORM_URL: "http://127.0.0.1:3199", SCREEN_PUBLIC_ID: "fixture-only" }, timeout: 60_000,
  }],
});
