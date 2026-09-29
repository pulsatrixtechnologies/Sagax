import { describe, expect, it } from "vitest";

import { MAUS_COLORS, MAUS_COLOR_NAMES, mausInk, stateForBot, swatchStyle } from "./mascot";

describe("stateForBot", () => {
  it("still alerts on a failed tool call when a digest receipt follows it", () => {
    // Phase 0 writes a digest row after every turn, so the failed chip is
    // no longer the last row; the mood must read past the receipt.
    expect(stateForBot({
      name: "Atlas",
      messages: [
        { kind: "activity", tool: { ok: false } },
        { kind: "digest" },
      ],
    })).toBe("alerting");
  });

  it("keeps reading a pending card as curious behind a receipt", () => {
    expect(stateForBot({ name: "Atlas", messages: [{ kind: "options" }, { kind: "digest" }] })).toBe("curious");
  });
});

describe("black bot color", () => {
  it("is a palette color with its own value, distinct from the others", () => {
    expect(MAUS_COLOR_NAMES).toContain("black");
    const values = MAUS_COLOR_NAMES.map((name) => MAUS_COLORS[name].toLowerCase());
    expect(new Set(values).size).toBe(values.length);
  });

  it("reads as a slate when used as text or a tint, so it never vanishes on a dark theme", () => {
    expect(mausInk("black")).not.toBe(MAUS_COLORS.black);
    expect(mausInk("green")).toBe(MAUS_COLORS.green);
    expect(mausInk("chartreuse")).toBeUndefined();
    expect(mausInk(undefined)).toBeUndefined();
  });

  it("outlines only the black swatch", () => {
    expect(swatchStyle("black").boxShadow).toContain("inset");
    expect(swatchStyle("green")).toEqual({ backgroundColor: MAUS_COLORS.green });
  });
});
