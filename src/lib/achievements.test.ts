// The app's side of achievements (achievements.ts): locks from the person's
// snapshot, their hints and progress, a server without achievements locking
// nothing, batched client events, unlock frames feeding the toasts, the
// reward words, and grandfathering what bots already wear.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACHIEVEMENTS } from "../../shared/achievements-catalog";
import { grandfatheredFromBots, type AchievementSnapshot } from "../../shared/achievements";
import {
  achievementsState,
  appIconLock,
  characterLock,
  flushAchievementEvents,
  loadAchievements,
  lockHint,
  receiveAchievementsFrame,
  reportAchievement,
  resetAchievementsForTests,
  rewardLabel,
  setAchievementsFetcher,
  skinLock,
  unlocksFromSnapshot,
} from "./achievements";
import { achievementToasts } from "./achievement-toasts";
import { setLocale } from "./i18n";
import { APP_ICON_CHOICES } from "./app-icon-choices";

function snapshot(partial: Partial<AchievementSnapshot> = {}): AchievementSnapshot {
  return {
    points: 0,
    maxPoints: 1000,
    level: { level: 1, from: 0, to: 50 },
    unlockedCount: 0,
    count: ACHIEVEMENTS.length,
    streak: 0,
    rewards: [],
    recent: [],
    items: ACHIEVEMENTS.map((item) => ({ id: item.id, current: 0, target: 1 })),
    settings: { showPoints: true, showTitle: true, toasts: true, native: false, public: false },
    ...partial,
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  resetAchievementsForTests();
  achievementToasts.reset();
  setLocale("en");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("locks", () => {
  it("lock nothing until the server answers, and nothing on a server without achievements", async () => {
    expect(characterLock(achievementsState().unlocks, "bunbu").locked).toBe(false);
    setAchievementsFetcher(async () => new Response("", { status: 404 }));
    await loadAchievements();
    expect(achievementsState().status).toBe("unavailable");
    expect(skinLock(achievementsState().unlocks, "owl", "galaxy").locked).toBe(false);
    // and nothing is reported there
    let posted = 0;
    setAchievementsFetcher(async () => (posted++, json(200, {})));
    reportAchievement("mascot.pet");
    await flushAchievementEvents();
    expect(posted).toBe(0);
  });

  it("offers the owl and its Common skins; Shapes, Trombi and Bunbu wait", () => {
    const unlocks = unlocksFromSnapshot(snapshot());
    expect(characterLock(unlocks, "owl").locked).toBe(false);
    expect(skinLock(unlocks, "owl", "snowy").locked).toBe(false);
    expect(characterLock(unlocks, "shape")).toMatchObject({ locked: true, achievement: { id: "grok-linked" } });
    expect(skinLock(unlocks, "shape", "glossy")).toMatchObject({ locked: true, achievement: { id: "grok-linked" } });
    expect(characterLock(unlocks, "trombi")).toMatchObject({ locked: true, achievement: { id: "trombi-summoned" } });
    expect(characterLock(unlocks, "bunbu")).toMatchObject({ locked: true, achievement: { id: "small-family" } });
    expect(skinLock(unlocks, "owl", "galaxy")).toMatchObject({ locked: true, achievement: { id: "month-streak" } });
    // a Common skin of a locked character waits for the character
    expect(skinLock(unlocks, "trombi", "classic")).toMatchObject({ locked: true, achievement: { id: "trombi-summoned" } });
  });

  it("unlocks rewards and keeps grandfathered ones", () => {
    const unlocks = unlocksFromSnapshot(snapshot({ rewards: ["character:trombi", "skin:owl:galaxy", "appIcon:glyph:cube"] }));
    expect(characterLock(unlocks, "trombi").locked).toBe(false);
    expect(skinLock(unlocks, "trombi", "retro98").locked).toBe(false);
    expect(skinLock(unlocks, "trombi", "holo").locked).toBe(true);
    expect(skinLock(unlocks, "owl", "galaxy").locked).toBe(false);
    expect(appIconLock(unlocks, "glyph:cube", { kind: "glyph" }).locked).toBe(false);
    expect(appIconLock(unlocks, "glyph:spark", { kind: "glyph" })).toMatchObject({ locked: true, achievement: { id: "keyboard-ninja" } });
    expect(appIconLock(unlocks, "owl:inferno", { kind: "owl", skin: "inferno" })).toMatchObject({ locked: true, achievement: { id: "wordsmith" } });
    expect(appIconLock(unlocks, "sagax", { kind: "default" }).locked).toBe(false);
  });

  it("says what unlocks it, with progress, and only a hint for a secret", async () => {
    const items = ACHIEVEMENTS.map((item) => ({ id: item.id, current: item.id === "small-family" ? 2 : 0, target: item.id === "small-family" ? 3 : 1 }));
    setAchievementsFetcher(async () => json(200, snapshot({ items })));
    await loadAchievements();
    const unlocks = achievementsState().unlocks;
    expect(lockHint(characterLock(unlocks, "bunbu"))).toBe("Unlock: Small Family (2/3)");
    const trombi = lockHint(characterLock(unlocks, "trombi"));
    expect(trombi).toContain("Secret achievement");
    expect(trombi).toContain("retro command");
    expect(trombi).not.toContain("hibou98");
    expect(lockHint({ locked: false })).toBe("");
  });

  it("rewards only app icons the picker offers", () => {
    const ids = new Set(APP_ICON_CHOICES.map((choice) => choice.id));
    for (const item of ACHIEVEMENTS) for (const reward of item.rewards) if (reward.kind === "appIcon") expect(ids.has(reward.id)).toBe(true);
  });
});

describe("events and unlocks", () => {
  it("batches client events into one POST and queues the unlocks it returns", async () => {
    vi.useFakeTimers();
    const posts: unknown[] = [];
    setAchievementsFetcher(async (path, init) => {
      if (path.endsWith("/events")) {
        posts.push(JSON.parse(String(init?.body)));
        return json(200, { unlocked: [{ id: "trombi-summoned", points: 20, unlockedAt: 1 }], snapshot: snapshot({ rewards: ["character:trombi"], points: 20 }) });
      }
      return json(200, snapshot());
    });
    reportAchievement("trombi.summoned");
    reportAchievement("mascot.pet");
    await vi.advanceTimersByTimeAsync(500);
    expect(posts).toEqual([{ events: [{ type: "trombi.summoned" }, { type: "mascot.pet" }] }]);
    expect(achievementsState().snapshot?.points).toBe(20);
    expect(characterLock(achievementsState().unlocks, "trombi").locked).toBe(false);
    expect(achievementToasts.snapshot().queue).toEqual(["trombi-summoned"]);
    // the live frame for the same unlock does not show it twice
    receiveAchievementsFrame({ unlocked: [{ id: "trombi-summoned", points: 20, unlockedAt: 1 }] });
    expect(achievementToasts.snapshot().queue).toEqual(["trombi-summoned"]);
  });

  it("keeps quiet when the person turned the banners off", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot({ settings: { showPoints: true, showTitle: true, toasts: false, native: false, public: false } }) });
    setAchievementsFetcher(async () => json(200, snapshot()));
    receiveAchievementsFrame({ unlocked: [{ id: "konami", points: 50, unlockedAt: 1 }] });
    expect(achievementToasts.snapshot().queue).toEqual([]);
  });
});

