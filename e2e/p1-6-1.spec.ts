import { test, expect, type Page } from "@playwright/test";
import { get } from "node:http";
type Audit = () => { liveControllers: number; liveTimelines: number; activeListeners: number; pendingJob: boolean } | null;
type AuditWindow = Window & { __xiaochuanMotionAudit?: Audit; savedAudit?: Audit };
async function decision(port: number, query: string, headers: Record<string, string> = {}) {
  const html = await new Promise<string>((resolve, reject) => {
    const req = get({ hostname: "127.0.0.1", port, path: `/screen/sales?${query}`, headers }, res => {
      let body = ""; res.setEncoding("utf8"); res.on("data", chunk => { body += chunk; });
      res.on("end", () => res.statusCode === 200 ? resolve(body) : reject(new Error(`HTTP ${res.statusCode}`)));
    });
    req.on("error", reject); req.setTimeout(15000, () => req.destroy(new Error("timeout")));
  });
  const flight = html.replace(/\\+"/g, '"');
  // Match the adjacent server-selected props, never the echoed URL in Next's route tree.
  const selection = flight.match(/"xiaochuanMotion":"(legacy|gsap)","xiaochuanAuditAllowed":(true|false)/);
  const mode = selection?.[1];
  const auditAllowed = selection?.[2];
  expect(mode).toBeDefined(); expect(auditAllowed).toBeDefined();
  return { mode, auditAllowed: auditAllowed === "true" };
}
const legacy = { mode: "legacy", auditAllowed: false };
for (const port of [3067, 3068]) test(`${port} denies URL-only GSAP despite debug, review/quality flags and forged headers`, async ({ page }) => {
  for (const headers of ([{}, { Host: "localhost", "X-Xiaochuan-Motion-Permission": "local-gsap" }, { "X-Forwarded-Host": "localhost", "X-Nexus-Quality-Boundary": "verified" }] as Array<Record<string, string>>)) {
    expect(await decision(port, "xiaochuanMotion=gsap&debug=1&qualityExperiment=candidate", headers)).toEqual(legacy);
  }
  await page.goto(`http://127.0.0.1:${port}/screen/sales?voiceLive=1&xiaochuanMotion=gsap&debug=1`);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => typeof (window as AuditWindow).__xiaochuanMotionAudit)).toBe("undefined");
});
test("attested service requires one exact GSAP parameter; default/old/repeated values fail closed", async () => {
  for (const query of ["", "motion=gsap", "xiaochuanMotion=true", "xiaochuanMotion=1", "xiaochuanMotion=GSAP", "xiaochuanMotion=gsap%20", "xiaochuanMotion=gsap&xiaochuanMotion=gsap", "xiaochuanMotion=gsap&xiaochuanMotion=legacy"]) {
    expect(await decision(3066, `${query}&debug=1`)).toEqual(legacy);
  }
  expect(await decision(3066, "xiaochuanMotion=gsap")).toEqual({ mode: "gsap", auditAllowed: false });
  expect(await decision(3066, "xiaochuanMotion=gsap&debug=1")).toEqual({ mode: "gsap", auditAllowed: true });
  expect(await decision(3066, "xiaochuanMotion=gsap&debug=1&debug=1")).toEqual({ mode: "gsap", auditAllowed: false });
});
test("forwarded requests cannot acquire the trusted server context", async () => {
  for (const headers of ([{ Forwarded: "for=127.0.0.1" }, { Via: "1.1 proxy" }, { "X-Forwarded-For": "127.0.0.1" }, { "X-Nexus-Quality-Boundary": "verified" }] as Array<Record<string, string>>)) {
    expect(await decision(3066, "xiaochuanMotion=gsap&debug=1", headers)).toEqual(legacy);
  }
  const decisions = await Promise.all(Array.from({ length: 12 }, (_, i) => decision(3066, "xiaochuanMotion=gsap&debug=1", i % 2 ? { Forwarded: "for=127.0.0.1" } : {})));
  decisions.forEach((result, i) => expect(result).toEqual(i % 2 ? legacy : { mode: "gsap", auditAllowed: true }));
});
test("review fixture stays private to the attested local launcher", async ({ request }) => {
  expect((await request.get("http://127.0.0.1:3068/poc/xiaochuan?xiaochuanMotion=gsap")).status()).toBe(404);
  expect((await request.get("http://127.0.0.1:3066/poc/xiaochuan?xiaochuanMotion=gsap", { headers: { Forwarded: "for=127.0.0.1" } })).status()).toBe(404);
  expect((await request.get("http://127.0.0.1:3066/poc/xiaochuan?xiaochuanMotion=gsap")).status()).toBe(200);
});
test("authorized non-debug GSAP does not publish a global audit", async ({ page }) => {
  await page.goto("/screen/sales?voiceLive=1&xiaochuanMotion=gsap");
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => typeof (window as AuditWindow).__xiaochuanMotionAudit)).toBe("undefined");
});
async function clientNavigate(page: Page, href: string) {
  // Use the real Next Link router, preserving this window and any saved diagnostic closure.
  await page.locator(`a[href="${href}"]`).click();
}
test("rapid client route/mode switches revoke old closures and leave one live controller", async ({ page }) => {
  await page.goto("/poc/xiaochuan?xiaochuanMotion=gsap");
  for (let i = 0; i < 6; i++) {
    await expect.poll(() => page.evaluate(() => (window as AuditWindow).__xiaochuanMotionAudit?.()?.liveControllers)).toBe(1);
    await page.evaluate(() => { const w = window as AuditWindow; w.savedAudit = w.__xiaochuanMotionAudit; });
    await clientNavigate(page, "/poc/xiaochuan?xiaochuanMotion=legacy");
    await expect.poll(() => page.evaluate(() => typeof (window as AuditWindow).__xiaochuanMotionAudit)).toBe("undefined");
    expect(await page.evaluate(() => (window as AuditWindow).savedAudit?.())).toBeNull();
    await clientNavigate(page, "/poc/xiaochuan?xiaochuanMotion=gsap");
  }
  await expect.poll(() => page.evaluate(() => (window as AuditWindow).__xiaochuanMotionAudit?.()?.liveControllers)).toBe(1);
  await page.evaluate(() => { const w = window as AuditWindow; w.savedAudit = w.__xiaochuanMotionAudit; });
  await page.getByRole("button", { name: "卸载小川", exact: true }).click();
  expect(await page.evaluate(() => typeof (window as AuditWindow).__xiaochuanMotionAudit)).toBe("undefined");
  expect(await page.evaluate(() => (window as AuditWindow).savedAudit?.())).toBeNull();
});
