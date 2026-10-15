const { chromium } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { mkdir } = require('node:fs/promises');

// Only fixture data is served. Never inherit public-screen credentials in this probe.
async function main() {
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
      if (!fonts.some(font => font.familyName === 'Noto Sans CJK SC' && font.glyphCount > 0)) throw new Error('Chinese fallback is not Noto Sans CJK SC');
      return fonts;
    }
    await record('.overlay-card-title', 'application-title');
    // Verify a real 600 face, rather than silently synthesizing from the regular face.
    await page.evaluate(() => {
      const probe = document.createElement('span'); probe.id = 'font-weight-probe';
      probe.textContent = '中文字体核验';
      probe.style.cssText = 'position:fixed;left:0;top:0;font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;font-size:34px;font-weight:600';
      document.body.append(probe);
    });
    const fonts = await record('#font-weight-probe', 'semibold-600');
    if (!fonts.some(font => /SemiBold/i.test(font.postScriptName))) throw new Error('A real SemiBold face is required');
    await page.locator('#font-weight-probe').evaluate(el => el.remove());
    await mkdir('test-results/font-probe', { recursive: true });
    await page.screenshot({ path: 'test-results/font-probe/application.png' });
  } finally {
    await browser?.close();
    await Promise.all(servers.map(server => new Promise(resolve => {
      if (server.exitCode !== null) return resolve();
      server.once('exit', resolve); server.kill('SIGTERM');
    })));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
