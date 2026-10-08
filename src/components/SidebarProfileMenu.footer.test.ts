// The footer row, the way Perspicax lays out its account footer: the avatar
// and the full name, opening the profile menu. The sidebar's places are rows
// above it (SidebarPlaces.test.ts), so the tour's `tools` anchor is not here.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "@/state/store";
import type { AchievementSnapshot } from "../../shared/achievements";
import { resetAchievementsForTests } from "@/lib/achievements";

const fixture = vi.hoisted(() => ({ state: {} as Partial<AppState> }));
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

  it("never shows an achievement title or points, and centres the name beside the avatar", () => {
    resetAchievementsForTests({ status: "ready", snapshot: points() });
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(html).toContain(">Jean-Christophe Proulx</span>");
    expect(html).not.toContain("data-gamertag");
    expect(html).not.toContain("data-member-line");
    expect(html).not.toContain("data-member-title");
    expect(html).not.toContain(">Commander<");
    expect(html).not.toContain(">195<");
    expect(html).not.toContain("data-routines-line");
    // no second line: the name sits centred, with no pull-up and no top pad
    const account = accountTag(html);
    expect(account).toContain("items-center");
    expect(account).not.toContain("items-start");
    expect(html).not.toContain("-mt-[21px]");
    expect(html).not.toContain("pt-0.5");
  });

  it("puts the routines icon and the active count under the name, opening Automations", () => {
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
    const rowAt = html.indexOf("data-sidebar-account-row");
    const nameAt = html.indexOf(">Jean-Christophe Proulx</span>");
    const lineAt = html.indexOf("data-routines-line");
    const badgeAt = html.indexOf('data-active-routines="2"');
    expect(rowAt).toBeGreaterThan(-1);
    expect(nameAt).toBeGreaterThan(rowAt);
    expect(lineAt).toBeGreaterThan(nameAt);
    expect(badgeAt).toBeGreaterThan(lineAt);
    expect(html).toContain('aria-label="2 active routines"');
    expect(html).toContain("lucide-calendar-clock");
    expect(html).toContain("<span>2</span>");
    // the count is its own button, never inside the menu's
    expect(badgeAt).toBeGreaterThan(html.lastIndexOf("</button>", badgeAt - 200));
    expect(html.lastIndexOf("</button>", badgeAt)).toBeGreaterThan(nameAt);
    expect(html).toContain("-mt-[21px]");
    expect(html).toContain("pl-[46px]");
    const account = accountTag(html);
    expect(account).toContain("items-start");
    // still no title or points
    expect(html).not.toContain(">Commander<");
    expect(html).not.toContain(">195<");
    expect(html).not.toContain('data-testid="footer-attention"');
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

  it("tints the routines count, not a red dot, when an automation failed, and clears it once seen", () => {
    fixture.state = {
      config: { profile: { name: "Jean-Christophe Proulx", email: "jc@example.com" } } as AppState["config"],
      bots: [{ id: "b1" }] as AppState["bots"],
      routines: [{ id: "r1", botId: "b1", enabled: true, nextRunAt: 1 }] as AppState["routines"],
      routineRuns: [{ status: "failed" }] as AppState["routineRuns"],
    };
    const failed = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(failed).not.toContain('data-testid="footer-attention"');
    expect(failed).toContain("data-attention");
    expect(failed).toContain("text-danger");
    expect(failed).toContain('aria-label="1 active routine. A run failed: open Automations"');
    fixture.state = {
      ...fixture.state,
      routineRuns: [{ status: "failed", seenAt: 1 }] as AppState["routineRuns"],
    };
    const seen = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    expect(seen).not.toContain("data-attention");
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
