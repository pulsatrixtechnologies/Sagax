// A call turn's latency timeline (latency.ts): the stages from the person's
// last word to the first audio, the log line (ids and milliseconds only),
// percentiles, and when final words differ enough to send a turn again.
import { describe, expect, it } from "vitest";

import { formatTimeline, materiallyDifferent, percentile, stageDurations } from "./latency";

describe("a turn's timeline", () => {
  const turn = {
    utteranceId: "utt-00000001", stoppedAt: 1_000, endedAt: 1_352, earlyEnd: true, transcribedAt: 1_352, earlyStart: true,
    sentAt: 1_354, firstTokenAt: 1_990, firstSentenceAt: 1_995, ttsFirstByteAt: 2_300, firstAudioAt: 2_315,
  };

  it("splits the pause into its stages", () => {
    expect(stageDurations(turn)).toEqual({ endpoint: 352, stt: 0, dispatch: 2, firstToken: 636, firstSentence: 5, tts: 305, playback: 15, total: 1_315 });
    // a turn still waiting: only the stages it reached
    expect(stageDurations({ stoppedAt: 0, endedAt: 700 })).toEqual({ endpoint: 700 });
  });

  it("logs ids and milliseconds, flags how the turn was taken", () => {
    expect(formatTimeline(turn)).toBe("[voice-latency] utt=utt-00000001 endpoint=352ms stt=0ms dispatch=2ms firstToken=636ms firstSentence=5ms tts=305ms playback=15ms total=1315ms (early-end, early-start)");
  });

  it("takes nearest-rank percentiles", () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([], 50)).toBeUndefined();
  });
});

describe("final words that differ", () => {
  it("ignores case, punctuation, accents and fillers; any other word counts", () => {
    expect(materiallyDifferent("What time is it in Tokyo", "what time is it in Tokyo?")).toBe(false);
    expect(materiallyDifferent("Quelle heure est-il a Montreal", "Euh, quelle heure est-il à Montréal?")).toBe(false);
    expect(materiallyDifferent("What time is it in Tokyo?", "What time is it in Toronto?")).toBe(true);
    expect(materiallyDifferent("call Max", "call Max about the invoice")).toBe(true);
    // no final words: nothing to correct
    expect(materiallyDifferent("call Max", "")).toBe(false);
  });
});
