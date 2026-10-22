import { describe, expect, it } from "vitest";
import { PlaybackSentenceEvidence, SentenceAnnouncements } from "./sentence-announcements";
import { LAUNCH } from "@/lib/voice/params";
const text = "第一句完整。第二句话完整。";
const options = { reduced: false, paused: false, finished: false, folded: false };
const at = (characters: number) => LAUNCH.unfoldStartMs + LAUNCH.unfoldMs + characters / LAUNCH.typeCps * 1000 + 1;
describe("complete sentence announcements independent of GSAP visual progress", () => {
  it("publishes only whole sentences on the compatibility clock", () => {
    const a = new SentenceAnnouncements(text, LAUNCH);
    expect(a.next(at(5), options)).toBeNull();
    expect(a.next(at(6), options)).toBe("第一句完整。");
    expect(a.next(at(8), options)).toBeNull();
    expect(a.next(at(text.length), options)).toBe("第二句话完整。");
    expect(a.next(at(100), options)).toBeNull();
  });
  it("PCM metadata wins over the clock and reduced motion; next start completes the prior sentence", () => {
    const a = new SentenceAnnouncements(text, LAUNCH), evidence = new PlaybackSentenceEvidence(true);
    const o = { ...options, reduced: true, evidence };
    expect(a.next(10000, o)).toBeNull(); evidence.start(0);
    expect(a.next(10001, o)).toBeNull(); evidence.start(1);
    expect(a.next(10002, o)).toBe("第一句完整。"); evidence.drain();
    expect(a.next(10003, { ...o, finished: true })).toBe("第二句话完整。");
    expect(a.next(10004, o)).toBeNull();
  });
  it("does not announce an incomplete/skipped PCM sentence", () => {
    const a = new SentenceAnnouncements(text, LAUNCH), evidence = new PlaybackSentenceEvidence(true);
    evidence.start(0); evidence.skip(0); evidence.start(1);
    expect(a.next(10000, { ...options, evidence })).toBeNull(); evidence.drain();
    expect(a.next(10001, { ...options, evidence })).toBe("第二句话完整。");
  });
  it("a paused completion waits for resume, without announcing twice", () => {
    const a = new SentenceAnnouncements(text, LAUNCH), evidence = new PlaybackSentenceEvidence(true);
    evidence.start(0); evidence.start(1);
    expect(a.next(1000, { ...options, evidence, paused: true })).toBeNull();
    expect(a.next(2000, { ...options, evidence })).toBe("第一句完整。");
    expect(a.next(3000, { ...options, evidence })).toBeNull();
  });
  it("cancellation, finished compatibility turns and folded old cards cannot publish late", () => {
    for (const end of [{ finished: true }, { folded: true }]) {
      const a = new SentenceAnnouncements(text, LAUNCH);
      expect(a.next(100, { ...options, ...end })).toBeNull();
      expect(a.next(10000, options)).toBeNull();
    }
    const a = new SentenceAnnouncements(text, LAUNCH), evidence = new PlaybackSentenceEvidence(true);
    evidence.start(0); evidence.cancel(); evidence.drain(); evidence.start(1);
    expect(a.next(10000, { ...options, evidence })).toBeNull();
  });
  it("audio failure uses the safe full-sentence clock, retaining previously published indices", () => {
    const a = new SentenceAnnouncements(text, LAUNCH), evidence = new PlaybackSentenceEvidence(true);
    evidence.start(0); evidence.start(1);
    expect(a.next(at(6), { ...options, evidence })).toBe("第一句完整。"); evidence.fail();
    expect(a.next(at(8), { ...options, evidence })).toBeNull();
    expect(a.next(at(text.length), { ...options, evidence })).toBe("第二句话完整。");
  });
  it("reduced motion without PCM preserves the complete accessible answer", () => {
    const a = new SentenceAnnouncements(text, LAUNCH);
    expect(a.next(0, { ...options, reduced: true })).toBe(text);
  });
  it("a new answer has its own publication ledger", () => {
    const old = new SentenceAnnouncements(text, LAUNCH), next = new SentenceAnnouncements(text, LAUNCH);
    expect(old.next(at(6), options)).toBe("第一句完整。");
    old.next(10000, { ...options, folded: true });
    expect(next.next(at(6), options)).toBe("第一句完整。"); expect(old.next(10000, options)).toBeNull();
  });
  it("duplicate, out-of-order and late PCM starts cannot complete a sentence early", () => {
    const evidence = new PlaybackSentenceEvidence(true), a = new SentenceAnnouncements(text, LAUNCH);
    evidence.start(0); evidence.start(0);
    expect(a.next(1000, { ...options, evidence })).toBeNull();
    evidence.start(1); evidence.start(0);
    expect(a.next(1001, { ...options, evidence })).toBe("第一句完整。");
    evidence.fail(); evidence.start(1); evidence.drain();
    expect(evidence.status).toBe("failed"); expect(evidence.completed.has(1)).toBe(false);
  });
});
