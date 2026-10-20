import { defineConfig } from '@playwright/test';
import base from './nexus.config';
import path from 'node:path';

export default defineConfig({
  ...base,
  testMatch: 'p1-5-b.spec.ts',
  timeout: 90_000,
  outputDir: path.resolve('.review/p1-5-b/e2e-traces'),
  reporter: [['line'], ['json', { outputFile: path.resolve('.review/p1-5-b/e2e-results.json') }]],
  use: { ...base.use, reducedMotion: 'no-preference' },
});
