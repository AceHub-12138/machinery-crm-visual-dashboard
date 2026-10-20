import type { QualityMode } from './QualityPolicy';
export function localQualityPermission(permission: string | undefined, host: string | null) {
  return !!host && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) && ['local-shadow', 'local-candidate'].includes(permission ?? '');
}
/** Evaluated on the server. No NEXT_PUBLIC grant and no URL-only bypass. */
export function resolveQualityMode(params: Record<string, string | string[] | undefined>, permission: string | undefined, host: string | null): QualityMode {
  if (!localQualityPermission(permission, host)) return 'baseline';
  if (params.debug !== '1') return 'baseline';
  if (params.qualityExperiment === 'candidate' && permission === 'local-candidate') return 'candidate';
  if (params.qualityExperiment === 'shadow' && (permission === 'local-shadow' || permission === 'local-candidate')) return 'shadow';
  return 'baseline';
}
