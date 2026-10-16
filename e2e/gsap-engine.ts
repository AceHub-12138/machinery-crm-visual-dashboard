import type { Page } from '@playwright/test';
/** Optional regression rerun against GSAP; no change to the default suites. */
export async function useExperimentalEngine(page: Page) {
  if (process.env.NEXUS_MOTION_ENGINE !== 'gsap') return;
  await page.route('**/screen/sales**', route => {
    const request = route.request(), url = new URL(request.url());
    if (request.isNavigationRequest() && !url.searchParams.has('motion')) {
      url.searchParams.set('motion', 'gsap'); return route.continue({ url: url.toString() });
    }
    return route.continue();
  });
}
