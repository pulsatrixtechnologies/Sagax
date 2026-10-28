// The achievements' drawing: never in the sidebar footer, the member card,
// the unlock toast, the catalog's icons, the page, and its own page.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "@/state/store";
import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import type { AchievementSnapshot } from "../../../shared/achievements";
import { resetAchievementsForTests } from "@/lib/achievements";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ state: {} as Partial<AppState> }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: vi.fn() }) };
});

import { SidebarProfileMenu } from "../SidebarProfileMenu";
import { AchievementToast } from "./AchievementToaster";
import { AchievementsPage } from "./AchievementsPage";
import { AchievementsScreen, ACHIEVEMENTS_SCREEN_CATEGORIES, achievementCategoryCounts } from "./AchievementsScreen";
import { CATEGORY_MODAL } from "../category-modal";
import { SECTIONS } from "../SettingsModal";
import { ACHIEVEMENT_ICONS } from "./icons";
import { MemberCard, memberCardRows, publicMemberRows } from "./MemberCard";

function snapshot(partial: Partial<AchievementSnapshot> = {}): AchievementSnapshot {
  return {
    points: 1240,
    maxPoints: 1500,
    level: { level: 7, from: 1050, to: 1400 },
    unlockedCount: 2,
    count: ACHIEVEMENTS.length,
    streak: 4,
    rewards: [],
    recent: ["hello-bot"],
    items: ACHIEVEMENTS.map((item) => ({ id: item.id, current: item.id === "small-family" ? 2 : 0, target: item.id === "small-family" ? 3 : 1, ...(item.id === "hello-bot" || item.id === "first-words" ? { unlockedAt: 1 } : {}) })),
    settings: { showPoints: true, showTitle: true, toasts: true, native: false, public: false },
    ...partial,
  };
}

