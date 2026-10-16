// Density is an occasional preference chosen in Settings > Appearance; the
// Sagax sidebar head keeps only its frequent controls (search and New). The
// edge collapses it: see `sidebarDragTarget` in sidebar-preferences.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

import { setLocale, t } from "@/lib/i18n";
import { resetAchievementsForTests } from "@/lib/achievements";
import type { AchievementSnapshot } from "../../shared/achievements";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { StoreProvider } from "@/state/store";

const fixture = vi.hoisted(() => ({ showLogo: true, density: "comfortable" as SidebarDensity, shortcuts: false }));

vi.mock("@/lib/sidebar-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sidebar-preferences")>(),
  useSidebarDensity: () => fixture.density,
}));

vi.mock("@/lib/sidebar-shortcuts-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sidebar-shortcuts-preferences")>(),
  useSidebarShortcuts: () => fixture.shortcuts,
  migrateSidebarShortcuts: () => false,
}));

vi.mock("@/lib/sidebar-logo-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sidebar-logo-preferences")>(),
  useShowSidebarLogo: () => fixture.showLogo,
}));

import { paletteShortcutLabel, Sidebar } from "./Sidebar";

const achievementSnapshot = (): AchievementSnapshot => ({
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

const render = () => renderToStaticMarkup(
  createElement(StoreProvider, null, createElement(Sidebar, { open: true, onClose: () => {} })),
);

beforeEach(() => {
  vi.stubGlobal("window", { innerWidth: 1280, location: { protocol: "http:", search: "" } });
  setLocale("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  fixture.shortcuts = false;
  fixture.density = "comfortable";
  resetAchievementsForTests();
  setLocale("en");
});

describe("sidebar header", () => {
  it.each(["comfortable", "compact", "icons"] as const)(
    "keeps search and New but no collapse button or density menu at %s density",
    (density) => {
      fixture.density = density;
      const html = render();
      expect(html).toContain('aria-label="New"');
      expect(html).not.toContain("data-sidebar-collapse");
      expect(html).not.toContain('aria-label="Expand sidebar"');
      expect(html).not.toContain('aria-label="Collapse sidebar to avatars"');
      expect(html).not.toContain("lucide-panel-left");
      expect(html).not.toContain("Choose sidebar density");
      expect(html).not.toContain('title="Sidebar density"');
    },
  );

  it.each(["comfortable", "compact", "icons"] as const)(
    "draws New as a round button like search, with upstream's plus glyph, at %s density",
    (density) => {
      fixture.density = density;
      const html = render();
      const news = html.match(/<button[^>]*data-sidebar-new[^>]*>[\s\S]*?<\/button>/g) ?? [];
      expect(news).toHaveLength(1);
      expect(news[0]).toContain('title="New"');
      expect(news[0]).toContain("lucide-plus");
      expect(news[0]).not.toContain("lucide-square-pen");
      const search = (html.match(/<button[^>]*data-sidebar-search[^>]*>/g) ?? [])[0] ?? "";
      const classOf = (tag: string) => /class="([^"]*)"/.exec(tag)?.[1];
      expect(classOf(news[0] ?? "")).toBe(classOf(search));
    },
  );

  it.each(["comfortable", "icons"] as const)(
    "keeps the edge separator (drag, double-click) at %s density, quiet at rest",
    (density) => {
      fixture.density = density;
      const html = render();
      const handle = (html.match(/<div[^>]*role="separator"[^>]*aria-label="Resize sidebar"[^>]*>/g) ?? [])[0] ?? "";
      expect(handle).toContain("app-resize-handle");
      expect(handle).toContain('aria-valuemin="80"');
      expect(handle).toContain(density === "icons" ? 'aria-valuenow="80"' : 'aria-valuenow="280"');
      expect(handle).not.toMatch(/bg-accent|w-3\b/);
    },
  );

  it.each(["comfortable", "compact", "icons"] as const)(
    "puts search in a round head button, not a full-width bar, at %s density",
    (density) => {
      fixture.density = density;
      const html = render();
      const buttons = html.match(/<button[^>]*data-sidebar-search[^>]*>/g) ?? [];
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toContain('aria-label="Search bots and messages"');
      expect(buttons[0]).toMatch(/aria-keyshortcuts="(Meta|Control)\+K"/);
      expect(buttons[0]).toMatch(/title="Search \((⌘K|Ctrl\+K)\)"/);
      expect(buttons[0]).toContain("rounded-full");
      expect(buttons[0]).toContain("focus-visible:ring-2");
      expect(buttons[0]).not.toContain("w-full");
      expect(html).not.toContain("Search…");
      expect(html).not.toContain("<kbd");
    },
  );

  // Settings > Appearance > Sidebar shortcuts (2026-10-14): on, the Connect
  // apps pill (in place of the Connected apps row, JC 2026-10-15) and the
  // Browse Bots row, and no title or points under the name; off, neither,
  // and the line is back.
  it("shows the Connect apps pill and the Browse Bots row, and no title or points, while Sidebar shortcuts is on", () => {
    fixture.density = "comfortable";
    fixture.shortcuts = true;
    resetAchievementsForTests({ status: "ready", snapshot: achievementSnapshot() });
    const html = render();
    const rows = [...html.matchAll(/data-sidebar-place="([^"]+)"/g)].map((match) => match[1]);
    expect(rows).toEqual(["browse-bots"]);
    expect(html).not.toContain(">Connected apps</span>");
    expect(html).toContain(">Browse Bots</span>");
    const pill = (html.match(/<button[^>]*data-sidebar-connect-apps[^>]*>/g) ?? [])[0] ?? "";
    expect(pill).toContain('data-tour="nav-apps"');
    expect(pill).toContain("rounded-full");
    expect(html).toContain(">Connect apps</span>");
    // the pill sits above Browse Bots, both above the account row
    expect(html.indexOf("data-sidebar-connect-apps")).toBeLessThan(html.indexOf('data-sidebar-place="browse-bots"'));
    expect(html).not.toContain('data-place-anim="puzzle"');
    expect(html).toContain('data-place-anim="grid"');
    expect(html).not.toContain("data-member-line");
    expect(html).not.toContain(">Commander<");
    expect(html).not.toContain("data-gamertag");
  });

  it("shows neither menu rows nor a Connect apps pill, and keeps title and points, while Sidebar shortcuts is off", () => {
    fixture.density = "comfortable";
    fixture.shortcuts = false;
    resetAchievementsForTests({ status: "ready", snapshot: achievementSnapshot() });
    const html = render();
    expect(html).not.toContain("data-sidebar-place=");
    expect(html).not.toContain(">Connected apps</span>");
    expect(html).not.toContain(">Browse Bots</span>");
    expect(html).not.toContain("data-sidebar-connect-apps");
    expect(html).not.toContain(">Connect apps</span>");
    expect(html).toContain("data-member-line");
    expect(html).toContain(">Commander<");
    expect(html).toContain("data-gamertag");
  });

  it("keeps the rows as icon buttons on the collapsed rail", () => {
    fixture.density = "icons";
    fixture.shortcuts = true;
    const html = render();
    expect(html).not.toContain('aria-label="Connected apps"');
    expect((html.match(/<button[^>]*data-sidebar-connect-apps[^>]*>/g) ?? [])[0]).toContain('aria-label="Connect apps"');
    expect(html).toContain('aria-label="Browse Bots"');
    expect(html).toContain('data-place-anim="grid"');
  });

  it("hides the brand row when the sidebar logo is turned off, keeping search and New", () => {
    expect(render()).toContain("data-sidebar-brand");
    fixture.showLogo = false;
    try {
      const html = render();
      expect(html).not.toContain("data-sidebar-brand");
      expect(html).toContain("data-sidebar-search");
    } finally {
      fixture.showLogo = true;
    }
  });

  it("spells the palette chord per platform", () => {
    expect(paletteShortcutLabel(true)).toBe("⌘K");
    expect(paletteShortcutLabel(false)).toBe("Ctrl+K");
    setLocale("fr");
    expect(t("sidebar.search")).toBe("Rechercher");
  });
});

