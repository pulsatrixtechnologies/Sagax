import { describe, expect, it } from "vitest";
import { MOOD_DECAY_PER_HOUR, MOOD_FLOOR, MOOD_GAINS, MOOD_START, moodLevel, moodNow, raiseMood, readMoods, writeMoods, type MoodStorage } from "./mood";

const HOUR = 3_600_000;

function memoryStorage(): MoodStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

describe("mascot mood", () => {
  it("starts content and rises with play, strokes and finished tasks, up to full", () => {
    expect(moodNow(undefined, 0)).toBe(MOOD_START);
    const played = raiseMood(undefined, "play", 0);
    expect(played.value).toBeCloseTo(MOOD_START + MOOD_GAINS.play);
    const petted = raiseMood(played, "pet", 0);
    expect(petted.value).toBeCloseTo(MOOD_START + MOOD_GAINS.play + MOOD_GAINS.pet);
    expect(raiseMood(petted, "task", 0).value).toBeGreaterThan(petted.value);
    expect(raiseMood({ value: 0.99, at: 0 }, "task", 0).value).toBe(1);
  });

  it("drifts down slowly with neglect, never below the floor", () => {
    expect(moodNow({ value: 0.9, at: 0 }, 10 * HOUR)).toBeCloseTo(0.9 - 10 * MOOD_DECAY_PER_HOUR);
    expect(moodNow({ value: 0.9, at: 0 }, 1000 * HOUR)).toBe(MOOD_FLOOR);
    // a clock that went backwards does not raise it
    expect(moodNow({ value: 0.5, at: HOUR }, 0)).toBe(0.5);
    // a play after a long absence starts from the drifted value
    expect(raiseMood({ value: 0.9, at: 0 }, "play", 1000 * HOUR).value).toBeCloseTo(MOOD_FLOOR + MOOD_GAINS.play);
  });

  it("names three levels for the meter", () => {
    expect(moodLevel(0.25)).toBe("low");
    expect(moodLevel(0.6)).toBe("ok");
    expect(moodLevel(0.9)).toBe("happy");
  });

  it("is kept per bot on this device and read back safely", () => {
    const storage = memoryStorage();
    writeMoods({ bot_a: { value: 0.8, at: 5 }, bot_b: { value: 0.3, at: 7 } }, storage);
    expect(readMoods(storage)).toEqual({ bot_a: { value: 0.8, at: 5 }, bot_b: { value: 0.3, at: 7 } });
    storage.setItem("omb.floatingBots.mood.v1", JSON.stringify({ bots: { "../x": { value: 1, at: 1 }, bot_c: { value: "x", at: 1 }, bot_d: { value: 7, at: 1 } } }));
    expect(readMoods(storage)).toEqual({ bot_d: { value: 1, at: 1 } });
    storage.setItem("omb.floatingBots.mood.v1", "{nope");
    expect(readMoods(storage)).toEqual({});
    expect(readMoods(undefined)).toEqual({});
  });
});