beforeEach(() => {
  setLocale("en");
  fixture.state = { config: { profile: { name: "Ada Lovelace", email: "ada@example.com" } } as AppState["config"], achievementsFocus: { category: "all", nonce: 0 } };
  vi.stubGlobal("window", {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetAchievementsForTests();
});

describe("member card", () => {
  it("shows the title and the points on my own footer row only while their switches are on", () => {
    const cases: Array<[boolean, boolean]> = [[true, true], [false, true], [true, false], [false, false]];
    for (const [showPoints, showTitle] of cases) {
      const settings = { showPoints, showTitle, toasts: true, native: false, public: true, title: "rookie" };
      resetAchievementsForTests({ status: "ready", snapshot: snapshot({ settings }) });
      const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
      expect(html).toContain(">Ada Lovelace</span>");
      expect(html.includes("data-gamertag")).toBe(showPoints);
      expect(html.includes("1,240")).toBe(showPoints);
      expect(html.includes(">Rookie<")).toBe(showTitle);
      expect(html.includes("data-member-line")).toBe(showPoints || showTitle);
    }
  });

  it("centres the name beside the avatar when the card has no title and no points", () => {
    const bare = renderToStaticMarkup(createElement(MemberCard, { name: "Ada Lovelace", initials: "AL", title: null, pointsText: null, rows: [] }));
    expect(bare).toContain("member-card-head");
    expect(bare).toContain("data-member-highlight");
    expect(bare).not.toContain("Level");
    expect(bare).not.toContain("lucide-trophy");
    // the name is the only line next to the avatar: no empty second line
    const head = bare.slice(bare.indexOf("member-card-head"), bare.indexOf("</div></div></div>"));
    expect(head).toContain("member-card-identity");
    expect(head).toContain("Ada Lovelace");
    expect(head).not.toContain("data-member-title");
    expect(head).not.toContain("data-member-points");
    expect(bare).toContain("width:64px");
    const titled = renderToStaticMarkup(createElement(MemberCard, { name: "Ada Lovelace", initials: "AL", title: "Rookie", pointsText: null, rows: [] }));
    expect(titled).toContain("data-member-title");
    expect(titled).toContain(">Rookie<");
    expect(titled).not.toContain("lucide-trophy");
    const panel = renderToStaticMarkup(createElement(MemberCard, { name: "Ada Lovelace", initials: "AL", title: "Rookie", pointsText: "1,240", rows: [], variant: "panel" }));
    expect(panel).toContain("data-member-variant=\"panel\"");
    expect(panel).toContain("member-card-head");
    expect(panel).toContain("width:72px");
    expect(panel).toContain("data-member-title");
    expect(panel).toContain("data-member-points");
  });

  it("lists an unlocked achievement and hides a locked secret", () => {
    const rows = memberCardRows(snapshot());
    expect(rows.some((row) => row.id === "hello-bot" && row.unlocked)).toBe(true);
    expect(rows.some((row) => row.id === "konami")).toBe(false);
    const html = renderToStaticMarkup(createElement(MemberCard, {
      name: "Ada Lovelace",
      initials: "AL",
      title: "Rookie",
      pointsText: "1,240",
      level: 7,
      rows,
      onOpenPage: () => {},
    }));
    expect(html).toContain("data-member-card");
    expect(html).toContain("data-member-highlight");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("data-member-title");
    expect(html).toContain("Rookie");
    expect(html).toContain("data-member-points");
    expect(html).toContain("1,240");
    expect(html).toContain("Level 7");
    expect(html.indexOf("data-member-highlight")).toBeLessThan(html.indexOf("member-card-list"));
    expect(html).toMatch(/It(?:'|&#x27;)s Alive!/);
    expect(html).toContain('data-achievement="hello-bot"');
    expect(html).toContain("data-unlocked");
    expect(html).not.toContain("Up Up Down Down");
    expect(html).not.toContain('data-achievement="konami"');
    // a locked achievement that is not a secret stays, dim, with progress
    expect(html).toContain('data-achievement="small-family"');
    expect(html).toContain("data-locked");
    expect(html).toContain("2/3");
    expect(html).toContain("View achievements");
    expect(html).toContain("member-card-list");
    // a public card only has unlocked ids, so a locked secret cannot appear
    const shared = publicMemberRows([
      { id: "first-words", points: 5 },
      { id: "konami", points: 50 },
    ]);
    expect(shared.map((row) => row.name)).toEqual(["First Words", "Up Up Down Down"]);
    const hidden = renderToStaticMarkup(createElement(MemberCard, {
      name: "Ada Lovelace",
      initials: "AL",
      title: null,
      pointsText: "5",
      level: 1,
      rows: publicMemberRows([{ id: "first-words", points: 5 }]),
    }));
    expect(hidden).toContain("First Words");
    expect(hidden).not.toContain("Up Up Down Down");
    expect(hidden).not.toContain('data-achievement="konami"');
  });
});

describe("unlock toast", () => {
  it("names the achievement, its points and what it unlocked", () => {
    const html = renderToStaticMarkup(createElement(AchievementToast, { id: "month-streak", leaving: false, onDismiss: () => {} }));
    expect(html).toContain("Achievement unlocked");
    expect(html).toContain("+100");
    expect(html).toContain("Unstoppable");
    expect(html).toContain("Skin unlocked: Galaxy (Owl)");
    expect(html).toContain('data-tier="legendary"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    setLocale("fr");
    const fr = renderToStaticMarkup(createElement(AchievementToast, { id: "trombi-summoned", leaving: false, onDismiss: () => {} }));
    expect(fr).toContain("Succès débloqué");
    expect(fr).toContain("Personnage débloqué : Trombi");
  });

  it("reveals the crab on the claude-linked toast", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementToast, { id: "claude-linked", leaving: false, onDismiss: () => {} }));
    expect(html).toContain("Claude Linked");
    expect(html).toContain("Character unlocked: Crab");
    expect(html).toContain("achievement-toast-preview");
    expect(html).not.toContain("a surprise character");
  });
});

describe("achievements page", () => {
  it("shows the header card, recent unlocks, the filters and a grid of tiles on All", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot({ settings: { showPoints: true, showTitle: true, toasts: true, native: false, public: false } }) });
    const html = renderToStaticMarkup(createElement(AchievementsPage, { category: "all" }));
    expect(html).toContain("data-achievements-page");
    // header card: trophy, points, level with its bar and the rest to the next level, count, streak
    expect(html).toContain("lucide-trophy");
    expect(html).toContain("1,240");
    expect(html).toContain("Level 7");
    expect(html).toContain('aria-valuenow="190"');
    expect(html).toContain("160 to the next level");
    expect(html).toContain("2 of");
    expect(html).toContain("4-day streak");
    // the shared settings have their own entry in the left column, not this page
    // (Recent unlocks is a plain group of its own; the settings group is gone)
    expect(html).not.toContain('data-settings-group="achievements.settings"');
    expect([...html.matchAll(/data-settings-group="([^"]+)"/g)].map((match) => match[1])).toEqual(["achievements.recent"]);
    expect(html).not.toMatch(/data-settings-row="achievements.title"/);
    // recent unlocks, a horizontal row of cards
    expect(html).toContain(">Recent unlocks</h3>");
    expect(html).toContain('data-recent-achievement="hello-bot"');
    // the toolbar: search, rewards and status, then the category filter (2026-10-28)
    expect(html).toContain('data-achievement-search=""');
    expect(html).toContain('aria-label="Reward"');
    expect(html).toContain('aria-label="Show"');
    expect(html).toContain(">Any status<");
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain('data-achievement-category-filter=""');
    expect(html).toMatch(/aria-pressed="true" data-achievement-category="all"/);
    // a responsive grid of compact cards, more than one a row on a wide window
    expect(html).toContain("grid grid-cols-1 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(250px,1fr))]");
    expect(html).toMatch(/class="achievement-card[^"]*" data-tier="[a-z]+" data-unlocked="" data-achievement="hello-bot"/);
    // everything inside the card: badge, name, points, description, rarity, reward
    const hello = html.slice(html.indexOf('data-achievement="hello-bot"'), html.indexOf("</li>", html.indexOf('data-achievement="hello-bot"')));
    expect(hello).toContain("achievement-card-badge");
    expect(hello).toContain("achievement-card-name");
    expect(hello).toMatch(/data-achievement-card-points=""[^>]*>10<\/span>/);
    expect(hello).toContain("achievement-card-tier");
    expect(hello).toContain("a surprise look");
    // the tile's empty framed ground is gone
    expect(html).not.toContain("achievement-tile-art");
    // a locked card's progress, as numbers too
    const family = html.slice(html.indexOf('data-achievement="small-family"'), html.indexOf("</li>", html.indexOf('data-achievement="small-family"')));
    expect(family).toContain('aria-valuenow="2"');
    expect(family).toContain(">2/3</span>");
    expect(family).not.toContain("data-unlocked");
    for (const item of ACHIEVEMENTS) expect(html).toContain(`data-achievement="${item.id}"`);
    // a secret stays a secret until found
    expect(html).toMatch(/data-achievement="konami" data-secret=""/);
    expect(html).not.toContain("Up Up Down Down");
    // the switches that hide the points and the toasts live on the Settings entry (#1206)
    expect(html).not.toContain("Show my points");
  });

  it("shows one category's cards, keeps the header card, and leaves recent unlocks to All", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsPage, { category: "voice" }));
    expect(html).toContain("1,240");
    expect(html).toContain("Level 7");
    expect(html).not.toContain("Recent unlocks");
    expect(html).not.toContain("data-recent-achievement");
    const voice = ACHIEVEMENTS.filter((item) => item.category === "voice");
    expect(voice.length).toBeGreaterThan(0);
    for (const item of ACHIEVEMENTS) expect(html.includes(`data-achievement="${item.id}"`), item.id).toBe(item.category === "voice");
    const secrets = renderToStaticMarkup(createElement(AchievementsPage, { category: "secrets" }));
    expect(secrets).toMatch(/data-achievement="konami" data-secret=""/);
    expect(secrets).not.toContain("Up Up Down Down");
  });

  it("has an icon for every achievement", () => {
    for (const item of ACHIEVEMENTS) expect(ACHIEVEMENT_ICONS[item.icon], item.icon).toBeTruthy();
  });

  it("surprise-words a locked crab character and hides Crab on hello-bot", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsPage, { category: "claude" }));
    const linked = html.slice(html.indexOf('data-achievement="claude-linked"'), html.indexOf("</li>", html.indexOf('data-achievement="claude-linked"')));
    expect(linked).toContain("a surprise character");
    expect(linked).not.toContain("Character unlocked: Crab");
    const all = renderToStaticMarkup(createElement(AchievementsPage, { category: "all" }));
    const hello = all.slice(all.indexOf('data-achievement="hello-bot"'), all.indexOf("</li>", all.indexOf('data-achievement="hello-bot"')));
    expect(hello).toContain("a surprise look");
    expect(hello).not.toContain("Pearl");
    expect(hello).not.toContain("Crab");
    const recent = all.slice(all.indexOf('data-recent-achievement="hello-bot"'), all.indexOf("</li>", all.indexOf('data-recent-achievement="hello-bot"')));
    expect(recent).toContain("lucide-bot");
    expect(recent).not.toContain("data-character=");
    resetAchievementsForTests({ status: "ready", snapshot: snapshot({ rewards: ["character:shape"] }) });
    const owned = renderToStaticMarkup(createElement(AchievementsPage, { category: "all" }));
    const ownedRecent = owned.slice(owned.indexOf('data-recent-achievement="hello-bot"'), owned.indexOf("</li>", owned.indexOf('data-recent-achievement="hello-bot"')));
    expect(ownedRecent).not.toContain("lucide-bot");
    const pinch = html.slice(html.indexOf('data-achievement="first-pinch"'), html.indexOf("</li>", html.indexOf('data-achievement="first-pinch"')));
    expect(pinch).not.toContain("proud");
    expect(pinch).not.toContain("Look unlocked");
  });
});

