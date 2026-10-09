// The achievements' drawing: never in the sidebar footer, the member card,
// the unlock toast, the catalog's icons, the page, and its own modal.
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
import { AchievementsModal, ACHIEVEMENTS_MODAL_CATEGORIES, achievementCategoryCounts } from "./AchievementsModal";
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
  fixture.state = { config: { profile: { name: "Ada Lovelace", email: "ada@example.com" } } as AppState["config"] };
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
    expect(bare).not.toContain("Level");
    expect(bare).not.toContain("lucide-trophy");
    // the name is the only line next to the avatar: no empty second line
    const head = bare.slice(bare.indexOf("member-card-head"), bare.indexOf("member-card-list"));
    expect(head).toContain('<div class="min-w-0 flex-1"><div class="truncate text-[14px] font-medium leading-5 text-ink">Ada Lovelace</div></div></div>');
    const titled = renderToStaticMarkup(createElement(MemberCard, { name: "Ada Lovelace", initials: "AL", title: "Rookie", pointsText: null, rows: [] }));
    expect(titled).toContain(">Rookie<");
    expect(titled).not.toContain("lucide-trophy");
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
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Rookie");
    expect(html).toContain("1,240");
    expect(html).toContain("Level 7");
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
});

describe("achievements page", () => {
  it("shows the header card, recent unlocks, the filters and a two-column grid of cards on All", () => {
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
    // the title picker at the right, with the titles unlocked so far
    expect(html).toContain(">Title<select");
    expect(html).toContain('<option value="rookie">Rookie</option>');
    // recent unlocks, a horizontal row of cards
    expect(html).toContain(">Recent unlocks</h3>");
    expect(html).toContain('data-recent-achievement="hello-bot"');
    // search, rewards and status, and no category chips: the modal's left column has them
    expect(html).toContain('data-achievement-search=""');
    expect(html).toContain('aria-label="Reward"');
    expect(html).toContain('aria-label="Show"');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("data-achievement-category=");
    // the cards: two columns, icon, name, points, rarity and reward
    expect(html).toContain("grid grid-cols-1 gap-2 sm:grid-cols-2");
    expect(html).toMatch(/class="achievement-card[^"]*" data-tier="[a-z]+" data-unlocked="" data-achievement="hello-bot"/);
    expect(html).toContain("achievement-card-badge");
    expect(html).toContain("achievement-card-tier");
    expect(html).toContain('aria-valuenow="2"');
    for (const item of ACHIEVEMENTS) expect(html).toContain(`data-achievement="${item.id}"`);
    // a secret stays a secret until found
    expect(html).toMatch(/data-achievement="konami" data-secret=""/);
    expect(html).not.toContain("Up Up Down Down");
    // the switches that hide the points and the toasts sit at the bottom
    expect(html.indexOf("Show my points")).toBeGreaterThan(html.indexOf('data-achievement="konami"'));
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
});

describe("achievements modal", () => {
  it("lists every category on the left with its unlocked count, All first and selected", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsModal));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("data-achievements-modal");
    // the Settings shell: same size, a left column, a close button
    expect(html).toContain("h-[min(700px,calc(100dvh-96px))] w-[min(900px,calc(100vw-40px))]");
    expect(html).toContain("w-[198px]");
    expect(html).toContain('aria-label="Close"');
    const labels = ["All", "Getting started", "Productivity", "Power user", "Voice", "Together", "Streaks", "Mastery", "Tiers", "Secrets"];
    expect(ACHIEVEMENTS_MODAL_CATEGORIES).toEqual(["all", "onboarding", "productivity", "power", "voice", "collaboration", "streaks", "mastery", "tiers", "secrets"]);
    const nav = html.slice(html.indexOf("data-achievements-nav"), html.indexOf("</nav>"));
    let at = 0;
    for (const label of labels) {
      const next = nav.indexOf(`>${label}</span>`, at);
      expect(next, label).toBeGreaterThan(at);
      at = next;
    }
    expect(nav).toMatch(/data-achievement-category="all" aria-current="page"/);
    expect(nav).toContain(`>2/${ACHIEVEMENTS.length}</span>`);
    const onboarding = ACHIEVEMENTS.filter((item) => item.category === "onboarding").length;
    expect(nav).toContain(`>2/${onboarding}</span>`);
    // the pane: the category's title, then the page on All with its recent unlocks
    expect(html).toContain(">All</h2>");
    expect(html).toContain("data-recent-achievement");
  });

  it("opens on a category and shows only that category", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsModal, { initialCategory: "secrets" }));
    expect(html).toMatch(/data-achievement-category="secrets" aria-current="page"/);
    expect(html).toContain(">Secrets</h2>");
    expect(html).not.toContain("data-recent-achievement");
    expect(html).not.toContain('data-achievement="hello-bot"');
    setLocale("fr");
    const fr = renderToStaticMarkup(createElement(AchievementsModal));
    expect(fr).toContain(">Succès</div>");
    expect(fr).toContain(">Premiers pas</span>");
    expect(fr).toContain(">Débloqués récemment</h3>");
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
    const html = renderToStaticMarkup(createElement(AchievementsModal, { initialCategory: "mastery" }));
    expect(html).toMatch(/data-achievement-category="mastery" aria-current="page"/);
    expect(html).toContain(">Mastery</h2>");
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
    const fr = renderToStaticMarkup(createElement(AchievementsModal, { initialCategory: "mastery" }));
    expect(fr).toContain(">Maîtrise</h2>");
    expect(fr).toContain(">Déléguer sans surveiller<");
    expect(fr).toContain(">Paliers</span>");
    expect(fr).toContain(">Débloque</span>");
  });

  it("counts unlocked and total per category", () => {
    const counts = achievementCategoryCounts(new Set(["hello-bot", "first-words", "konami"]));
    expect(counts.all).toEqual({ unlocked: 3, total: ACHIEVEMENTS.length });
    expect(counts.onboarding.unlocked).toBe(2);
    expect(counts.secrets.unlocked).toBe(1);
    expect(counts.voice.unlocked).toBe(0);
    const sum = ACHIEVEMENTS_MODAL_CATEGORIES.filter((id) => id !== "all").reduce((total, id) => total + counts[id].total, 0);
    expect(sum).toBe(ACHIEVEMENTS.length);
  });

  it("is no longer a Settings section", () => {
    expect(SECTIONS.map((section) => section.id)).not.toContain("achievements");
  });
});
