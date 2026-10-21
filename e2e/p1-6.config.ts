import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "p1-6.spec.ts", timeout: 90000, workers: 1, fullyParallel:false,
  outputDir: process.cwd()+"/.review/p1-6/playwright", reporter: [["list"], ["json", { outputFile: process.cwd()+"/docs/nexus-p1-6/evidence/"+(process.env.P16_REPORT??"browser-results")+".json" }]],
  use: { browserName:"chromium", baseURL: "http://127.0.0.1:3066", viewport:{width:1920,height:1080},deviceScaleFactor:1, reducedMotion: "no-preference", launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } },
  webServer: [{cwd:process.cwd(),command:"node e2e/nexus-fixture-server.mjs",url:"http://127.0.0.1:3199",reuseExistingServer:false}, { cwd:process.cwd(), command: "node scripts/p1-5-c/local-server.mjs --port 3066", url: "http://127.0.0.1:3066/screen/sales", reuseExistingServer: false,
    env: { TZ: "Asia/Shanghai", XIAOCHUAN_POC_REVIEW:"1", XIAOCHUAN_MOTION_PERMISSION:"local-gsap", SCREEN_PLATFORM_URL: "http://127.0.0.1:3199", SCREEN_PUBLIC_ID: "fixture-only" }, timeout: 60000 }],
});
