import { defineConfig } from '@playwright/test';
import base from './nexus.config';
import path from 'node:path';
const label=process.env.P15C_E2E_LABEL??'integration';
export default defineConfig({ ...base, testMatch:['p1-5-c.spec.ts','p1-5-c-lifecycle.spec.ts'],timeout:90000,
  outputDir:path.resolve(`.review/p1-5-c/${label}-traces`),
  reporter:[['line'],['json',{outputFile:path.resolve(`.review/p1-5-c/${label}-results.json`)}]],
  use:{...base.use,reducedMotion:'no-preference'},
  webServer:(Array.isArray(base.webServer) ? base.webServer : [base.webServer!]).map(s=>({...s,env:{...s.env,NEXUS_QUALITY_PERMISSION:process.env.NEXUS_QUALITY_PERMISSION??'denied'}})),
});
