import { defineConfig } from '@playwright/test';
import base from './nexus.config';
import path from 'node:path';
const label = process.env.C1_E2E_LABEL ?? 'runtime';
export default defineConfig({ ...base, testMatch: 'p1-5-c-1.spec.ts', timeout: 120_000,
  outputDir: path.resolve(`.review/p1-5-c-1/${label}-traces`),
  reporter: [['line'], ['json', { outputFile: path.resolve(`docs/nexus-p1-5-c-1/evidence/checks/${label}.json`) }]],
  use: { ...base.use, reducedMotion: 'no-preference' },
});
