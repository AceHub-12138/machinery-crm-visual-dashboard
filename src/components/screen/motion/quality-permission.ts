import type { QualityMode } from './QualityPolicy';
export function localQualityPermission(permission: string | undefined, host: string | null, verifiedBoundary = false) {
  return verifiedBoundary === true && !!host && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) && ['local-shadow', 'local-candidate'].includes(permission ?? '');
}
/** Host is an additional check, never proof of the listener or peer's network boundary. */
export function resolveQualityMode(params: Record<string, string | string[] | undefined>, permission: string | undefined, host: string | null, verifiedBoundary = false): QualityMode {
  if (!localQualityPermission(permission, host, verifiedBoundary)) return 'baseline';
  if (params.debug !== '1') return 'baseline';
  if (params.qualityExperiment === 'candidate' && permission === 'local-candidate') return 'candidate';
  if (params.qualityExperiment === 'shadow' && (permission === 'local-shadow' || permission === 'local-candidate')) return 'shadow';
  return 'baseline';
}
