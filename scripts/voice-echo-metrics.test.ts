import { expect, it } from "vitest";
import { dbFS, evaluateHuman, evaluatePickup, summarizeLevels, type EchoObservation } from "./voice-echo-metrics";
const rows = (maxRms: number, starts = 0): EchoObservation[] => [1, 2, 3].map(index => ({ index, maxRms, starts, confirms: 0, quality: true }));
it("uses amplitude dBFS and reports silence without Infinity", () => {
  expect(dbFS(.001)).toBeCloseTo(-60); expect(dbFS(.01) - dbFS(.001)).toBeCloseTo(20);
  expect(summarizeLevels([]).maxRmsDbFS).toBe(-120);
  expect(summarizeLevels([{ ms: 0, rms: .1, peak: .5 }]).maxPeakDbFS).toBeCloseTo(-6.0206);
});
it("rejects 20dB between two weak noise floors", () => { expect(evaluatePickup(rows(.00001), rows(.001)).passed).toBe(false); });
it("requires three matched controls, meaningful rise or SpeechStart", () => {
  expect(evaluatePickup(rows(.001), rows(.02)).passed).toBe(true);
  expect(evaluatePickup(rows(.001), rows(.001, 1)).passed).toBe(true);
  const onePositive = rows(.001); onePositive[1].starts = 1;
  expect(evaluatePickup(rows(.001), onePositive).passed).toBe(true);
  expect(evaluatePickup(rows(.001), rows(.002)).passed).toBe(false);
  expect(evaluatePickup(rows(.001), rows(.02).slice(0, 2)).passed).toBe(false);
  const invalid = rows(.02); invalid[0].quality = false; expect(evaluatePickup(rows(.001), invalid).passed).toBe(false);
});
it("counts successful trials rather than repeated confirmations", () => {
  const trials = [...rows(.1), ...rows(.1).slice(0, 2)].map((row, index) => ({ ...row, index, confirms: index === 0 ? 9 : 0 }));
  expect(evaluateHuman(trials).successes).toBe(1); expect(evaluateHuman(trials).passed).toBe(false);
  trials.forEach((row, index) => { row.confirms = index < 4 ? 1 : 0; }); expect(evaluateHuman(trials).passed).toBe(true);
});
