import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function assertApplicationTitleFont(requested, fonts) {
  assert.equal(requested.weight, '700', 'Application title must request CSS weight 700');
  assert(fonts.some(font => {
    if (!(font.glyphCount > 0) || font.isCustomFont) return false;
    // CoreText resolves PingFang SC 700 to Semibold. Family names vary by OS locale;
    // PostScript names identify both the face and weight independently of that locale.
    if (font.postScriptName) return /^PingFangSC-(Semibold|Bold)$/i.test(font.postScriptName);
    // Older CDP implementations can omit PostScript names. Only accept a family
    // naming the weight explicitly; a bare localized family cannot prove the face.
    return /^(?:PingFang SC|蘋方-簡|苹方-简)[ -](?:Semibold|Bold|中粗體|中粗体|粗體|粗体)$/i.test(font.familyName);
  }), 'Application title must render real glyphs in PingFang SC Semibold/Bold');
}

// Only fixture data is served. Never inherit public-screen credentials in this probe.
async function main() {
  const diagnostic = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), platform: process.platform, arch: process.arch, kernel: os.release(), system: execFileSync('sw_vers', { encoding: 'utf8' }).trim(), records: [] };
  console.log(JSON.stringify(diagnostic));
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
      diagnostic.records.push({ label, requested: style, actual: fonts });
      assertApplicationTitleFont(style, fonts);
      return fonts;
    }
    await record('.overlay-card-title', 'application-title');
    diagnostic.passed = true;
  } catch (error) {
    diagnostic.passed = false;
    diagnostic.error = error.message;
    throw error;
  } finally {
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/macos-runtime.json', JSON.stringify(diagnostic, null, 2));
    await browser?.close();
    await Promise.all(servers.map(server => new Promise(resolve => {
      if (server.exitCode !== null) return resolve();
      server.once('exit', resolve); server.kill('SIGTERM');
    })));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
