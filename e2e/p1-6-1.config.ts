import { defineConfig } from "@playwright/test";
import path from "node:path";
process.env.P16_OUTPUT_DIR ??= "docs/nexus-p1-6-1/p16";
const common = { cwd: process.cwd(), reuseExistingServer: false, timeout: 60000 };
const fixture = { TZ: "Asia/Shanghai", SCREEN_PLATFORM_URL: "http://127.0.0.1:3199", SCREEN_PUBLIC_ID: "fixture-only" };
export default defineConfig({
  testDir: ".", testMatch: ["p1-6.spec.ts", "p1-6-1.spec.ts"], workers: 1, fullyParallel: false, timeout: 90000,
  outputDir: path.resolve(".review/p1-6-1/playwright"),
  reporter: [["list"], ["json", { outputFile: path.resolve("docs/nexus-p1-6-1/evidence/browser-hardening.json") }]],
  use: { browserName: "chromium", baseURL: "http://127.0.0.1:3066", viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1, reducedMotion: "no-preference", trace: "retain-on-failure",
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } },
  webServer: [
    { ...common, command: "node e2e/nexus-fixture-server.mjs", url: "http://127.0.0.1:3199" },
    { ...common, command: "node scripts/p1-5-c/local-server.mjs --port 3066", url: "http://127.0.0.1:3066/screen/sales",
      env: { ...fixture, XIAOCHUAN_MOTION_PERMISSION: "local-gsap", XIAOCHUAN_POC_REVIEW: "1" } },
    { ...common, command: "node scripts/p1-5-c/local-server.mjs --port 3067", url: "http://127.0.0.1:3067/screen/sales",
      env: { ...fixture, XIAOCHUAN_MOTION_PERMISSION: "", XIAOCHUAN_POC_REVIEW: "1", NEXUS_QUALITY_PERMISSION: "local-candidate" } },
    { ...common, command: "pnpm exec next start --hostname 127.0.0.1 --port 3068", url: "http://127.0.0.1:3068/screen/sales",
      env: { ...fixture, XIAOCHUAN_MOTION_PERMISSION: "local-gsap", XIAOCHUAN_POC_REVIEW: "1" } },
  ],
});
