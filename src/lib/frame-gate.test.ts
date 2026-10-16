import { describe, expect, it } from "vitest";
import { createFrameGate, DISPLAY_RATE } from "./frame-gate";

/** How many of `frames` display frames at `hz` a gate draws at `fps`. */
function drawn(hz: number, fps: number, frames = 360): number {
  const gate = createFrameGate();
  let count = 0;
  for (let i = 0; i < frames; i += 1) if (gate((i * 1000) / hz, fps)) count += 1;
  return count;
}

describe("createFrameGate", () => {
  it("draws every display frame at the display rate: 120, 90 and 144 Hz alike", () => {
    expect(drawn(120, DISPLAY_RATE, 120)).toBe(120);
    expect(drawn(90, DISPLAY_RATE, 90)).toBe(90);
    expect(drawn(144, DISPLAY_RATE, 144)).toBe(144);
  });

  it("keeps a finite rate without aliasing down", () => {
    // one second of frames each time
    expect(drawn(120, 60, 120)).toBe(60);
    expect(drawn(60, 60, 60)).toBe(60);
    expect(drawn(120, 30, 120)).toBe(30);
    // the old `- 3 ms` test drew 45 here; the grid keeps 60
    expect(drawn(90, 60, 90)).toBeGreaterThanOrEqual(59);
    expect(drawn(90, 60, 90)).toBeLessThanOrEqual(61);
    expect(drawn(120, 12, 120)).toBe(12);
  });

  it("starts afresh after a stall instead of bursting to catch up", () => {
    const gate = createFrameGate();
    expect(gate(0, 30)).toBe(true);
    expect(gate(1000, 30)).toBe(true);
    // the next frame is a normal budget later, not a burst
    expect(gate(1008, 30)).toBe(false);
    expect(gate(1034, 30)).toBe(true);
  });
});

describe("the desktop mascots draw at the display's rate", () => {
  it("no loop caps at 60 fps any more", async () => {
    const { readFileSync } = await import("node:fs");
    for (const path of ["../components/OgreMascot.tsx", "../components/floating-bots/mascots.tsx", "../components/floating-bots/Owl25D.tsx"]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source, path).not.toMatch(/1000 \/ 60|Math\.min\(60/);
    }
  });
});
