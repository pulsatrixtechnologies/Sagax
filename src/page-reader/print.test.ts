// Download PDF (src/page-reader/print.ts, shared/published-pages.ts): what a
// size message from the page's frame may set.
import { describe, expect, it } from "vitest";

import { PAGE_HEIGHT_MAX, parseSizeMessage } from "../../shared/published-pages";
import { printHeight } from "./print";

describe("the page's size for printing", () => {
  it("takes whole numbers of pixels from a size message only", () => {
    expect(parseSizeMessage({ type: "sagax-page-size", v: 1, h: 2400, vh: 748 })).toEqual({ h: 2400, vh: 748 });
    for (const bad of [null, "x", [], { type: "sagax-page-size", v: 2, h: 1, vh: 1 }, { type: "other", v: 1, h: 1, vh: 1 },
      { type: "sagax-page-size", v: 1, h: 1.5, vh: 1 }, { type: "sagax-page-size", v: 1, h: -1, vh: 1 }, { type: "sagax-page-size", v: 1, h: PAGE_HEIGHT_MAX + 1, vh: 1 },
      { type: "sagax-page-size", v: 1, h: "100", vh: 1 }]) {
      expect(parseSizeMessage(bad)).toBeNull();
    }
  });

  it("prints at least the window's height", () => {
    expect(printHeight({ h: 2400, vh: 748 })).toBe(2400);
    expect(printHeight({ h: 300, vh: 748 })).toBe(748);
  });
});
