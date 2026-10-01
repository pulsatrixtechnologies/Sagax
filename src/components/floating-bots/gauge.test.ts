import { describe, expect, it } from "vitest";
import { gaugeFor, litSegments } from "./gauge";

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
