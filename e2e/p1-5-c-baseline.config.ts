import {defineConfig} from '@playwright/test';
import base from '../playwright.config';
import path from 'node:path';
const baseline=path.resolve('../machinery-crm-visual-dashboard-p1-5-c-baseline-check');
export default defineConfig({...base,testDir:'.',testMatch:'visual-acceptance.spec.ts',testIgnore:[],outputDir:path.resolve('.review/p1-5-c/baseline-tail-traces'),reporter:[['line'],['json',{outputFile:path.resolve('.review/p1-5-c/baseline-tail-results.json')}]],
 use:{...base.use,baseURL:'http://127.0.0.1:3073'},
 webServer:[{cwd:path.resolve('.'),command:'node e2e/nexus-fixture-server.mjs',url:'http://127.0.0.1:3199',reuseExistingServer:false},{cwd:baseline,command:'pnpm exec next start --hostname 127.0.0.1 --port 3073',url:'http://127.0.0.1:3073/screen/sales',reuseExistingServer:false,env:{SCREEN_PLATFORM_URL:'http://127.0.0.1:3199',SCREEN_PUBLIC_ID:'fixture-only',TZ:'Asia/Shanghai'}}],
});
