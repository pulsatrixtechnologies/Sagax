// The footer row, the way Perspicax lays out its account footer: the avatar
// and the full name, opening the profile menu. The sidebar's places are rows
// above it (SidebarPlaces.test.ts), so the tour's `tools` anchor is not here.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "@/state/store";
import type { AchievementSnapshot } from "../../shared/achievements";
import { resetAchievementsForTests } from "@/lib/achievements";

const fixture = vi.hoisted(() => ({ state: {} as Partial<AppState>, badge: true }));
vi.mock("@/lib/routines-badge-preferences", () => ({ useShowRoutinesBadge: () => fixture.badge }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: vi.fn() }) };
});

import { SidebarProfileMenu } from "./SidebarProfileMenu";

/** The account trigger's opening tag (its class says how the name sits). */
const accountTag = (html: string) => /<span[^>]*data-sidebar-account="[^"]*"[^>]*>/.exec(html)?.[0] ?? "";

const place = (key: string, attention = false) => ({ key, label: key, attention, onSelect: () => {} });

const points = (): AchievementSnapshot => ({
  points: 195,
  maxPoints: 1500,
  level: { level: 2, from: 0, to: 200 },
  unlockedCount: 0,
  count: 0,
  streak: 0,
  rewards: [],
  recent: [],
  items: [],
  settings: { showPoints: true, showTitle: true, toasts: true, native: false, public: false, title: "commander" },
});

beforeEach(() => {
  fixture.badge = true;
  fixture.state = { config: { profile: { name: "Jean-Christophe Proulx", email: "jc@example.com" } } as AppState["config"] };
  resetAchievementsForTests();
  vi.stubGlobal("window", {});
});
afterEach(() => { vi.unstubAllGlobals(); resetAchievementsForTests(); });

