import { describe, expect, it } from "vitest";

import { MAUS_COLORS } from "@/lib/mascot";
import { MASCOT_SKIN_IDS } from "../../../shared/mascot-skins";
import { owlPalette } from "./owl-art";
import {
  OWL_LIGHTNING_ARCS,
  owlBolt,
  owlSkinAccent,
  owlSkinId,
  owlSkinLook,
  owlSkinPalette,
} from "./owl-skins";

describe("owl skins", () => {
  it("leaves the bot's own palette alone for none", () => {
    const base = owlPalette(MAUS_COLORS.blue);
    expect(owlSkinPalette("none", base, MAUS_COLORS.blue)).toEqual(base);
    expect(owlSkinLook("none", MAUS_COLORS.blue)).toEqual({ aura: null, eyeGlow: null, rim: null });
  });

  it.each(MASCOT_SKIN_IDS.filter((id) => id !== "none"))("%s recolors the owl and adds a look", (skin) => {
    const base = owlPalette(MAUS_COLORS.green);
    const palette = owlSkinPalette(skin, base, MAUS_COLORS.green);
    expect(palette).not.toEqual(base);
    // same keys: only colors change, never the shape
    expect(Object.keys(palette).sort()).toEqual(Object.keys(base).sort());
    const look = owlSkinLook(skin, MAUS_COLORS.green);
    expect(look.aura != null || look.rim != null).toBe(true);
  });

  it("keeps the bot's own plumage under lightning, with glowing eyes", () => {
    const base = owlPalette(MAUS_COLORS.black);
    const palette = owlSkinPalette("lightning", base, MAUS_COLORS.black);
    expect(palette.plumage).toBe(base.plumage);
    expect(palette.iris).not.toBe(base.iris);
    expect(owlSkinLook("lightning", MAUS_COLORS.black).eyeGlow).toBeTruthy();
  });

  it("burns neon in the bot's color, and cyan for black and white", () => {
    expect(owlSkinAccent(MAUS_COLORS.black)).toBe("#22D3EE");
    expect(owlSkinAccent(MAUS_COLORS.white)).toBe("#22D3EE");
    expect(owlSkinAccent(MAUS_COLORS.pink)).not.toBe("#22D3EE");
  });

  it("reads unknown or missing skins as none", () => {
    expect(owlSkinId("plasma")).toBe("none");
    expect(owlSkinId(undefined)).toBe("none");
    expect(owlSkinId("gold")).toBe("gold");
  });

  it("draws the same bolts on every render", () => {
    expect(owlBolt([0, 0], [10, 10], [20, 0], 5)).toBe(owlBolt([0, 0], [10, 10], [20, 0], 5));
    expect(owlBolt([0, 0], [10, 10], [20, 0], 5)).not.toBe(owlBolt([0, 0], [10, 10], [20, 0], 6));
    for (const arc of OWL_LIGHTNING_ARCS) expect(arc.d).toMatch(/^M[\d.-]+ [\d.-]+(L[\d.-]+ [\d.-]+)+M/);
  });
});
