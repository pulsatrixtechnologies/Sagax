import { describe, expect, it } from "vitest";

import { zonedParts, zonedTimeToUtc } from "./zoned-time.ts";

describe("zoned time", () => {
  it("reads the wall clock in a zone", () => {
    const at = Date.UTC(2026, 9, 1, 13, 30); // 2026-10-01 13:30 UTC, a Thursday
    expect(zonedParts(at, "America/Toronto")).toEqual({ year: 2026, month: 10, day: 1, hour: 9, minute: 30, weekday: 4 });
    expect(zonedParts(at, "Asia/Tokyo")).toEqual({ year: 2026, month: 10, day: 1, hour: 22, minute: 30, weekday: 4 });
    expect(zonedParts(Date.UTC(2026, 9, 1, 23, 0), "Asia/Tokyo")).toMatchObject({ day: 2, hour: 8, weekday: 5 });
  });

  it("turns a wall clock back into the instant, across DST", () => {
    expect(zonedTimeToUtc(2026, 10, 1, 9, 0, "America/Toronto")).toBe(Date.UTC(2026, 9, 1, 13, 0));
    expect(zonedTimeToUtc(2026, 1, 15, 9, 0, "America/Toronto")).toBe(Date.UTC(2026, 0, 15, 14, 0));
    expect(zonedTimeToUtc(2026, 10, 1, 9, 0, "UTC")).toBe(Date.UTC(2026, 9, 1, 9, 0));
    // 2026-03-08 02:30 does not exist in Toronto: it lands an hour later.
    expect(zonedTimeToUtc(2026, 3, 8, 2, 30, "America/Toronto")).toBe(Date.UTC(2026, 2, 8, 7, 30));
    // 2026-11-01 01:30 happens twice: the first one (EDT) is used.
    expect(zonedTimeToUtc(2026, 11, 1, 1, 30, "America/Toronto")).toBe(Date.UTC(2026, 10, 1, 5, 30));
    // Day overflow rolls over.
    expect(zonedTimeToUtc(2026, 9, 31, 9, 0, "UTC")).toBe(Date.UTC(2026, 9, 1, 9, 0));
  });
});
