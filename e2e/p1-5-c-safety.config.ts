import { defineConfig } from '@playwright/test';
import path from 'node:path';
const label = process.env.NEXUS_SAFETY_LABEL ?? 'boundary-final';
const common = { cwd: path.resolve('.'), reuseExistingServer: false, timeout: 60000 };
const environment = { SCREEN_PLATFORM_URL: 'http://127.0.0.1:3199', SCREEN_PUBLIC_ID: 'fixture-only', TZ: 'Asia/Shanghai' };
export default defineConfig({
  testDir: '.', testMatch: 'p1-5-c-safety.spec.ts', workers: 1, fullyParallel: false, timeout: 30000,
  outputDir: path.resolve(`.review/p1-5-c-safety/${label}-traces`),
  reporter: [['line'], ['json', { outputFile: path.resolve(`.review/p1-5-c-safety/${label}-results.json`) }]],
  webServer: [
    { ...common, command: 'node e2e/nexus-fixture-server.mjs', url: 'http://127.0.0.1:3199' },
    { ...common, command: 'pnpm exec next start --hostname 127.0.0.1 --port 3082', url: 'http://127.0.0.1:3082/screen/sales', env: { ...environment, NEXUS_QUALITY_PERMISSION: 'local-candidate' } },
    ...(process.env.NEXUS_SAFETY_ORDINARY_ONLY === '1' ? [] : [
      { ...common, command: 'node scripts/p1-5-c/local-server.mjs --port 3081', url: 'http://127.0.0.1:3081/screen/sales', env: { ...environment, NEXUS_QUALITY_PERMISSION: 'local-candidate', HOSTNAME: '0.0.0.0' } },
      { ...common, command: 'node scripts/p1-5-c/local-server.mjs --port 3083', url: 'http://127.0.0.1:3083/screen/sales', env: { ...environment, NEXUS_QUALITY_PERMISSION: 'local-shadow' } },
    ]),
  ],
});
