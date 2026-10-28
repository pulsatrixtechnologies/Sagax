import { describe, expect, it } from "vitest";
import { VOICE_SUMMARY_MIN_CHARS, voiceSummary } from "./voice-summary";

describe("voiceSummary", () => {
  it("leaves a short reply alone", () => {
    expect(voiceSummary("A short answer.")).toBeNull();
  });

  it("summarizes a long reply without dropping the original", () => {
    const sentence = "The report covers the weekly numbers and the open questions. ";
    const text = sentence.repeat(40);
    expect(text.length).toBeGreaterThan(VOICE_SUMMARY_MIN_CHARS);
    const summary = voiceSummary(text);
    expect(summary).toBeTruthy();
    expect(summary!.length).toBeLessThan(text.length);
    expect(summary!.startsWith("The report covers")).toBe(true);
    expect(text.includes(sentence.trim())).toBe(true);
  });
});
