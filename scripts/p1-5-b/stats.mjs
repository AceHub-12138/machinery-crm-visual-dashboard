import { nearestRank } from '../p1-5-a/metrics.mjs';

export const median = values => nearestRank(values, 0.5);

export function dispersion(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return { count: 0, median: null, p25: null, p75: null, iqr: null, min: null, max: null, mad: null };
  const center = median(clean);
  const p25 = nearestRank(clean, 0.25), p75 = nearestRank(clean, 0.75);
  return {
    count: clean.length,
    median: center,
    p25,
    p75,
    iqr: p75 - p25,
    min: Math.min(...clean),
    max: Math.max(...clean),
    mad: median(clean.map(value => Math.abs(value - center))),
  };
}
