// The achievements' drawing: the gamertag under the name in the sidebar
// footer, the unlock toast, the catalog's icons, and the page.
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
import { gamertagText } from "./Gamertag";
import { AchievementToast } from "./AchievementToaster";
import { AchievementsPage } from "./AchievementsPage";
import { ACHIEVEMENT_ICONS } from "./icons";

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
    settings: { showPoints: true, toasts: true, native: false, public: false },
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

describe("gamertag", () => {
  it("shows the points grouped the person's way, or nothing", () => {
    expect(gamertagText({ status: "ready", points: 1240, showPoints: true })).toBe("1,240");
    setLocale("fr");
    expect(gamertagText({ status: "ready", points: 1240, showPoints: true })?.replace(/\s/g, " ")).toBe("1 240");
    expect(gamertagText({ status: "ready", points: 10, showPoints: false })).toBeNull();
    expect(gamertagText({ status: "unavailable", points: 10 })).toBeNull();
    expect(gamertagText({ status: "loading" })).toBeNull();
  });

  it("sits under the name in the sidebar footer, a trophy and the points, opening the achievements", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(html).toContain(">Ada Lovelace</span>");
    expect(html).toContain("data-gamertag");
    expect(html).toContain("<span>1,240</span>");
    expect(html).toContain('aria-label="1,240 points, level 7. Open achievements"');
    // the gamertag is its own button, never inside the menu's
    expect(html.indexOf("data-gamertag")).toBeGreaterThan(html.lastIndexOf("</button>", html.indexOf("data-gamertag")));
  });

  it("stays away when hidden or on a server without achievements", () => {
    resetAchievementsForTests({ status: "ready", snapshot: snapshot({ settings: { showPoints: false, toasts: true, native: false, public: false } }) });
    expect(renderToStaticMarkup(createElement(SidebarProfileMenu, {}))).not.toContain("data-gamertag");
    resetAchievementsForTests({ status: "unavailable" });
    expect(renderToStaticMarkup(createElement(SidebarProfileMenu, {}))).not.toContain("data-gamertag");
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
