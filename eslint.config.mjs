import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // .review/ holds local screenshot/measurement tooling plus a throwaway Chrome
  // profile — not product code, and not tracked by git.
  globalIgnores([".next/**", "out/**", "node_modules/**", ".review/**", "public/voice/kws/**", "public/voice/vad/**"]),
]);
