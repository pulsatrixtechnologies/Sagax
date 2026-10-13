// The catalogue the organization admin API sends the Perspicax console
// (shared/mascot-catalog.ts) names the registry's characters and families.
import { describe, expect, it } from "vitest";

import { MASCOT_CATALOG_FAMILIES, mascotCatalogue } from "../../../shared/mascot-catalog";
import { CHARACTER_PAINT } from "../../../shared/mascot-look";
import { MASCOTS } from "./mascots";
import { MASCOT_FAMILIES } from "./wardrobe";

describe("the console's mascot catalogue", () => {
  it("lists every registry character with its family, in the registry's order", () => {
    expect(mascotCatalogue().map((entry) => [entry.id, entry.family])).toEqual(MASCOTS.map((entry) => [entry.id, entry.family]));
    expect([...MASCOT_CATALOG_FAMILIES]).toEqual([...MASCOT_FAMILIES]);
  });

  it("says which characters take the bot's color and offers their own skins", () => {
    for (const entry of mascotCatalogue()) {
      expect(entry.colors).toBe(MASCOTS.find((mascot) => mascot.id === entry.id)!.paint.colors);
      if (entry.id !== "owl") expect(entry.skins).toEqual([...CHARACTER_PAINT[entry.id].skins]);
      expect(entry.skins).toContain(entry.defaultSkin);
    }
  });
});
