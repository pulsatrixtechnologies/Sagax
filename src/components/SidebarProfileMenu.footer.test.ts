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
  settings: { showPoints: true, toasts: true, native: false, public: false, title: "commander" },
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

  it("paints one highlight around the avatar, the name, and the points", () => {
    resetAchievementsForTests({ status: "ready", snapshot: points() });
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, {}));
    const rowAt = html.indexOf("data-sidebar-account-row");
    const nameAt = html.indexOf(">Jean-Christophe Proulx</span>");
    const lineAt = html.indexOf("data-member-line");
    const pointsAt = html.indexOf("data-gamertag");
    expect(rowAt).toBeGreaterThan(-1);
    expect(nameAt).toBeGreaterThan(rowAt);
    expect(lineAt).toBeGreaterThan(nameAt);
    expect(pointsAt).toBeGreaterThan(lineAt);
    const openTag = html.slice(html.lastIndexOf("<div", rowAt), html.indexOf(">", rowAt) + 1);
    expect(openTag).toContain("hover:bg-sidebar-hover");
    expect(openTag).toContain("has-[[aria-expanded=true]]:bg-sidebar-hover");
    expect(openTag).toContain("rounded-lg");
    // the name line is not a second hover pill, and the points stay their own button
    expect(html.slice(nameAt, lineAt)).not.toContain("hover:bg-sidebar-hover");
    const menuClose = html.lastIndexOf("</button>", pointsAt);
    expect(menuClose).toBeGreaterThan(nameAt);
    expect(pointsAt).toBeGreaterThan(menuClose);
    expect(html).toContain("width:40px");
    expect(html).toContain(">195<");
    expect(html).toContain("text-[14px]");
    expect(html).toContain("-mt-[21px]");
    expect(html).not.toContain("-mt-[18px]");
    // title button padding is 4px, so 46px puts the glyph under the name
    expect(html).toContain("pl-[46px]");
    expect(html).not.toContain("pl-[50px]");
    expect(html).toContain('data-footer=""');
    expect(html).toContain(">Commander<");
    const titleButton = html.slice(html.lastIndexOf("<button", html.indexOf(">Commander<")), html.indexOf(">Commander<"));
    expect(titleButton).toContain("text-[13px]");
    expect(titleButton).toContain("leading-[18px]");
    expect(titleButton).not.toContain("text-[11px]");
  });

  it("carries a menu item's attention dot while the menu is closed", () => {
    const html = renderToStaticMarkup(createElement(SidebarProfileMenu, { places: [place("archived", true)] }));
    expect(html).toContain('data-testid="footer-attention"');
  });

  it("dots the closed account row when an automation failed and clears it once seen", () => {
    fixture.state = {
      config: { profile: { name: "Jean-Christophe Proulx", email: "jc@example.com" } } as AppState["config"],
      routineRuns: [{ status: "failed" }] as AppState["routineRuns"],
    };
    expect(renderToStaticMarkup(createElement(SidebarProfileMenu, {}))).toContain('data-testid="footer-attention"');
    fixture.state = {
      ...fixture.state,
      routineRuns: [{ status: "failed", seenAt: 1 }] as AppState["routineRuns"],
    };
    expect(renderToStaticMarkup(createElement(SidebarProfileMenu, {}))).not.toContain('data-testid="footer-attention"');
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
