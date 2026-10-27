import { describe, expect, it } from "vitest";
import { cleanRoutineAutoPauseAfter, ROUTINE_AUTO_PAUSE_DEFAULT, routineAutoPauseAfter, routineAutoPauseDue } from "./routine-auto-pause.ts";

describe("routine auto-pause setting (2026-10-26)", () => {
  it("defaults to 5, 0 never pauses, and the routine's own count wins", () => {
    expect(ROUTINE_AUTO_PAUSE_DEFAULT).toBe(5);
    expect(routineAutoPauseAfter({})).toBe(5);
    expect(routineAutoPauseAfter({ autoPauseAfter: 0 })).toBe(0);
    expect(routineAutoPauseAfter({ autoPauseAfter: 3 })).toBe(3);
    expect(routineAutoPauseDue({}, 4)).toBe(false);
    expect(routineAutoPauseDue({}, 5)).toBe(true);
    expect(routineAutoPauseDue({ autoPauseAfter: 0 }, 1000)).toBe(false);
    expect(routineAutoPauseDue({ autoPauseAfter: 1 }, 1)).toBe(true);
  });

  it("stores the default as absent and refuses what is not a whole number from 0 to 100", () => {
    expect(cleanRoutineAutoPauseAfter(undefined)).toBeUndefined();
    expect(cleanRoutineAutoPauseAfter(null)).toBeUndefined();
    expect(cleanRoutineAutoPauseAfter(5)).toBeUndefined();
    expect(cleanRoutineAutoPauseAfter(0)).toBe(0);
    expect(cleanRoutineAutoPauseAfter(100)).toBe(100);
    for (const bad of [-1, 101, 2.5, "3", Number.NaN]) expect(() => cleanRoutineAutoPauseAfter(bad)).toThrow();
  });
});
