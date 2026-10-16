// Local real-time acceptance harness. Adds no animation loop and never reads env files.
import { chromium } from '@playwright/test';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const output = path.resolve(process.env.NEXUS_SMOKE_OUTPUT ?? '.review/nexus-p2-motion/smoke');
const duration = Number(process.env.NEXUS_SMOKE_MS ?? 7_200_000);
const url = process.env.NEXUS_SMOKE_URL ?? 'http://127.0.0.1:3036/screen/sales?debug=1';
if (new URL(url).hostname !== '127.0.0.1') throw new Error('Local preview only');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: 1792, height: 832 }, deviceScaleFactor: 1 });
let pageErrors = 0; page.on('pageerror', () => pageErrors++);
await page.addInitScript(() => {
  const nativeRequest = window.requestAnimationFrame.bind(window), nativeCancel = window.cancelAnimationFrame.bind(window);
  const pending = new Set(); let stamp = -1, frames = 0, peak = 0;
  window.requestAnimationFrame = callback => {
    const id = nativeRequest(time => { pending.delete(id); if (time !== stamp) { stamp = time; frames++; } callback(time); });
    pending.add(id); peak = Math.max(peak, pending.size); return id;
  };
  window.cancelAnimationFrame = id => { pending.delete(id); nativeCancel(id); };
  window.nexusProbe = () => ({ frames, pending: pending.size, peak, memoryBytes: performance.memory?.usedJSHeapSize ?? null });
});
await page.goto(url);
await page.locator('.nexus-motion-debug').waitFor();
await page.evaluate(() => document.fonts.ready);
// Preheat is separate from the full two-hour measured interval.
await page.waitForTimeout(30_000);
const sample = () => page.evaluate(() => {
  const panel = document.querySelector('.nexus-motion-debug');
  return { ...window.nexusProbe(), state: panel.dataset.state, level: panel.dataset.level, paused: panel.dataset.paused === 'true', clock: Number(panel.dataset.clock), dueIn: Number(panel.dataset.pulseDueIn), significant: Number(/显著 (\d+)/.exec(panel.textContent)?.[1] ?? 0), particles: getComputedStyle(document.querySelector('.nexus-particles')).visibility, dataTime: panel.querySelectorAll('p')[3].textContent };
});
const baseline = await sample(), started = Date.now();
const samples = [], wakes = [], windows = [];
let previous = baseline, previousAt = started, maxSignificant = 0, nextWake = 0;
const wakeTimes = duration >= 7_200_000 ? [300_000, 1_500_000, 3_000_000, 4_500_000, 6_000_000] : [2000, 7000, 12000, 17000, 22000];
writeFileSync(path.join(output, 'status.json'), JSON.stringify({ status: 'running', started: new Date(started).toISOString(), duration, realVoice: 'deferred to P3; FPS excludes real voice load' }, null, 2));
while (Date.now() - started < duration) {
  await page.waitForTimeout(1000);
  const at = Date.now(), s = await sample(), fps = (s.frames - previous.frames) * 1000 / (at - previousAt);
  const row = { at: new Date(at).toISOString(), elapsedMs: at - started, fps, ...s };
  samples.push(row); appendFileSync(path.join(output, 'frames-memory.jsonl'), JSON.stringify(row) + '\n');
  maxSignificant = Math.max(maxSignificant, s.significant);
  // Every one-second boundary audits the preceding rolling minute, including pauses.
  const earlier = samples.find(r => r.elapsedMs >= row.elapsedMs - 60_000);
  if (earlier && row.elapsedMs - earlier.elapsedMs >= 59_000) windows.push({ at: row.at, fps: (s.frames - earlier.frames) * 1000 / (row.elapsedMs - earlier.elapsedMs) });
  previous = s; previousAt = at;
  if (nextWake < wakeTimes.length && at - started >= wakeTimes[nextWake]) {
    await page.getByRole('button', { name: '取消共振' }).click(); await page.waitForTimeout(300);
    await page.getByRole('button', { name: '触发共振' }).click(); await page.waitForTimeout(5000);
    const pulse = await sample();
    await page.getByRole('button', { name: '模拟小川唤醒' }).click(); await page.waitForTimeout(350);
    const waking = await sample(); await page.waitForTimeout(2000); const held = await sample();
    await page.getByRole('button', { name: '模拟小川退出' }).click(); await page.waitForTimeout(350); const returned = await sample();
    const event = { cycle: ++nextWake, at: new Date().toISOString(), pulse, waking, held, returned,
      checks: { yielded: pulse.state === 'PULSE' && waking.state === 'AMBIENT', paused: waking.paused && waking.pending === 0 && held.clock === waking.clock, restarted: !returned.paused && returned.state === 'AMBIENT' && returned.dueIn > 149_000 && returned.dueIn <= 150_000 } };
    wakes.push(event); appendFileSync(path.join(output, 'voice-simulation.jsonl'), JSON.stringify(event) + '\n');
  }
}
const final = await sample();
const median = list => { const sorted = [...list].sort((a,b) => a-b); return sorted[Math.floor(sorted.length / 2)] ?? null; };
const initialHeap = median(samples.filter(s => s.elapsedMs < 60_000).map(s => s.memoryBytes).filter(n => n !== null));
const finalHeap = median(samples.slice(-60).map(s => s.memoryBytes).filter(n => n !== null));
const growth = initialHeap && finalHeap ? (finalHeap - initialHeap) / initialHeap * 100 : null;
const minMinuteFps = windows.length ? Math.min(...windows.map(s => s.fps)) : null;
const periodic = await page.locator('[data-performance-log]').textContent();
writeFileSync(path.join(output, 'director-performance.json'), periodic ?? '[]');
writeFileSync(path.join(output, 'rolling-minute-fps.json'), JSON.stringify(windows, null, 2));
const result = { status: 'complete', started: new Date(started).toISOString(), ended: new Date().toISOString(), elapsedMs: Date.now() - started, samples: samples.length, baseline, final, minMinuteFps, initialHeap, finalHeap, memoryGrowthPercent: growth, maxSignificant, pageErrors, simulations: wakes.length, realVoice: 'deferred to P3; FPS excludes real voice load',
  passed: duration >= 7_200_000 && minMinuteFps >= 50 && growth !== null && growth <= 10 && maxSignificant <= 8 && pageErrors === 0 && wakes.length >= 5 && wakes.every(e => Object.values(e.checks).every(Boolean)) };
writeFileSync(path.join(output, 'status.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
await browser.close();