describe("sidebar footer row", () => {
  it("shows the avatar in its real colours and the full name, without the places' tour anchor", () => {
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, { places: [place("archived")] }));
    expect(html).toContain(">Jean-Christophe Proulx</span>");
    expect(html).not.toContain('data-tour="tools"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain("footer-tint");
    expect(html).not.toContain("filter");
    expect(html).toContain(">JP<");
    expect(html).toContain("width:40px");
    expect(html).toContain("height:40px");
    expect(html).not.toContain('data-testid="footer-attention"');
  });

  const withBadge = () => {
    fixture.state = {
      config: { profile: { name: "Jean-Christophe Proulx", email: "jc@example.com" } } as AppState["config"],
      bots: [{ id: "b1" }] as AppState["bots"],
      routines: [{ id: "r1", botId: "b1", enabled: true, nextRunAt: 1 }] as AppState["routines"],
    };
  };

  it("shows my title and points under the name when both switches are on", () => {
    resetAchievementsForTests({ status: "ready", snapshot: points() });
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    const nameAt = html.indexOf(">Jean-Christophe Proulx</span>");
    const lineAt = html.indexOf("data-member-line");
    expect(lineAt).toBeGreaterThan(nameAt);
    expect(html).toContain(">Commander<");
    expect(html).toContain(">195<");
    expect(html).toContain("data-gamertag");
    expect(html).not.toContain("-mt-[21px]");
  });

  it("shows only the title, or only the points, when one switch is off", () => {
    const base = points();
    resetAchievementsForTests({ status: "ready", snapshot: { ...base, settings: { ...base.settings, showPoints: false } } });
    let html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(html).toContain(">Commander<");
    expect(html).not.toContain("data-gamertag");
    resetAchievementsForTests({ status: "ready", snapshot: { ...base, settings: { ...base.settings, showTitle: false } } });
    html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(html).not.toContain(">Commander<");
    expect(html).toContain(">195<");
  });

  it("with both switches off the name stands alone, centred beside the avatar", () => {
    const base = points();
    resetAchievementsForTests({ status: "ready", snapshot: { ...base, settings: { ...base.settings, showPoints: false, showTitle: false } } });
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(html).toContain(">Jean-Christophe Proulx</span>");
    expect(html).not.toContain("data-member-line");
    expect(html).not.toContain(">Commander<");
    expect(html).not.toContain(">195<");
    expect(accountTag(html)).toContain("items-center");
    expect(html).not.toContain("data-routines-line");
  });

  it("hides the routines icon and count by default, even with active routines", () => {
    withBadge();
    fixture.badge = false;
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(html).not.toContain("data-routines-line");
    expect(html).not.toContain("data-active-routines");
    expect(html).toContain(">Jean-Christophe Proulx</span>");
  });

  it("puts the routines badge at the right of the row, beside the name, opening Automations", () => {
    fixture.state = {
      config: { profile: { name: "Jean-Christophe Proulx", email: "jc@example.com" } } as AppState["config"],
      bots: [{ id: "b1" }] as AppState["bots"],
      routines: [
        { id: "r1", botId: "b1", enabled: true, nextRunAt: 1 },
        { id: "r2", botId: "b1", enabled: true, nextRunAt: 2 },
        { id: "r3", botId: "b1", enabled: false, nextRunAt: null },
      ] as AppState["routines"],
    };
    resetAchievementsForTests({ status: "ready", snapshot: points() });
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    const nameAt = html.indexOf(">Jean-Christophe Proulx</span>");
    const lineAt = html.indexOf("data-routines-line");
    const badgeAt = html.indexOf('data-active-routines="2"');
    expect(lineAt).toBeGreaterThan(nameAt);
    expect(badgeAt).toBeGreaterThan(lineAt);
    // right of the whole account block, same flex row, centred, never under the name
    expect(html).toContain('<div class="flex items-center gap-1"><div class="min-w-0 flex-1">');
    expect(html).toContain('class="flex shrink-0 items-center" data-routines-line=""');
    expect(html).not.toContain("-mt-[21px]");
    expect(html).not.toContain("pl-[46px]");
    expect(html).toContain('aria-label="2 active routines"');
    expect(html).toContain("lucide-calendar-clock");
    // bigger and never red: 18 px icon, regular sidebar text size, accent tone
    expect(html).toContain('width="18"');
    expect(html).toContain("text-[14px]");
    expect(html).toContain("text-accent-text");
    expect(html).not.toContain("text-danger");
    expect(html).toContain("<span>2</span>");
    // the count is its own button, never inside the menu's
    expect(html.lastIndexOf("</button>", badgeAt)).toBeGreaterThan(nameAt);
    expect(html).not.toContain('data-testid="footer-attention"');
  });

  it("keeps the badge right-aligned with both switches off", () => {
    withBadge();
    const base = points();
    resetAchievementsForTests({ status: "ready", snapshot: { ...base, settings: { ...base.settings, showPoints: false, showTitle: false } } });
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(html).toContain('data-active-routines="1"');
    expect(html).toContain('class="flex shrink-0 items-center" data-routines-line=""');
    expect(html).not.toContain("data-member-line");
  });

  it("says one routine in the singular", () => {
    fixture.state = {
      config: { profile: { name: "Jean-Christophe Proulx", email: "jc@example.com" } } as AppState["config"],
      bots: [{ id: "b1" }] as AppState["bots"],
      routines: [{ id: "r1", botId: "b1", enabled: true, nextRunAt: 1 }] as AppState["routines"],
    };
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(html).toContain('aria-label="1 active routine"');
  });

  it("carries a place's attention dot while the menu is closed", () => {
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, { places: [place("archived", true)] }));
    expect(html).toContain('data-testid="footer-attention"');
  });

  it("keeps the routines count and icon without any dot when an automation failed, and clears the failed label once seen", () => {
    fixture.state = {
      config: { profile: { name: "Jean-Christophe Proulx", email: "jc@example.com" } } as AppState["config"],
      bots: [{ id: "b1" }] as AppState["bots"],
      routines: [{ id: "r1", botId: "b1", enabled: true, nextRunAt: 1 }] as AppState["routines"],
      routineRuns: [{ status: "failed" }] as AppState["routineRuns"],
    };
    const failed = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(failed).not.toContain('data-testid="footer-attention"');
    expect(failed).toContain("data-attention");
    expect(failed).not.toContain("routines-attention-dot");
    expect(failed).not.toContain("text-danger");
    expect(failed).toContain('aria-label="1 active routine. A run failed: open Automations"');
    fixture.state = {
      ...fixture.state,
      routineRuns: [{ status: "failed", seenAt: 1 }] as AppState["routineRuns"],
    };
    const seen = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(seen).not.toContain("data-attention");
    expect(seen).not.toContain("routines-attention-dot");
    expect(seen).toContain('aria-label="1 active routine"');
  });

  it("falls back to the viewer's name for a member on a shared server", () => {
    fixture.state = { config: { viewer: { operator: false, principalId: "u1", email: "sam@example.com", name: "Sam Tremblay", role: "member", canCreateBots: false } } as AppState["config"] };
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(html).toContain(">Sam Tremblay</span>");
  });

  it("keeps the avatar-only trigger for the collapsed rail, without the tour anchor", () => {
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, { avatarOnly: true }));
    expect(html).not.toContain('data-tour="tools"');
    expect(html).not.toContain(">Jean-Christophe Proulx</span>");
    expect(html).toContain('title="Jean-Christophe Proulx"');
    expect(html).toContain("width:36px");
    expect(html).not.toContain("data-sidebar-account-row");
    expect(html).not.toContain("width:40px");
  });
});
