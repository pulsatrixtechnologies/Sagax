import { describe, expect, it } from "vitest";
import { applySpeechControls, MAX_FAKE_OPEN_DELAY_MS, type FakeSpeechControls } from "./fake-xai-voice.ts";

const fresh = (): FakeSpeechControls => ({ refuse: false, openDelayMs: 0, dropAfter: 0, errorNext: false });

describe("fake xAI speech controls", () => {
  it("applies the known switches a test sends", () => {
    const speech = fresh();
    applySpeechControls(speech, { refuse: true, dropAfter: 1, openDelayMs: 250, errorNext: true });
    expect(speech).toEqual({ refuse: true, openDelayMs: 250, dropAfter: 1, errorNext: true });
  });

  it("bounds the delay and ignores unknown keys, wrong types and __proto__", () => {
    const speech = fresh();
    applySpeechControls(speech, JSON.parse('{"openDelayMs": 1e12, "refuse": "yes", "__proto__": {"polluted": true}, "extra": 1}'));
    expect(speech).toEqual({ refuse: false, openDelayMs: MAX_FAKE_OPEN_DELAY_MS, dropAfter: 0, errorNext: false });
    expect(Object.getPrototypeOf(speech)).toBe(Object.prototype);
    expect((speech as unknown as Record<string, unknown>).polluted).toBeUndefined();
    applySpeechControls(speech, { openDelayMs: -5 });
    expect(speech.openDelayMs).toBe(0);
    applySpeechControls(speech, null);
    applySpeechControls(speech, [1, 2]);
    expect(speech.openDelayMs).toBe(0);
  });
});
