import path from "node:path";
import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";

// Preserve the suite and assertions; retain pixels and structured failures for CI diagnosis.
export default defineConfig({
  ...base,
  testDir: path.resolve(__dirname, "../../e2e"),
  webServer: (Array.isArray(base.webServer) ? base.webServer : [base.webServer!]).map(server => ({
    ...server, cwd: path.resolve(__dirname, "../.."),
  })),
  outputDir: path.resolve(__dirname, "../../test-results/browser"),
  use: { ...base.use, screenshot: "only-on-failure" },
  reporter: [["line"], ["json", { outputFile: path.resolve(__dirname, "../../test-results/ci-results.json") }]],
});
