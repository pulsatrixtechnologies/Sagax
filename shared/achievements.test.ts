import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHARACTERS,
  NOTHING_LOCKED,
  REWARD_REGISTRY,
  characterUnlocked,
  emptyProgress,
  grandfatheredFromBots,
  longestStreak,
  migratedCrabFromBots,
  rewardKey,
  rewardLineVisible,
  ruleStatus,
  skinUnlocked,
} from "./achievements.ts";

describe("reward keys for crab items", () => {
  it("names emote, move, accessory and effect the same way the store will store them", () => {
    expect(rewardKey({ kind: "emote", character: "crab", id: "neutral" })).toBe("emote:crab:neutral");
    expect(rewardKey({ kind: "move", character: "crab", id: "claw-dance" })).toBe("move:crab:claw-dance");
    expect(rewardKey({ kind: "accessory", id: "captain" })).toBe("accessory:captain");
    expect(rewardKey({ kind: "effect", id: "fireworks" })).toBe("effect:fireworks");
    expect(rewardKey({ kind: "character", character: "crab" })).toBe("character:crab");
  });

  it("hides a reward line until the registry can draw it", () => {
    expect(REWARD_REGISTRY.emotes.crab).toEqual(["neutral", "happy", "curious", "sleepy"]);
    expect(rewardLineVisible({ kind: "emote", character: "crab", id: "neutral" })).toBe(true);
    expect(rewardLineVisible({ kind: "emote", character: "crab", id: "proud" })).toBe(false);
    expect(rewardLineVisible({ kind: "move", character: "crab", id: "claw-dance" })).toBe(false);
    expect(rewardLineVisible({ kind: "accessory", id: "captain" })).toBe(false);
    expect(rewardLineVisible({ kind: "effect", id: "bubbles" })).toBe(false);
    expect(rewardLineVisible({ kind: "character", character: "crab" })).toBe(true);
    expect(rewardLineVisible({ kind: "skin", character: "crab", skin: "pearl" })).toBe(true);
    expect(rewardLineVisible({ kind: "title", id: "rookie", name: { en: "Rookie", fr: "Recrue" } })).toBe(true);
    expect(rewardLineVisible({ kind: "appIcon", id: "glyph:cube" })).toBe(true);
  });
});

describe("claude unlocks", () => {
  it("treats only the owl as a default character", () => {
    expect(DEFAULT_CHARACTERS).toEqual(["owl"]);
    expect(characterUnlocked(NOTHING_LOCKED, "crab")).toBe(true);
    const empty = { enforced: true, keys: new Set<string>() };
    expect(characterUnlocked(empty, "owl")).toBe(true);
    expect(characterUnlocked(empty, "crab")).toBe(false);
    expect(characterUnlocked({ enforced: true, keys: new Set(["character:crab"]) }, "crab")).toBe(true);
  });

  it("lets an earned skin bring its character, Trombi's easter egg excepted (JC, 2026-10-14)", () => {
    const pearl = { enforced: true, keys: new Set(["skin:crab:pearl", "skin:shape:outline", "skin:trombi:gold"]) };
    expect(characterUnlocked(pearl, "crab")).toBe(true);
    expect(characterUnlocked(pearl, "shape")).toBe(true);
    expect(characterUnlocked(pearl, "bunbu")).toBe(false);
    // Trombi stays hidden until its own command finds it
    expect(characterUnlocked(pearl, "trombi")).toBe(false);
    expect(skinUnlocked(pearl, "crab", "pearl")).toBe(true);
    expect(skinUnlocked(pearl, "crab", "gold")).toBe(false);
  });

  it("scores eventStreak on progress.days[event], not activeDays", () => {
    const definition = {
      id: "claw-streak",
      category: "claude" as const,
      name: { en: "Claw Streak", fr: "Serie de pinces" },
      description: { en: "x", fr: "y" },
      icon: "CalendarCheck",
      points: 20 as const,
      rule: { kind: "eventStreak" as const, event: "claude.turn" as const, target: 7 },
      rewards: [{ kind: "effect" as const, id: "bubbles" }],
    };
    const progress = {
      ...emptyProgress(),
      days: { "claude.turn": ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"] },
      activeDays: ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"],
    };
    expect(longestStreak(progress.days["claude.turn"]!)).toBe(7);
    expect(ruleStatus(definition, progress, [definition])).toEqual({ current: 7, target: 7, done: true });
    const broken = { ...progress, days: { "claude.turn": ["2026-10-01", "2026-10-03"] } };
    expect(ruleStatus(definition, broken, [definition])).toEqual({ current: 1, target: 7, done: false });
  });
});

describe("migrated crab grandfathering", () => {
  it("grandfathers a worn crab, ignores leftover skins.crab on an owl, and does not replay via grandfatheredFromBots", () => {
    expect(migratedCrabFromBots([{ mascotLook: { character: "crab" } }])).toEqual(["character:crab"]);
    expect(migratedCrabFromBots([{ mascotLook: { character: "crab", skins: { crab: "gold" } } }])).toEqual(["character:crab", "skin:crab:gold"]);
    expect(migratedCrabFromBots([{ mascotLook: { character: "owl", skins: { crab: "gold" } } }])).toEqual([]);
    expect(migratedCrabFromBots([{ mascotLook: { character: "owl" } }])).toEqual([]);
    expect(grandfatheredFromBots([{ mascotLook: { character: "crab" } }])).toEqual(["character:crab"]);
  });
});
