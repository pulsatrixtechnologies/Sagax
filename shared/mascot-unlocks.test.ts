// The Mastery unlock registry (mascot-unlocks.ts): which achievement unlocks
// each Mastery character and skin, before and after the characters land.
import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, achievementById } from "./achievements-catalog.ts";
import { characterUnlocked, skinUnlocked, unlocksFor } from "./achievements.ts";
import {
  MASTERY_CHARACTERS,
  MASTERY_PREMIUM_SKINS,
  MASTERY_UNLOCKS,
  masteryKey,
  masteryLock,
  masteryRewards,
  masterySkinName,
  masteryUnlockFor,
  namedRung,
} from "./mascot-unlocks.ts";

describe("Mastery unlock registry", () => {
  it("points every character, rung and premium skin at a Mastery achievement of the catalog", () => {
    for (const character of MASTERY_CHARACTERS) {
      const entry = MASTERY_UNLOCKS[character];
      for (const id of [entry.unlock, ...entry.namedRungs, entry.premiumRung]) expect(achievementById(id)?.category, `${character} ${id}`).toBe("mastery");
      for (const skin of MASTERY_PREMIUM_SKINS) expect(achievementById(masteryUnlockFor(character, skin)!)?.category).toBe("mastery");
    }
  });

  it("leaves the characters from before and the base skins alone", () => {
    for (const character of ["owl", "shape", "trombi", "bunbu"]) {
      expect(masteryUnlockFor(character)).toBeNull();
      expect(masteryUnlockFor(character, "gold")).toBeNull();
    }
    expect(masteryUnlockFor("shiba", "plain")).toBeNull();
    expect(masteryUnlockFor("grump", "classic")).toBeNull();
  });

  it("spreads named skins over the three rungs, easiest first, and locks an unregistered one behind the last", () => {
    const shiba = MASTERY_UNLOCKS.shiba;
    expect(shiba.namedSkins.map((skin) => [skin.id, namedRung(shiba, skin.id)])).toEqual([["cream", 0], ["blacktan", 0], ["red", 1], ["sesame", 1], ["white", 2]]);
    expect(masteryUnlockFor("shiba", "cream")).toBe("second-wind");
    expect(masteryUnlockFor("shiba", "white")).toBe("quiet-nights");
    // a character whose branch has not registered its named skins yet: still locked, never free
    expect(masteryUnlockFor("frog", "lily")).toBe("skill-smith");
    expect(masteryUnlockFor("frog", "retro98")).toBe("total-recall");
    expect(masteryUnlockFor("ogre", "holo")).toBe("sagax-master");
  });

  it("lists every look an achievement unlocks, the hardest giving every character its legendary skins", () => {
    expect(masteryRewards("hands-off")).toEqual([{ kind: "character", character: "shiba" }]);
    expect(masteryRewards("second-wind")).toEqual([{ kind: "skin", character: "shiba", skin: "cream" }, { kind: "skin", character: "shiba", skin: "blacktan" }]);
    expect(masteryRewards("pack-leader")).toEqual([{ kind: "skin", character: "shiba", skin: "retro98" }, { kind: "skin", character: "shiba", skin: "gold" }]);
    const master = masteryRewards("sagax-master");
    expect(master).toHaveLength(8);
    for (const character of MASTERY_CHARACTERS) for (const skin of ["holo", "molten"]) expect(master).toContainEqual({ kind: "skin", character, skin });
    expect(masteryRewards("ferryman").map((reward) => reward.kind === "skin" && reward.skin)).toEqual(["neon", "neon", "neon", "neon"]);
  });

  it("locks a look until its achievement, and a skin until its character too", () => {
    const none = new Set<string>();
    expect(masteryLock(none, "shiba")).toEqual({ locked: true, achievement: "hands-off" });
    expect(masteryLock(none, "shiba", "cream")).toEqual({ locked: true, achievement: "hands-off" });
    const withShiba = new Set([masteryKey("hands-off")]);
    expect(masteryLock(withShiba, "shiba")).toEqual({ locked: false });
    expect(masteryLock(withShiba, "shiba", "plain")).toEqual({ locked: false });
    expect(masteryLock(withShiba, "shiba", "cream")).toEqual({ locked: true, achievement: "second-wind" });
    expect(masteryLock(new Set([...withShiba, masteryKey("second-wind")]), "shiba", "blacktan")).toEqual({ locked: false });
    expect(masteryLock(none, "owl", "gold")).toEqual({ locked: false });
  });

  it("feeds the general locks: what a person unlocked opens the registry's looks, a later-registered skin included", () => {
    const unlocks = unlocksFor({ unlocked: { "hands-off": 1, "quiet-nights": 1 }, grandfathered: [] }, ACHIEVEMENTS);
    expect(unlocks.keys.has("character:shiba")).toBe(true);
    expect(unlocks.keys.has(masteryKey("quiet-nights"))).toBe(true);
    expect(characterUnlocked(unlocks, "shiba")).toBe(true);
    expect(characterUnlocked(unlocks, "grump")).toBe(false);
    expect(skinUnlocked(unlocks, "shiba", "white")).toBe(true);
    expect(skinUnlocked(unlocks, "shiba", "cream")).toBe(false);
    // a named skin a branch registers later, past the last rung, opens with that rung's achievement
    expect(skinUnlocked(unlocks, "shiba", "brindle")).toBe(true);
    // the Common skins of a Mastery character are not free: the registry decides
    expect(skinUnlocked(unlocks, "shiba", "gold")).toBe(false);
    expect(skinUnlocked(unlocks, "shiba", "plain")).toBe(true);
  });

  it("names the characters and skins without the art", () => {
    expect(MASTERY_UNLOCKS.frog.name.fr).toBe("Grenouille");
    expect(masterySkinName("shiba", "blacktan").fr).toBe("Noir et feu");
    expect(masterySkinName("ogre", "molten").en).toBe("Molten");
    expect(masterySkinName("ogre", "swamp").en).toBe("Swamp");
  });
});
