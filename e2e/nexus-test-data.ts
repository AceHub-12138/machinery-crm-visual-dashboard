import type { APIRequestContext, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { PublicSalesScreenPayload } from '../src/lib/voice/public-payload';
const seed = JSON.parse(readFileSync(new URL('../services/voice-orchestrator/fixtures/public-sales-screen.json', import.meta.url), 'utf8')) as PublicSalesScreenPayload;
const sanitized = JSON.parse(readFileSync(new URL('../src/lib/fixtures/nexus-sanitized.json', import.meta.url), 'utf8')) as { kpis: Partial<PublicSalesScreenPayload['kpis']>; collection: PublicSalesScreenPayload['collection']; routes: PublicSalesScreenPayload['delivery']['routes'] };
import { LONG_MODEL } from './fixtures/long-strings';
export function nexusPayload() {
  return { ...structuredClone(seed), version: 1 as const, generatedAt: new Date().toISOString(),
    kpis: { ...seed.kpis, ...sanitized.kpis }, collection: structuredClone(sanitized.collection),
    delivery: { ...structuredClone(seed.delivery), routes: structuredClone(sanitized.routes) } };
}
export function longNexusPayload(amount: number, count = 12) {
  const p = nexusPayload(); p.kpis.periodContractAmount = String(amount);
  p.delivery.routes = Array.from({ length: count }, (_, i) => ({ ...p.delivery.routes[i % p.delivery.routes.length], key: `long-${String(i).padStart(2, '0')}`, equipmentModel: LONG_MODEL, shipmentDate: `2030-10-${String(i + 1).padStart(2, '0')}` }));
  return p;
}
export async function setNexusPayload(request: APIRequestContext, payload: unknown) {
  const response = await request.post('http://127.0.0.1:3199/control', { data: payload });
  if (!response.ok()) throw new Error('Synthetic fixture injection failed');
}
export const SCREEN_VIEWPORTS = [{ width: 1280, height: 720 }, { width: 1792, height: 832 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }];
export function screenUrl(width: number) { return width === 1792 ? '/screen/sales' : '/screen/sales?layout=16x9'; }
export async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.nexus-money-hero[data-fit-ellipsis="false"]').waitFor();
}
