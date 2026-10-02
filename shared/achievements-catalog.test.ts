import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, achievementById } from "./achievements-catalog.ts";
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_EVENTS,
  ACHIEVEMENT_POINTS,
  DEFAULT_CHARACTERS,
  pointsOf,
  rarityForPoints,
  rewardKey,
  skinsOf,
  skinTier,
} from "./achievements.ts";
import { MASCOT_CHARACTERS } from "./mascot-look.ts";

describe("achievements catalog", () => {
  it("holds between 40 and 60 achievements with unique, stable ids", () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(40);
    expect(ACHIEVEMENTS.length).toBeLessThanOrEqual(60);
    const ids = ACHIEVEMENTS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{3,40}$/);
    expect(achievementById("trombi-summoned")?.hidden).toBe(true);
  });

  it("gives every achievement a French and an English name and description, without long dashes", () => {
    for (const item of ACHIEVEMENTS) {
      for (const text of [item.name.en, item.name.fr, item.description.en, item.description.fr]) {
        expect(text.trim().length).toBeGreaterThan(1);
        expect(text).not.toMatch(/[–—]/);
      }
      expect(item.icon).toMatch(/^[A-Z][A-Za-z0-9]+$/);
      expect(ACHIEVEMENT_CATEGORIES).toContain(item.category);
      expect(ACHIEVEMENT_POINTS).toContain(item.points);
      expect(item.rewards.length).toBeGreaterThan(0);
    }
  });

  it("covers every category and only reads known events", () => {
    for (const category of ACHIEVEMENT_CATEGORIES) expect(ACHIEVEMENTS.some((item) => item.category === category)).toBe(true);
    for (const item of ACHIEVEMENTS) {
      const rule = item.rule;
      if ("event" in rule) expect(ACHIEVEMENT_EVENTS).toContain(rule.event);
      if (rule.kind === "all") for (const event of rule.events) expect(ACHIEVEMENT_EVENTS).toContain(event);
      if ("target" in rule) expect(rule.target).toBeGreaterThan(0);
    }
  });

  it("rewards every skin above Common and both locked characters exactly once", () => {
    const rewarded = ACHIEVEMENTS.flatMap((item) => item.rewards.map(rewardKey));
    const lockable: string[] = [];
    for (const character of MASCOT_CHARACTERS) {
      if (!DEFAULT_CHARACTERS.includes(character)) lockable.push(`character:${character}`);
      for (const skin of skinsOf(character)) if (skinTier(character, skin) !== "common") lockable.push(`skin:${character}:${skin}`);
    }
    for (const key of lockable) expect(rewarded.filter((candidate) => candidate === key), key).toHaveLength(1);
    // nothing rewards a Common skin (those come with their character) or an unknown one
    for (const key of rewarded.filter((candidate) => candidate.startsWith("skin:"))) expect(lockable).toContain(key);
  });

  it("prices a skin by its rarity", () => {
    const allowed = { common: [5, 10], rare: [10, 20], epic: [20, 50], legendary: [50, 100] } as const;
    for (const item of ACHIEVEMENTS) {
      for (const reward of item.rewards) {
        if (reward.kind !== "skin") continue;
        expect(allowed[skinTier(reward.character, reward.skin)], `${item.id} ${reward.skin}`).toContain(item.points);
      }
    }
    expect(rarityForPoints(5)).toBe("common");
    expect(rarityForPoints(20)).toBe("rare");
    expect(rarityForPoints(100)).toBe("legendary");
  });

  it("unlocks Trombi only through its command", () => {
    const trombi = ACHIEVEMENTS.filter((item) => item.rewards.some((reward) => reward.kind === "character" && reward.character === "trombi"));
    expect(trombi.map((item) => item.id)).toEqual(["trombi-summoned"]);
    expect(trombi[0]!.rule).toEqual({ kind: "count", event: "trombi.summoned", target: 1 });
  });

  it("keeps the points tiers reachable without the secrets", () => {
    const visible = ACHIEVEMENTS.filter((item) => !item.hidden && item.rule.kind !== "points" && item.rule.kind !== "completion");
    const all = Object.fromEntries(visible.map((item) => [item.id, 1]));
    const reachable = pointsOf(all, visible);
    for (const item of ACHIEVEMENTS) if (item.rule.kind === "points") expect(reachable).toBeGreaterThanOrEqual(item.rule.target);
  });
});
