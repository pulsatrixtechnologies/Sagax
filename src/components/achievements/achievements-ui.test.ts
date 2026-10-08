// The achievements' drawing: never in the sidebar footer, the member card,
// the unlock toast, the catalog's icons, and the page.
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
  it("keeps the title and the points out of the sidebar footer, whatever the toggles say", () => {
    for (const settings of [
      { showPoints: true, showTitle: true, toasts: true, native: false, public: true, title: "rookie" },
      { showPoints: false, showTitle: true, toasts: true, native: false, public: true, title: "rookie" },
      { showPoints: true, showTitle: false, toasts: true, native: false, public: true, title: "rookie" },
    ]) {
      resetAchievementsForTests({ status: "ready", snapshot: snapshot({ settings }) });
      const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
      expect(html).toContain(">Ada Lovelace</span>");
      expect(html).not.toContain("data-gamertag");
      expect(html).not.toContain("data-member-line");
      expect(html).not.toContain(">Rookie<");
      expect(html).not.toContain("1,240");
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
  it("shows the total, the level, progress and secrets kept secret", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(AchievementsPage));
    expect(html).toContain("data-achievements-page");
    expect(html).toContain("1,240");
    expect(html).toContain("Level 7");
    expect(html).toContain("2 of");
    expect(html).toContain("4-day streak");
    expect(html).toMatch(/data-unlocked="" data-achievement="hello-bot"/);
    expect(html).toContain('aria-valuenow="2"');
    // a secret stays a secret until found
    expect(html).toMatch(/data-achievement="konami" data-secret=""/);
    expect(html).not.toContain("Up Up Down Down");
  });

  it("has an icon for every achievement", () => {
    for (const item of ACHIEVEMENTS) expect(ACHIEVEMENT_ICONS[item.icon], item.icon).toBeTruthy();
  });
});
