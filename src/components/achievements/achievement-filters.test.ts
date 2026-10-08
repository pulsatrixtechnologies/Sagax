// Locked only and search rules for the achievements list. No browser: the page
// calls achievementMatches, and these cases build the achievements by hand.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { AchievementDefinition, AchievementSnapshot } from "../../../shared/achievements";
import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import { resetAchievementsForTests } from "@/lib/achievements";
import { setLocale } from "@/lib/i18n";
import { AchievementsPage } from "./AchievementsPage";
import { achievementMatches, type AchievementListQuery } from "./achievement-filters";

function achievement(overrides: Partial<AchievementDefinition> & Pick<AchievementDefinition, "id" | "rewards">): AchievementDefinition {
  return {
    category: "onboarding",
    name: { en: "Sample", fr: "Exemple" },
    description: { en: "A sample achievement.", fr: "Un succès d'exemple." },
    icon: "Trophy",
    points: 10,
    rule: { kind: "count", event: "message.sent", target: 1 },
    ...overrides,
  };
}

function query(partial: Partial<AchievementListQuery> = {}): AchievementListQuery {
  return { category: "all", lockedOnly: false, search: "", ...partial };
}

const owlSkin = achievement({
  id: "owl-skin",
  name: { en: "Unstoppable", fr: "Inarrêtable" },
  description: { en: "Keep a long streak.", fr: "Gardez une longue série." },
  rewards: [{ kind: "skin", character: "owl", skin: "lightning" }],
});

const titled = achievement({
  id: "titled",
  name: { en: "First Words", fr: "Premiers mots" },
  description: { en: "Send your first message to a bot.", fr: "Envoyez votre premier message à un robot." },
  rewards: [{ kind: "title", id: "rookie", name: { en: "Rookie", fr: "Recrue" } }],
});

const both = achievement({
  id: "both",
  category: "mastery",
  name: { en: "Platinum", fr: "Platine" },
  description: { en: "Finish the public list.", fr: "Terminez la liste publique." },
  rewards: [
    { kind: "skin", character: "bunbu", skin: "galaxy" },
    { kind: "title", id: "platinum", name: { en: "Platinum Sage", fr: "Sage platine" } },
  ],
});

const secret = achievement({
  id: "secret-one",
  category: "secrets",
  hidden: true,
  name: { en: "Up Up Down Down", fr: "Haut haut bas bas" },
  description: { en: "Enter the old cheat code.", fr: "Entrez le vieux code de triche." },
  hint: { en: "Gamers of a certain age know a code made of arrows.", fr: "Les joueurs d'une certaine époque connaissent un code fait de flèches." },
  rewards: [{ kind: "skin", character: "owl", skin: "lightning" }],
});

afterEach(() => {
  setLocale("en");
  resetAchievementsForTests();
});

describe("achievement filters", () => {
  it("matches a search hit on the name, the description and the reward label", () => {
    expect(achievementMatches(titled, undefined, query({ search: "  fIrSt  " }))).toBe(true);
    expect(achievementMatches(titled, undefined, query({ search: "message" }))).toBe(true);
    expect(achievementMatches(owlSkin, undefined, query({ search: "lightning" }))).toBe(true);
    expect(achievementMatches(both, undefined, query({ search: "sage" }))).toBe(true);
    expect(achievementMatches(titled, undefined, query({ search: "   " }))).toBe(true);
    setLocale("fr");
    expect(achievementMatches(titled, undefined, query({ search: "premiers" }))).toBe(true);
    expect(achievementMatches(titled, undefined, query({ search: "recrue" }))).toBe(true);
    expect(achievementMatches(titled, undefined, query({ search: "rookie" }))).toBe(false);
  });

  it("misses a search that is not on the card", () => {
    expect(achievementMatches(titled, undefined, query({ search: "not-on-the-card" }))).toBe(false);
    expect(achievementMatches(owlSkin, undefined, query({ search: "galaxy" }))).toBe(false);
  });

  it("does not find a locked secret by its real name, description or reward", () => {
    expect(achievementMatches(secret, undefined, query({ search: "Up Up Down Down" }))).toBe(false);
    expect(achievementMatches(secret, undefined, query({ search: "cheat code" }))).toBe(false);
    expect(achievementMatches(secret, undefined, query({ search: "lightning" }))).toBe(false);
    expect(achievementMatches(secret, undefined, query({ search: "arrows" }))).toBe(true);
    expect(achievementMatches(secret, undefined, query({ search: "Secret achievement" }))).toBe(true);
    const quiet = achievement({
      id: "quiet",
      hidden: true,
      name: { en: "Hidden Gem", fr: "Joyau caché" },
      description: { en: "Do the hidden thing.", fr: "Faites la chose cachée." },
      rewards: [{ kind: "title", id: "quiet", name: { en: "Quiet", fr: "Discret" } }],
    });
    expect(achievementMatches(quiet, undefined, query({ search: "Hidden Gem" }))).toBe(false);
    expect(achievementMatches(quiet, undefined, query({ search: "Keep exploring" }))).toBe(true);
    expect(achievementMatches(secret, 1_700_000_000_000, query({ search: "Up Up Down Down" }))).toBe(true);
    expect(achievementMatches(secret, 1_700_000_000_000, query({ search: "lightning" }))).toBe(true);
  });

  it("combines locked only, the category and the search", () => {
    expect(achievementMatches(titled, undefined, query({ lockedOnly: true, search: "first" }))).toBe(true);
    expect(achievementMatches(titled, 5, query({ lockedOnly: true, search: "first" }))).toBe(false);
    expect(achievementMatches(titled, 5, query({ search: "first" }))).toBe(true);
    expect(achievementMatches(owlSkin, undefined, query({ lockedOnly: true, category: "onboarding" }))).toBe(true);
    expect(achievementMatches(owlSkin, undefined, query({ lockedOnly: true, category: "voice" }))).toBe(false);
    expect(achievementMatches(secret, undefined, query({ lockedOnly: true, search: "arrows" }))).toBe(true);
    expect(achievementMatches(secret, 3, query({ lockedOnly: true, search: "arrows" }))).toBe(false);
    setLocale("fr");
    expect(achievementMatches(both, 9, query({ category: "mastery", search: "platine" }))).toBe(true);
  });
});

describe("achievements page controls", () => {
  it("has one search field and a Locked only switch, no reward or status select", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsPage));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('data-achievement-search=""');
    expect(html).toContain('placeholder="Search"');
    expect(html).toContain('aria-label="Search achievements"');
    expect(html).toContain('aria-label="Locked only"');
    expect(html).not.toContain("<select");
    expect(html).not.toContain("All rewards");
    expect(html).not.toContain("Recent unlocks");
    setLocale("fr");
    const french = renderToStaticMarkup(createElement(AchievementsPage));
    expect(french).toContain('placeholder="Rechercher"');
    expect(french).toContain('aria-label="Verrouillés seulement"');
  });
});

function snapshot(): AchievementSnapshot {
  return {
    points: 0,
    maxPoints: 1,
    level: { level: 1, from: 0, to: 50 },
    unlockedCount: 0,
    count: ACHIEVEMENTS.length,
    streak: 0,
    rewards: [],
    recent: [],
    items: [],
    settings: { showPoints: false, showTitle: true, toasts: true, native: false, public: false },
  };
}
