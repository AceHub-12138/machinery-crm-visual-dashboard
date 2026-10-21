import { test as base, expect } from "@playwright/test";
/** Opt-in regression fixture: existing tests keep their assertions and audio path.
 * The URL is only a selector; the real production server still decides permission.
 */
export const test = base.extend<{ xiaochuanMode: void }>({
  xiaochuanMode: [async ({ context }, use) => {
    const mode = process.env.P161_OVERLAY_MODE;
    if (mode !== "gsap" && mode !== "legacy") { await use(); return; }
    const decisions: Array<Promise<string | undefined>> = [];
    context.on("response", response => {
      if (response.request().isNavigationRequest() && new URL(response.url()).pathname === "/screen/sales") {
        decisions.push(response.text().then(html => html.replace(/\\+"/g, '"').match(/"xiaochuanMotion":"(legacy|gsap)","xiaochuanAuditAllowed":(?:true|false)/)?.[1]));
      }
    });
    await context.route("**/screen/sales**", route => {
      if (!route.request().isNavigationRequest()) return route.continue();
      const url = new URL(route.request().url()); url.searchParams.set("xiaochuanMotion", mode);
      return route.continue({ url: url.toString() });
    });
    await use();
    for (const selected of await Promise.all(decisions)) expect(selected).toBe(mode);
  }, { auto: true }],
});
export { expect, type Page } from "@playwright/test";
