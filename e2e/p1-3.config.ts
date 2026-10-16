import { defineConfig } from '@playwright/test';
import base from './nexus.config';
import path from 'node:path';
export default defineConfig({
  ...base, testMatch: 'p1-3.spec.ts', timeout: 60_000,
  outputDir: '../test-results/p1-3',
  reporter: [['line'], ['json', { outputFile: path.resolve('.review/p1-3/results.json') }]],
});
