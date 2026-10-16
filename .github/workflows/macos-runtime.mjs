import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

// Only fixture data is served. Never inherit public-screen credentials in this probe.
async function main() {
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, kernel: os.release(), system: execFileSync('sw_vers', { encoding: 'utf8' }).trim() }));
  const env = { ...process.env, SCREEN_PLATFORM_URL: 'http://127.0.0.1:3199', SCREEN_PUBLIC_ID: 'fixture-only' };
  const servers = [
    spawn(process.execPath, ['e2e/nexus-fixture-server.mjs'], { env, stdio: 'ignore' }),
    spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3039'], { env, stdio: 'ignore' }),
  ];
  let browser;
  try {
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch('http://127.0.0.1:3039/screen/sales')).ok) break; } catch {}
      if (attempt === 60) throw new Error('Font probe server did not start');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 3840, height: 2160 }, timezoneId: 'Asia/Shanghai' });
    await page.goto('http://127.0.0.1:3039/screen/sales?voiceDemo=1');
    const title = page.locator('.overlay-card-title');
    await title.waitFor({ timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    async function record(selector, label) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      const style = await page.locator(selector).evaluate(el => {
        const css = getComputedStyle(el);
        return { family: css.fontFamily, weight: css.fontWeight, size: css.fontSize };
      });
      console.log(JSON.stringify({ label, requested: style, actual: fonts }));
      if (!fonts.some(font => /PingFang/i.test(font.familyName) && font.glyphCount > 0)) throw new Error('Application title did not use PingFang');
      return fonts;
    }
    await record('.overlay-card-title', 'application-title');
  } finally {
    await browser?.close();
    await Promise.all(servers.map(server => new Promise(resolve => {
      if (server.exitCode !== null) return resolve();
      server.once('exit', resolve); server.kill('SIGTERM');
    })));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
