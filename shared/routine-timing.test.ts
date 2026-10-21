import { describe, expect, it } from "vitest";

import {
  FLEXIBLE_DEFAULT_EARLY_MINUTES,
  FLEXIBLE_DEFAULT_LATE_MINUTES,
  applyTiming,
  clampTimingWindow,
  dailyGapMs,
  flexibleStartAt,
  nominalGapMs,
  placedStart,
  windowCapMinutes,
} from "./routine-timing.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe("flexible timing windows", () => {
  it("defaults an omitted window to 15 minutes on each side", () => {
    expect(FLEXIBLE_DEFAULT_EARLY_MINUTES).toBe(15);
    expect(FLEXIBLE_DEFAULT_LATE_MINUTES).toBe(15);
    const daily = { type: "daily" as const, time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] };
    expect(applyTiming(daily, { timing: "flexible" }, nominalGapMs(daily, 0))).toEqual({
      ...daily,
      timing: "flexible",
      windowEarlyMinutes: 15,
      windowLateMinutes: 15,
    });
  });

  it("leaves exact timing, including a missing choice, unchanged", () => {
    const daily = { type: "daily" as const, time: "09:00", weekdays: [1, 2, 3, 4, 5] };
    expect(applyTiming(daily, {}, nominalGapMs(daily, 0))).toEqual(daily);
    expect(applyTiming(daily, { timing: "exact" }, nominalGapMs(daily, 0))).toEqual(daily);
    expect(() => applyTiming(daily, { timing: "exact", windowEarlyMinutes: 5 }, nominalGapMs(daily, 0))).toThrow(/window/i);
    expect(() => applyTiming({ type: "once", at: 1 }, { timing: "flexible" }, DAY)).toThrow(/one-time/i);
    expect(() => applyTiming(daily, { timing: "soon" }, DAY)).toThrow(/exact or flexible/i);
  });

  it("caps the window at half the gap for a daily, an interval, and a cron", () => {
    expect(windowCapMinutes(dailyGapMs([1]))).toBe((7 * 24 * 60) / 2);
    expect(windowCapMinutes(dailyGapMs([0, 1, 2, 3, 4, 5, 6]))).toBe(12 * 60);
    expect(windowCapMinutes(nominalGapMs({ type: "interval", everyMinutes: 10 }, 0))).toBe(5);
    expect(windowCapMinutes(nominalGapMs({ type: "interval", everyMinutes: 5 }, 0))).toBe(2);
    const cron = { type: "cron" as const, expression: "*/10 * * * *", timeZone: "UTC" };
    expect(nominalGapMs(cron, Date.parse("2026-06-01T00:00:00Z"))).toBe(10 * MINUTE);
    expect(windowCapMinutes(nominalGapMs(cron, Date.parse("2026-06-01T00:00:00Z")))).toBe(5);

    const everyTen = { type: "interval" as const, everyMinutes: 10, anchorAt: 0 };
    const capped = applyTiming(
      everyTen,
      { timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 },
      nominalGapMs(everyTen, 0),
    );
    expect(capped.windowEarlyMinutes! + capped.windowLateMinutes!).toBe(5);
    expect(clampTimingWindow(15, 0, 5)).toEqual({ early: 5, late: 0 });
    expect(clampTimingWindow(0, 15, 5)).toEqual({ early: 0, late: 5 });

    const daily = { type: "daily" as const, time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] };
    const wide = applyTiming(
      daily,
      { timing: "flexible", windowEarlyMinutes: 10_000, windowLateMinutes: 10_000 },
      nominalGapMs(daily, 0),
    );
    expect(wide.windowEarlyMinutes! + wide.windowLateMinutes!).toBe(12 * 60);
  });

  it("picks a start inside the window, the same one every time, and a late window of 0 never after the slot", () => {
    const nominal = Date.parse("2026-06-02T00:10:00Z");
    const midnight = Date.parse("2026-06-02T00:00:00Z");
    const starts = new Set<number>();
    let crossedMidnight = false;
    for (let index = 0; index < 80; index++) {
      const id = `slot-${index}`;
      const start = flexibleStartAt(id, nominal, 30, 15);
      expect(start).toBe(flexibleStartAt(id, nominal, 30, 15));
      expect(start).toBeGreaterThanOrEqual(nominal - 30 * MINUTE);
      expect(start).toBeLessThanOrEqual(nominal + 15 * MINUTE);
      if (start < midnight) crossedMidnight = true;
      starts.add(start);
    }
    expect(crossedMidnight).toBe(true);
    expect(starts.size).toBeGreaterThan(1);

    const onTime = flexibleStartAt("ready", nominal, 20, 0);
    expect(onTime).toBeLessThanOrEqual(nominal);
    expect(onTime).toBeGreaterThanOrEqual(nominal - 20 * MINUTE);
    expect(flexibleStartAt("point", nominal, 0, 0)).toBe(nominal);
    expect(placedStart(nominal - 10 * MINUTE, nominal, 0, nominal - 5 * MINUTE)).toBe(nominal - 5 * MINUTE);
    expect(placedStart(nominal - 10 * MINUTE, nominal, 0, nominal + MINUTE)).toBeNull();
  });
});
