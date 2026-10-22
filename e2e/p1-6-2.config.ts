import { defineConfig } from "@playwright/test";
import base from "./p1-6-1.config";
import path from "node:path";
process.env.P16_OUTPUT_DIR = ".review/p1-6-2/p16";
const report = process.env.P162_SPECIAL_REPORT ?? "special";
export default defineConfig({ ...base, testMatch: ["p1-6.spec.ts", "p1-6-1.spec.ts", "p1-6-2.spec.ts"],
  outputDir: path.resolve(`.review/p1-6-2/${report}`),
  reporter: [["list"], ["json", { outputFile: path.resolve(`docs/nexus-p1-6-2/evidence/${report}.json`) }]],
});
