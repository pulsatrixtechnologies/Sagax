import { describe, expect, it } from "vitest";

import { CROP_CIRCLE, clampPan, cropLayout, cropView } from "./avatar-crop";

describe("the own photo crop", () => {
  it("covers the circle at zoom 1 and takes the centred square of a wide photo", () => {
    const layout = cropLayout(1000, 500, 1, 0, 0);
    expect(layout.height).toBe(CROP_CIRCLE);
    expect(layout.width).toBe(CROP_CIRCLE * 2);
    expect(cropView(1000, 500, 1, 0, 0)).toEqual({ sx: 250, sy: 0, sw: 500, sh: 500 });
  });

  it("takes a smaller square when zoomed and follows the pan", () => {
    const view = cropView(1000, 1000, 2, 0, 0);
    expect(view).toEqual({ sx: 250, sy: 250, sw: 500, sh: 500 });
    // moving the photo right shows more of its left side
    expect(cropView(1000, 1000, 2, 100, 0).sx).toBeLessThan(250);
  });

  it("keeps the photo over the whole circle", () => {
    expect(clampPan(1000, 500, 1, 10_000, 10_000)).toEqual({ x: CROP_CIRCLE / 2, y: 0 });
    expect(clampPan(1000, 500, 1, -10_000, -50)).toEqual({ x: -CROP_CIRCLE / 2, y: 0 });
  });
});
