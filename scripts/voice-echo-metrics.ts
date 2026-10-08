export type Level = { ms: number; rms: number; peak: number };
export const dbFS = (value: number): number => 20 * Math.log10(Math.max(1e-6, value));
export function summarizeLevels(levels: Level[]) {
  const rms = levels.map(level => level.rms).sort((a, b) => a - b);
  const maxRms = rms.at(-1) ?? 0, peak = Math.max(0, ...levels.map(level => level.peak));
  const medianRms = rms[Math.floor(rms.length / 2)] ?? 0;
  return { frames: levels.length, maxRms, maxRmsDbFS: dbFS(maxRms), maxPeak: peak, maxPeakDbFS: dbFS(peak), medianRms, medianRmsDbFS: dbFS(medianRms) };
}
export type EchoObservation = { index: number; maxRms: number; starts: number; confirms: number; quality: boolean };
/** Caller verifies identical PCM, position, output path and volume. */
export function evaluatePickup(on: EchoObservation[], off: EchoObservation[]) {
  const pairs = off.map(row => {
    const reference = on.find(other => other.index === row.index);
    const riseDb = reference ? dbFS(row.maxRms) - dbFS(reference.maxRms) : null;
    const weakSignal = dbFS(row.maxRms) <= -55;
    return { index: row.index, aecOnDbFS: reference ? dbFS(reference.maxRms) : null, aecOffDbFS: dbFS(row.maxRms), riseDb, speechStart: row.starts, weakSignal,
      passed: !!reference && reference.quality && row.quality && (row.starts > 0 || (!weakSignal && riseDb !== null && riseDb >= 20)) };
  });
  const complete = pairs.length === 3 && off.every(row => row.quality && on.some(reference => reference.index === row.index && reference.quality));
  return { aggregation: "three valid matched clips; positive pickup evidence in the group", weakSignalBoundaryDbFS: -55, requiredRiseDb: 20, pairs, passed: complete && pairs.some(pair => pair.passed) };
}
export function evaluateHuman(rows: EchoObservation[]) {
  const successes = rows.filter(row => row.quality && row.confirms >= 1).length;
  return { attempts: rows.length, successes, requiredSuccesses: 4, passed: rows.length === 5 && rows.every(row => row.quality) && successes >= 4 };
}
