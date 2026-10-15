import path from 'node:path';
import config from './nexus.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({ ...config, outputDir: path.resolve(import.meta.dirname, "..", ".review/nexus-p2-motion/playwright-motion"), testMatch: 'nexus-motion.spec.ts', use: { ...config.use, reducedMotion: 'no-preference' } });
