import path from "node:path";
import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";

// Preserve the suite and assertions; retain pixels and structured failures for CI diagnosis.
export default defineConfig(base, {
  testDir: path.resolve(__dirname, "../../e2e"),
  use: { screenshot: "only-on-failure" },
  reporter: [["line"], ["json", { outputFile: "test-results/ci-results.json" }]],
});
