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
  ruleStatus,
  skinsOf,
  skinTier,
} from "./achievements.ts";
import { MASCOT_CHARACTERS } from "./mascot-look.ts";
import { MASTERY_CHARACTERS, MASTERY_PREMIUM_SKINS, MASTERY_UNLOCKS, masteryUnlockFor } from "./mascot-unlocks.ts";

describe("achievements catalog", () => {
  it("holds between 60 and 90 achievements with unique, stable ids", () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(60);
    expect(ACHIEVEMENTS.length).toBeLessThanOrEqual(90);
    const ids = ACHIEVEMENTS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{3,40}$/);
    expect(achievementById("trombi-summoned")?.hidden).toBe(true);
  });

  it("gives every achievement a French and an English name and description, without long dashes", () => {
    for (const item of ACHIEVEMENTS) {
      for (const text of [item.name.en, item.name.fr, item.description.en, item.description.fr, item.name.ptBR ?? "xx", item.description.ptBR ?? "xx", item.hint?.en ?? "xx", item.hint?.fr ?? "xx"]) {
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

  it("rewards every skin above Common and every locked character exactly once", () => {
    const rewarded = ACHIEVEMENTS.flatMap((item) => item.rewards.map(rewardKey));
    const lockable: string[] = [];
    // the characters this build draws, and the Mastery ones whether they landed or not
    for (const character of new Set<string>([...MASCOT_CHARACTERS, ...MASTERY_CHARACTERS])) {
      const mastery = (MASTERY_CHARACTERS as readonly string[]).includes(character);
      if (!(DEFAULT_CHARACTERS as readonly string[]).includes(character)) lockable.push(`character:${character}`);
      for (const skin of skinsOf(character as never)) {
        // a Mastery skin is locked by the registry, whatever its rarity; base skins come with the character
        if (mastery ? masteryUnlockFor(character, skin) !== null : skinTier(character as never, skin) !== "common") lockable.push(`skin:${character}:${skin}`);
      }
    }
    for (const key of lockable) expect(rewarded.filter((candidate) => candidate === key), key).toHaveLength(1);
    // nothing rewards a Common skin (those come with their character) or an unknown one
    for (const key of rewarded.filter((candidate) => candidate.startsWith("skin:"))) expect(lockable).toContain(key);
  });

  it("prices a skin by its rarity", () => {
    const allowed = { common: [5, 10], rare: [10, 20], epic: [20, 50], legendary: [50, 100] } as const;
    for (const item of ACHIEVEMENTS) {
      // the Mastery tier prices its looks by its own ladder (the Mastery tests below)
      if (item.category === "mastery") continue;
      for (const reward of item.rewards) {
        if (reward.kind !== "skin") continue;
        expect(allowed[skinTier(reward.character, reward.skin)], `${item.id} ${reward.skin}`).toContain(item.points);
      }
    }
    expect(rarityForPoints(5)).toBe("common");
    expect(rarityForPoints(20)).toBe("rare");
    expect(rarityForPoints(100)).toBe("legendary");
  });

  it("unlocks Trombi only through its hidden command, and Shapes only through a linked Grok account", () => {
    const trombi = ACHIEVEMENTS.filter((item) => item.rewards.some((reward) => reward.kind === "character" && reward.character === "trombi"));
    expect(trombi.map((item) => item.id)).toEqual(["trombi-summoned"]);
    expect(trombi[0]!.rule).toEqual({ kind: "count", event: "trombi.summoned", target: 1 });
    expect(trombi[0]!.hidden).toBe(true);
    const described = `${trombi[0]!.description.en} ${trombi[0]!.hint?.en ?? ""}`;
    expect(described.toLowerCase()).not.toContain("hibou");
    const shapes = ACHIEVEMENTS.filter((item) => item.rewards.some((reward) => reward.kind === "character" && reward.character === "shape"));
    expect(shapes.map((item) => item.id)).toEqual(["grok-linked"]);
    expect(shapes[0]!.rule).toEqual({ kind: "count", event: "grok.linked", target: 1 });
  });

  it("keeps the points tiers reachable without the secrets", () => {
    const visible = ACHIEVEMENTS.filter((item) => !item.hidden && item.rule.kind !== "points" && item.rule.kind !== "completion");
    const all = Object.fromEntries(visible.map((item) => [item.id, 1]));
    const reachable = pointsOf(all, visible);
    for (const item of ACHIEVEMENTS) if (item.rule.kind === "points") expect(reachable).toBeGreaterThanOrEqual(item.rule.target);
  });

  it("has a Mastery tier of 24 hard achievements that unlocks the four Mastery characters and every one of their looks", () => {
    const mastery = ACHIEVEMENTS.filter((item) => item.category === "mastery");
    expect(mastery).toHaveLength(24);
    for (const item of mastery) {
      // harder than every tier before it, and measured by the server only
      expect(item.points, item.id).toBeGreaterThanOrEqual(100);
      expect(["mastery", "category"], item.id).toContain(item.rule.kind);
      expect(item.name.ptBR, item.id).toBeTruthy();
      expect(item.description.ptBR, item.id).toBeTruthy();
      // its own title, besides its looks
      expect(item.rewards.some((reward) => reward.kind === "title"), item.id).toBe(true);
      if (item.hidden) expect(item.hint?.en, item.id).toBeTruthy();
    }
    // no other achievement gives a Mastery look
    for (const item of ACHIEVEMENTS.filter((candidate) => candidate.category !== "mastery")) {
      for (const reward of item.rewards) if (reward.kind === "character" || reward.kind === "skin") expect(MASTERY_CHARACTERS as readonly string[]).not.toContain(reward.character);
    }
    for (const character of MASTERY_CHARACTERS) {
      const entry = MASTERY_UNLOCKS[character];
      const unlock = achievementById(entry.unlock)!;
      expect(unlock.rewards).toContainEqual({ kind: "character", character });
      // reachable in two weeks: the character costs the tier's first price
      expect(unlock.points).toBe(100);
      // the named rungs get harder, the premium rung is harder still
      const rungs = [entry.unlock, ...entry.namedRungs, entry.premiumRung].map((id) => achievementById(id)!.points);
      expect([...rungs].sort((a, b) => a - b)).toEqual(rungs);
      // every premium skin of the character comes from exactly one achievement, the epic and legendary ones from the four hardest
      for (const skin of MASTERY_PREMIUM_SKINS) {
        const givers = mastery.filter((item) => item.rewards.some((reward) => reward.kind === "skin" && reward.character === character && reward.skin === skin));
        expect(givers, `${character} ${skin}`).toHaveLength(1);
        if (skin !== "retro98" && skin !== "gold") expect(givers[0]!.points, `${character} ${skin}`).toBeGreaterThanOrEqual(250);
      }
    }
    // the capstone asks for most of the tier, never all (Ferryman needs an organization)
    const master = achievementById("sagax-master")!;
    expect(master.rule).toEqual({ kind: "category", category: "mastery", target: 20 });
    expect(master.points).toBe(300);
  });

  it("keeps the points tiers apart from Mastery: Platinum does not ask for the Mastery tier", () => {
    expect(ACHIEVEMENTS.filter((item) => item.category === "tiers").map((item) => item.id)).toEqual(["bronze", "silver", "gold-tier", "platinum"]);
    const others = Object.fromEntries(ACHIEVEMENTS.filter((item) => !item.hidden && item.category !== "mastery" && item.id !== "platinum").map((item) => [item.id, 1]));
    const progress = { counters: {}, maxima: {}, keys: {}, days: {}, activeDays: [], unlocked: others, grandfathered: [] };
    expect(ruleStatus(achievementById("platinum")!, progress, ACHIEVEMENTS).done).toBe(true);
  });

  it("gives every title a unique id", () => {
    const titles = ACHIEVEMENTS.flatMap((item) => item.rewards.filter((reward) => reward.kind === "title").map((reward) => (reward.kind === "title" ? reward.id : "")));
    expect(new Set(titles).size).toBe(titles.length);
    for (const id of titles) expect(id).toMatch(/^[a-z0-9-]{1,40}$/);
  });
});
