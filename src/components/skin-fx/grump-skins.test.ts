// Grump's thirteen skins: registered like the other characters' (the look,
// legacy names, rarity, the Mastery unlocks), each painting every role.
import { describe, expect, it } from "vitest";
import { botMascotLook, CHARACTER_PAINT, completeMascotLook, GRUMP_SKIN_TIER, GRUMP_SKINS, LEGACY_GRUMP_SKINS, MASCOT_CHARACTERS } from "../../../shared/mascot-look";
import { MASTERY_PREMIUM_SKINS, MASTERY_UNLOCKS, masterySkinTier, masteryUnlockFor } from "../../../shared/mascot-unlocks";
import { contrastRatio, MASCOT_COLOR_HEX, relativeLuminance } from "../../../shared/mascot-colors";
import { GRUMP_ROLES } from "../grump-art";
import { grumpFlatPalette, grumpSkinId, grumpSkinLayers, grumpSkinPaint, voidGlow } from "./grump-skins";

describe("Grump's skins", () => {
  it("registers the character after the others and thirteen skins, plain first", () => {
    expect(MASCOT_CHARACTERS.indexOf("grump")).toBeGreaterThan(MASCOT_CHARACTERS.indexOf("bunbu"));
    expect(GRUMP_SKINS).toHaveLength(13);
    expect(GRUMP_SKINS[0]).toBe("plain");
    expect(CHARACTER_PAINT.grump).toEqual({ colors: true, skins: GRUMP_SKINS, wingMoves: false });
    expect(completeMascotLook({ character: "grump" }).skins.grump).toBe("plain");
    expect(botMascotLook({ character: "grump", skins: { grump: "void" } })).toEqual({ character: "grump", skins: { grump: "void" } });
  });

  it("reads a legacy name as the current skin, and drops one it does not know without losing the character", () => {
    for (const [old, current] of Object.entries(LEGACY_GRUMP_SKINS)) {
      expect(GRUMP_SKINS, old).toContain(current);
      expect(botMascotLook({ character: "grump", skins: { grump: old } }).skins?.grump, old).toBe(current);
    }
    expect(botMascotLook({ character: "grump", skins: { grump: "plasma" } })).toEqual({ character: "grump" });
    expect(grumpSkinId("plasma")).toBe("plain");
  });

  it("is unlocked by Mastery: the coats on the three named rungs easiest first, the premium set like every character's", () => {
    const named = MASTERY_UNLOCKS.grump.namedSkins.map((skin) => skin.id);
    expect(named).toEqual(["tuxedo", "calico", "tabby", "siamese", "void"]);
    expect([...GRUMP_SKINS].sort()).toEqual(["plain", ...named, ...MASTERY_PREMIUM_SKINS].sort());
    expect(masteryUnlockFor("grump")).toBe("reviewer");
    expect(masteryUnlockFor("grump", "plain")).toBeNull();
    expect(masteryUnlockFor("grump", "tuxedo")).toBe("prompter");
    expect(masteryUnlockFor("grump", "siamese")).toBe("red-pen");
    expect(masteryUnlockFor("grump", "void")).toBe("not-so-fast");
    expect(masteryUnlockFor("grump", "gold")).toBe("justice-of-peace");
    // the picker shows the same rarity the achievements give
    for (const skin of GRUMP_SKINS) expect(GRUMP_SKIN_TIER[skin], skin).toBe(masterySkinTier(skin));
  });

  it("paints every role in every skin, with a color or a gradient it defines", () => {
    for (const skin of GRUMP_SKINS) {
      for (const hex of ["#8B5E3C", "#377FE6", "#FFFFFF", "#000000"]) {
        const { palette, tier } = grumpSkinPaint(skin, hex, "u");
        expect(tier).toBe(GRUMP_SKIN_TIER[skin]);
        for (const role of GRUMP_ROLES) expect(palette[role], `${skin} ${role}`).toMatch(/^(#[0-9a-fA-F]{6}|url\(#u-[A-Za-z]+\))$/);
        const flat = grumpFlatPalette(skin, hex);
        for (const role of GRUMP_ROLES) expect(flat[role], `${skin} ${role} flat`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it("gives the premium editions their treatment, and Void its lit eyes", () => {
    for (const skin of ["gold", "neon", "chrome", "holo", "molten", "glitch"] as const) expect(grumpSkinLayers(skin, "M0 0Z", "#377FE6", "u", true), skin).not.toBeNull();
    expect(grumpSkinLayers("void", "M0 0Z", "#377FE6", "u", true, "head")?.inner).toBeTruthy();
    expect(grumpSkinLayers("void", "M0 0Z", "#377FE6", "u", true, "body")).toBeNull();
    expect(grumpSkinLayers("plain", "M0 0Z", "#377FE6", "u", true)).toBeNull();
    // the glow always reads on black, whatever the bot color
    for (const [name, hex] of Object.entries(MASCOT_COLOR_HEX)) {
      const glow = voidGlow(hex);
      expect(relativeLuminance(glow), name).toBeGreaterThanOrEqual(0.3);
      expect(contrastRatio(glow, "#121217"), name).toBeGreaterThan(5);
    }
  });
});
