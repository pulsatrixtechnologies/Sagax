// A transcript row drawn for the first time (content-visibility: auto) swaps
// its estimated height for its real one. Only rows wholly above the viewport
// move what the reader sees, so only their change moves scrollTop.
import { describe, expect, it } from "vitest";
import { offscreenAnchorShift } from "./use-offscreen-row-anchor";

describe("offscreenAnchorShift", () => {
  it("adds the change of rows wholly above the viewport", () => {
    expect(offscreenAnchorShift([
      { top: 0, previousHeight: 96, height: 240 },
      { top: 96, previousHeight: 96, height: 40 },
    ], 500)).toBe(144 - 56);
  });

  it("leaves rows in or below the viewport alone", () => {
    // straddles the top edge: the reader sees it grow downward, as before
    expect(offscreenAnchorShift([{ top: 450, previousHeight: 96, height: 300 }], 500)).toBe(0);
    expect(offscreenAnchorShift([{ top: 900, previousHeight: 96, height: 300 }], 500)).toBe(0);
  });

  it("counts a row that ended exactly at the viewport top", () => {
    expect(offscreenAnchorShift([{ top: 404, previousHeight: 96, height: 120 }], 500)).toBe(24);
  });
});
