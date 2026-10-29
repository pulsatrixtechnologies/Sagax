import { describe, expect, it } from "vitest";
import { DICTATION_BARS, DICTATION_HOLD_MS, DICTATION_RATE, dictationEngine, dictationFrame, isDictationHold, dictationLevels, formatDictationTime, joinDictated } from "./composer-dictation";

describe("composer dictation", () => {
  it("dictates with xAI whenever a key serves, the Mac's own only as a fallback, else none (2026-10-28)", () => {
    expect(dictationEngine({ native: true, xai: true })).toBe("xai");
    expect(dictationEngine({ native: false, xai: true })).toBe("xai");
    expect(dictationEngine({ native: true, xai: false })).toBe("native");
    expect(dictationEngine({ native: false, xai: false })).toBeNull();
  });

  it("formats the chip's timer", () => {
    expect(formatDictationTime(0)).toBe("0:00");
    expect(formatDictationTime(4.7)).toBe("0:04");
    expect(formatDictationTime(83)).toBe("1:23");
    expect(formatDictationTime(-2)).toBe("0:00");
  });

  it("gives five bars, newest last, clamped to 0..1", () => {
    expect(dictationLevels([])).toEqual(Array(DICTATION_BARS).fill(0));
    const bars = dictationLevels([0.5, 0, 0.01, 0.05, 0.2, 2]);
    expect(bars).toHaveLength(DICTATION_BARS);
    expect(bars.at(-1)).toBe(1);
    expect(bars[0]).toBe(0);
    for (const bar of bars) expect(bar).toBeGreaterThanOrEqual(0);
  });

  it("joins what was heard to the draft", () => {
    expect(joinDictated("", " bonjour ")).toBe("bonjour");
    expect(joinDictated("Salut", "ça va")).toBe("Salut ça va");
    expect(joinDictated("Salut", "  ")).toBe("Salut");
  });

  it("tells a tap from a hold at 350 ms", () => {
    expect(DICTATION_HOLD_MS).toBe(350);
    expect(isDictationHold(1000, 1200)).toBe(false);
    expect(isDictationHold(1000, 1350)).toBe(true);
  });
});

describe("dictationFrame", () => {
  it("passes 16 kHz frames through and brings 48 kHz down to it", () => {
    const same = new Float32Array([0.1, 0.2]);
    expect(dictationFrame(same, DICTATION_RATE)).toBe(same);
    const high = new Float32Array(1024).fill(0.3);
    const down = dictationFrame(high, 48_000);
    expect(down.length).toBe(341);
    expect(down[0]).toBeCloseTo(0.3);
  });
});
