// Where the reaction pill, the "…" menu and the reaction picker go beside a
// chat message (JC, 2026-10-18): the first message at the top, the last one
// at the bottom, a short window, a narrow one, bubbles on both sides.
import { describe, expect, it } from "vitest";

import { placePopover, POPOVER_EDGE, POPOVER_GAP } from "./popover-placement";

const view = { width: 1100, height: 780 };
const pill = { width: 225, height: 45 };
const picker = { width: 272, height: 309 };
const row = (top: number, left = 600, width = 120, height = 24) => ({ left, top, right: left + width, bottom: top + height });

describe("placePopover: vertical side", () => {
  it("opens below the row when it fits", () => {
    const spot = placePopover(row(300), pill, view, { prefer: "below" });
    expect(spot.side).toBe("below");
    expect(spot.top).toBe(324 + POPOVER_GAP);
    expect(spot.maxHeight).toBeUndefined();
  });

  it("opens above the last message at the bottom of the window", () => {
    const anchor = row(740);
    const spot = placePopover(anchor, pill, view, { prefer: "below" });
    expect(spot.side).toBe("above");
    expect(spot.top).toBe(anchor.top - POPOVER_GAP - pill.height);
  });

  it("opens the picker below the first message when the top has no room", () => {
    const anchor = row(60);
    const spot = placePopover(anchor, picker, view, { prefer: "above" });
    expect(spot.side).toBe("below");
    expect(spot.top).toBe(anchor.bottom + POPOVER_GAP);
  });

  it("keeps the picker above a message low in the window", () => {
    const anchor = row(600);
    const spot = placePopover(anchor, picker, view, { prefer: "above" });
    expect(spot.side).toBe("above");
    expect(spot.top).toBe(anchor.top - POPOVER_GAP - picker.height);
  });

  it("takes the roomier side and stays inside a window too short for either", () => {
    const short = { width: 840, height: 400 };
    const spot = placePopover(row(150), picker, short, { prefer: "above" });
    expect(spot.side).toBe("below");
    expect(spot.top).toBeGreaterThanOrEqual(POPOVER_EDGE);
    expect(spot.top + picker.height).toBeLessThanOrEqual(short.height - POPOVER_EDGE);
  });

  it("caps the height when the window is shorter than the popover", () => {
    const tiny = { width: 840, height: 250 };
    const spot = placePopover(row(100), picker, tiny, { prefer: "above" });
    expect(spot.maxHeight).toBe(tiny.height - 2 * POPOVER_EDGE);
    expect(spot.top).toBe(POPOVER_EDGE);
  });

  it("never leaves the window for an anchor scrolled past an edge", () => {
    for (const top of [-200, 2000]) {
      const spot = placePopover(row(top), pill, view, { prefer: "below" });
      expect(spot.top).toBeGreaterThanOrEqual(POPOVER_EDGE);
      expect(spot.top + pill.height).toBeLessThanOrEqual(view.height - POPOVER_EDGE);
    }
  });
});

describe("placePopover: horizontal edge", () => {
  it("lines up with the row's left edge for a bot's bubble", () => {
    expect(placePopover(row(300, 400), pill, view, { edge: "left" }).left).toBe(400);
  });

  it("lines up with the row's right edge for a person's bubble", () => {
    const anchor = row(300, 800);
    expect(placePopover(anchor, pill, view, { edge: "right" }).left).toBe(anchor.right - pill.width);
  });

  it("slides back inside at the right border", () => {
    const spot = placePopover(row(300, 1000), pill, view, { edge: "left" });
    expect(spot.left).toBe(view.width - POPOVER_EDGE - pill.width);
  });

  it("slides back inside at the left border", () => {
    const spot = placePopover(row(300, 20, 80), picker, view, { edge: "right" });
    expect(spot.left).toBe(POPOVER_EDGE);
  });

  it("starts at the left margin in a window narrower than the popover", () => {
    const narrow = { width: 240, height: 780 };
    expect(placePopover(row(300, 100), picker, narrow, { edge: "right" }).left).toBe(POPOVER_EDGE);
  });
});
