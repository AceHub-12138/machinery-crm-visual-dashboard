import { buildSpokenSentences } from "@/lib/voice/spoken-normalize";
import { launchPhase, typedChars, type LaunchConfig } from "@/lib/voice/params";

/** Observes existing PCM callbacks only; never schedules or controls audio. */
export class PlaybackSentenceEvidence {
  readonly completed = new Set<number>();
  private readonly skipped = new Set<number>();
  private active: number | null = null;
  status: "pending" | "playing" | "drained" | "failed" | "cancelled" = "pending";
  constructor(readonly metadata: boolean) {}
  start(index: number) {
    if (!["pending", "playing"].includes(this.status) || index === this.active || (this.active !== null && index < this.active)) return;
    this.completeActive(); this.active = index; this.status = "playing";
  }
  skip(index: number) { this.skipped.add(index); this.completed.delete(index); }
  drain() { if (!["pending", "playing"].includes(this.status)) return; this.completeActive(); this.active = null; this.status = "drained"; }
  fail() { if (this.status !== "cancelled") { this.active = null; this.status = "failed"; } }
  cancel() { this.active = null; this.status = "cancelled"; }
  private completeActive() { if (this.active !== null && !this.skipped.has(this.active)) this.completed.add(this.active); }
}

/** Independent complete-sentence publication clock. Visual text may already be full. */
export class SentenceAnnouncements {
  private readonly sentences;
  private readonly published = new Set<number>();
  private stopped = false;
  private lastElapsed = 0;
  private pausedMs = 0;
  private wasPaused = false;
  constructor(private readonly text: string, private readonly config: LaunchConfig) {
    this.sentences = buildSpokenSentences(text);
  }
  get done() { return this.stopped || this.published.size === this.sentences.length; }
  next(elapsed: number, options: { reduced: boolean; paused: boolean; finished: boolean; folded: boolean; evidence?: PlaybackSentenceEvidence }): string | null {
    const { evidence, reduced, paused, finished, folded } = options;
    if (folded || evidence?.status === "cancelled" || (finished && evidence?.status !== "drained")) this.stopped = true;
    if (paused || this.wasPaused) this.pausedMs += Math.max(0, elapsed - this.lastElapsed);
    this.lastElapsed = elapsed; this.wasPaused = paused;
    if (this.stopped || paused) return null;
    const actual = evidence?.metadata && evidence.status !== "failed";
    const typed = reduced ? this.text.length : typedChars(this.text, launchPhase(Math.max(0, elapsed - this.pausedMs), this.config).typingMs, this.config.typeCps);
    const ready = this.sentences.filter(sentence => !this.published.has(sentence.index)
      && (actual ? evidence.completed.has(sentence.index) : sentence.displayEnd <= typed));
    ready.forEach(sentence => this.published.add(sentence.index));
    return ready.length ? ready.map(sentence => sentence.text).join("") : null;
  }
}