describe("achievements page", () => {
  it("is one column: no left column, the categories are a filter of the toolbar with their counts", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsScreen));
    // a page of the content frame (not a dialog)
    expect(html).toContain("data-achievements-screen");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("fixed inset-0");
    // no navigation column, no rail, no phone category select (2026-10-28)
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("data-achievements-nav");
    expect(html).not.toContain(CATEGORY_MODAL.nav);
    expect(html).not.toContain("<select");
    expect(html).not.toContain('aria-current="page"');
    // the header: the way back, then the title
    const header = html.slice(html.indexOf("data-achievements-header"), html.indexOf("</header>"));
    expect(header).toContain('data-achievements-back=""');
    expect(header).toContain('aria-label="Back"');
    expect(header).toMatch(/<h1[^>]*>Achievements<\/h1>/);
    // the filter, after the search, every category in order with its unlocked/total count
    const filter = html.slice(html.indexOf("data-achievement-category-filter"), html.indexOf("data-achievement-grid"));
    expect(html.indexOf("data-achievement-search")).toBeLessThan(html.indexOf("data-achievement-category-filter"));
    expect(/<div[^>]*data-achievement-category-filter=""[^>]*>/.exec(html)?.[0]).toMatch(/role="toolbar" aria-label="Categories"/);
    const labels = ["All", "Getting started", "Productivity", "Power user", "Voice", "Claude", "Together", "Streaks", "Mastery", "Tiers", "Secrets"];
    expect(ACHIEVEMENTS_SCREEN_CATEGORIES).toEqual(["all", "onboarding", "productivity", "power", "voice", "claude", "collaboration", "streaks", "mastery", "tiers", "secrets"]);
    let at = 0;
    for (const label of labels) {
      const next = filter.indexOf(`<span>${label}</span>`, at);
      expect(next, label).toBeGreaterThan(at);
      at = next;
    }
    expect(filter.match(/data-achievement-category-count=""/g)).toHaveLength(labels.length);
    expect(filter).toMatch(/aria-pressed="true" data-achievement-category="all"/);
    expect(filter).toContain(`>2/${ACHIEVEMENTS.length}</span>`);
    const onboarding = ACHIEVEMENTS.filter((item) => item.category === "onboarding").length;
    expect(filter).toContain(`>2/${onboarding}</span>`);
    const mastery = ACHIEVEMENTS.filter((item) => item.category === "mastery").length;
    expect(filter).toContain(`>0/${mastery}</span>`);
    // the chosen one is filled like Connect apps' pills
    expect(/<button[^>]*data-achievement-category="all"[^>]*>/.exec(filter)?.[0]).toContain("bg-accent");
    // then the recent unlocks of All and every card
    expect(html).toContain("data-recent-achievement");
    for (const item of ACHIEVEMENTS) expect(html).toContain(`data-achievement="${item.id}"`);
  });

  it("keeps the progress card compact and every number on it", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsScreen));
    const card = /<section[^>]*data-achievement-progress=""[^>]*>/.exec(html)?.[0] ?? "";
    expect(card).toContain("py-3");
    expect(card).not.toMatch(/\bp-4\b/);
    expect(html).toContain("data-achievement-points");
    expect(html).toContain("1,240");
    expect(html).toContain("Level 7");
    expect(html).toContain("160 to the next level");
    expect(html).toContain(`2 of ${ACHIEVEMENTS.length} unlocked`);
    expect(html).toContain("data-achievement-streak");
    expect(html).toContain("4-day streak");
  });

  it("keeps Settings out of the categories: a gear in the header opens them", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsScreen));
    expect(html).not.toContain('data-achievement-category="settings"');
    expect(ACHIEVEMENTS_SCREEN_CATEGORIES).not.toContain("settings");
    const header = html.slice(html.indexOf("data-achievements-header"), html.indexOf("</header>"));
    const gear = /<button[^>]*data-achievements-settings-button=""[^>]*>/.exec(header)?.[0] ?? "";
    expect(gear).toContain('aria-label="Settings"');
    expect(gear).toContain('title="Settings"');
    expect(gear).toContain('aria-pressed="false"');
    // after the title, at the end of the header row
    expect(header.indexOf("data-achievements-settings-button")).toBeGreaterThan(header.indexOf("</h1>"));
  });

  it("shows the shared settings alone when the gear is on, and on no category page", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsScreen, { initialCategory: "settings" }));
    expect(html).toMatch(/data-achievements-settings-button=""[^>]*aria-pressed="true"/);
    expect(html).toContain("data-achievements-settings-page");
    // the title picker, every switch of the card and of the notifications
    expect(html).toMatch(/data-settings-row="achievements.title"/);
    expect(html).toMatch(/aria-label="Title" aria-haspopup="listbox"/);
    expect(html).toContain("Show my points");
    expect(html).not.toContain("data-achievements-page");
    expect(html).not.toContain('data-achievement="hello-bot"');
    // the counts, the points, the level and the streak stay on every category page
    for (const category of ["all", "secrets"] as const) {
      const page = renderToStaticMarkup(createElement(AchievementsScreen, { initialCategory: category }));
      expect(page).not.toContain("data-achievements-settings-page");
      expect(page).not.toContain('data-settings-group="achievements.settings"');
      expect(page).toContain("data-achievement-points");
      expect(page).toContain("data-achievement-streak");
      expect(page).toContain("Level 7");
      expect(page).toContain("data-achievement-category-count");
    }
  });

  it("opens on a category and shows only that category", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsScreen, { initialCategory: "secrets" }));
    expect(html).toMatch(/aria-pressed="true" data-achievement-category="secrets"/);
    expect(html).toMatch(/aria-pressed="false" data-achievement-category="all"/);
    expect(html).not.toContain("data-recent-achievement");
    expect(html).not.toContain('data-achievement="hello-bot"');
    // a secret stays mysterious: its lock, its hint only, a dashed frame
    expect(html).toMatch(/data-achievement="konami" data-secret=""/);
    expect(html).toContain(">Secret achievement</span>");
    setLocale("fr");
    const fr = renderToStaticMarkup(createElement(AchievementsScreen));
    expect(fr).toContain(">Succès</h1>");
    expect(fr).toContain("<span>Premiers pas</span>");
    expect(fr).toContain(">Débloqués récemment</h3>");
    expect(fr).toContain(">Tous les états<");
  });

  it("shows the Mastery category with its progress bars, what each unlocks, and its secrets masked", () => {
    const mastery = ACHIEVEMENTS.filter((item) => item.category === "mastery");
    expect(mastery).toHaveLength(24);
    const items = ACHIEVEMENTS.map((item) => ({
      id: item.id,
      current: item.id === "hands-off" ? 4 : 0,
      target: item.rule.kind === "mastery" || item.rule.kind === "category" ? item.rule.target : 1,
      ...(item.id === "polyglot" ? { unlockedAt: 1 } : {}),
    }));
    resetAchievementsForTests({ status: "ready", snapshot: snapshot({ items, recent: [] }) });
    const html = renderToStaticMarkup(createElement(AchievementsScreen, { initialCategory: "mastery" }));
    expect(html).toMatch(/aria-pressed="true" data-achievement-category="mastery"/);
    // only the Mastery cards, each marked as one
    expect(html).not.toContain('data-achievement="hello-bot"');
    expect(html.match(/data-mastery=""/g)).toHaveLength(24);
    // a progress bar on every visible locked card, 0 included, with its numbers
    const handsOff = html.slice(html.indexOf('data-achievement="hands-off"'), html.indexOf("</li>", html.indexOf('data-achievement="hands-off"')));
    expect(handsOff).toContain('role="progressbar"');
    expect(handsOff).toContain(">4/10</span>");
    expect(handsOff).toContain(">Hands Off<");
    const quiet = html.slice(html.indexOf('data-achievement="quiet-nights"'), html.indexOf("</li>", html.indexOf('data-achievement="quiet-nights"')));
    expect(quiet).toContain(">0/30</span>");
    // what it unlocks: the looks, greyed while locked, plain once unlocked
    expect(handsOff).toContain('data-mastery-preview="hands-off"');
    expect(handsOff).toContain(">Unlocks</span>");
    expect(handsOff).toMatch(/class="mastery-look[^"]*" data-locked=""/);
    const polyglot = html.slice(html.indexOf('data-achievement="polyglot"'), html.indexOf("</li>", html.indexOf('data-achievement="polyglot"')));
    expect(html).toContain('data-unlocked="" data-achievement="polyglot"');
    expect(polyglot).not.toContain('data-locked=""');
    expect(polyglot).not.toContain('role="progressbar"');
    // the hardest gives every Mastery character two premium skins: five shown, then "+N more"
    const master = html.slice(html.indexOf('data-achievement="sagax-master"'), html.indexOf("</li>", html.indexOf('data-achievement="sagax-master"')));
    expect(master).toContain(">+3 more</span>");
    // a secret Mastery achievement keeps its name and its rewards hidden
    const secret = html.slice(html.indexOf('data-achievement="not-so-fast"'), html.indexOf("</li>", html.indexOf('data-achievement="not-so-fast"')));
    expect(secret).toContain("data-secret");
    expect(secret).not.toContain("Not So Fast");
    expect(secret).not.toContain("data-mastery-preview");
    // in French
    setLocale("fr");
    const fr = renderToStaticMarkup(createElement(AchievementsScreen, { initialCategory: "mastery" }));
    expect(fr).toContain("<span>Maîtrise</span>");
    expect(fr).toContain(">Déléguer sans surveiller<");
    expect(fr).toContain("<span>Paliers</span>");
    expect(fr).toContain(">Débloque</span>");
  });

  it("counts unlocked and total per category", () => {
    const counts = achievementCategoryCounts(new Set(["hello-bot", "first-words", "konami"]));
    expect(counts.all).toEqual({ unlocked: 3, total: ACHIEVEMENTS.length });
    expect(counts.onboarding.unlocked).toBe(2);
    expect(counts.secrets.unlocked).toBe(1);
    expect(counts.voice.unlocked).toBe(0);
    const sum = ACHIEVEMENTS_SCREEN_CATEGORIES.filter((id) => id !== "all").reduce((total, id) => total + counts[id].total, 0);
    expect(sum).toBe(ACHIEVEMENTS.length);
  });

  it("is no longer a Settings section", () => {
    expect(SECTIONS.map((section) => section.id)).not.toContain("achievements");
  });
});