describe("words", () => {
  it("names the reward in the person's language", () => {
    const night = ACHIEVEMENTS.find((item) => item.id === "month-streak")!;
    expect(rewardLabel(night.rewards[0]!)).toBe("Skin unlocked: Galaxy (Owl)");
    setLocale("fr");
    expect(rewardLabel(night.rewards[0]!)).toBe("Skin débloqué : Galaxie (Hibou)");
    expect(rewardLabel({ kind: "character", character: "trombi" })).toBe("Personnage débloqué : Trombi");
  });
});

describe("grandfathering", () => {
  it("keeps every character and chosen skin a person's bots wear", () => {
    expect(grandfatheredFromBots([
      { mascotLook: { character: "bunbu", skins: { shape: "plain", trombi: "classic", bunbu: "holo" } }, mascotSkin: "galaxy" },
      { mascotLook: { character: "owl", skins: { shape: "neon", trombi: "glitch", bunbu: "plain" } } },
      { mascotLook: { character: "trombi" } },
      {},
    ])).toEqual(["character:bunbu", "character:shape", "character:trombi", "skin:bunbu:holo", "skin:owl:galaxy", "skin:shape:neon", "skin:trombi:glitch"]);
    // a bot that wears Shapes keeps the character; the Common skins the editor fills in grant nothing more
    expect(grandfatheredFromBots([{ mascotLook: { character: "shape", skins: { shape: "plain", trombi: "classic", bunbu: "plain" } } }])).toEqual(["character:shape"]);
  });
});
