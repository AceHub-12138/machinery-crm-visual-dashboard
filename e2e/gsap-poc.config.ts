import { defineConfig } from '@playwright/test';
import base from './nexus.config';
import path from 'node:path';
const engine = process.env.NEXUS_MOTION_ENGINE ?? 'legacy';
const resultName = process.env.GSAP_RESULT_NAME ?? (process.env.GSAP_REGRESSION === '1' ? `${engine}-regression-results` : 'functional-results');
export default defineConfig({ ...base,
  testMatch: process.env.GSAP_REGRESSION === '1' ? ['nexus.spec.ts', 'nexus-motion.spec.ts', 'p1-3.spec.ts'] : 'gsap-poc.spec.ts',
  timeout: 90_000,
  outputDir: path.resolve(`.review/gsap-poc/${engine}-traces`),
  reporter: [['line'], ['json', { outputFile: path.resolve(`.review/gsap-poc/${resultName}.json`) }]],
  use: { ...base.use, reducedMotion: 'no-preference' },
});
