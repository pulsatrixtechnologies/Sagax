import { describe, expect, it } from "vitest";
import { crossedThreshold, GAUGE_LINGER_MS, gaugeFor, gaugeShown, litSegments } from "./gauge";

const ctx = (percent?: number) => ({ percent, tokens: 1000, window: percent === undefined ? undefined : 200_000, detail: "d", label: "l" });

describe("the context energy bar", () => {
  it("shows the energy left: a full bar for an empty context, draining as it fills", () => {
    expect(gaugeFor(ctx(0))).toEqual({ remaining: 100, level: "ok", pulse: false });
    expect(gaugeFor(ctx(24))?.remaining).toBe(76);
    expect(gaugeFor(ctx(140))?.remaining).toBe(0);
    expect(gaugeFor(null)).toBeNull();
  });

  it("turns amber at half full and red from 80 %, like the header ring, and pulses past 85 %", () => {
    expect(gaugeFor(ctx(49))?.level).toBe("ok");
    expect(gaugeFor(ctx(50))?.level).toBe("warn");
    expect(gaugeFor(ctx(79))?.level).toBe("warn");
    expect(gaugeFor(ctx(80))).toMatchObject({ level: "danger", pulse: false });
    expect(gaugeFor(ctx(86))).toMatchObject({ level: "danger", pulse: true });
  });

  it("stays neutral when the window size is unknown", () => {
    expect(gaugeFor(ctx(undefined))).toEqual({ remaining: 100, level: "unknown", pulse: false });
  });

  it("lights whole segments", () => {
    expect(litSegments(100)).toBe(10);
    expect(litSegments(76)).toBe(8);
    expect(litSegments(1)).toBe(1);
    expect(litSegments(0)).toBe(0);
  });
});

describe("when the energy bar shows", () => {
  it("only while the person deals with the mascot, and a moment after", () => {
    expect(gaugeShown({ interacting: true, lingerUntil: 0 }, 1000)).toBe(true);
    expect(gaugeShown({ interacting: false, lingerUntil: 1000 + GAUGE_LINGER_MS }, 2000)).toBe(true);
    expect(gaugeShown({ interacting: false, lingerUntil: 1000 }, 2000)).toBe(false);
  });

  it("a moment when the context crosses 50, 80 or 85 %, not while it stays past one", () => {
    expect(crossedThreshold(48, 52)).toBe(true);
    expect(crossedThreshold(79, 81)).toBe(true);
    expect(crossedThreshold(84, 86)).toBe(true);
    expect(crossedThreshold(52, 60)).toBe(false);
    expect(crossedThreshold(90, 40)).toBe(false);
    expect(crossedThreshold(undefined, 90)).toBe(false);
  });
});
