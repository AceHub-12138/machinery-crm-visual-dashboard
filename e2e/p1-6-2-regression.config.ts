import { defineConfig } from "@playwright/test";
import base from "./p1-6-1-regression.config";
import path from "node:path";
const label = process.env.P162_REPORT ?? `${process.env.P161_OVERLAY_MODE ?? "legacy"}-regression`;
const evidence = process.env.P162_EVIDENCE_ROOT ?? path.resolve("docs/nexus-p1-6-2/evidence");
process.env.P162_CARD_EVIDENCE_DIR = path.resolve(`.review/p1-6-2/card-evidence/${label}`);
export default defineConfig({ ...base,
  outputDir: path.resolve(`.review/p1-6-2/${label}`),
  reporter: [["list"], ["json", { outputFile: path.join(evidence, `${label}.json`) }]],
});
