// Density is an occasional preference chosen in Settings > Appearance; the
// Sagax sidebar head keeps only its frequent controls (search and New). The
// edge collapses it: see `sidebarDragTarget` in sidebar-preferences.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

import { setLocale, t } from "@/lib/i18n";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { StoreProvider } from "@/state/store";

const fixture = vi.hoisted(() => ({ showLogo: true, density: "comfortable" as SidebarDensity, templates: undefined as boolean | undefined, connectedApps: undefined as boolean | undefined }));

vi.mock("@/lib/sidebar-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sidebar-preferences")>(),
  useSidebarDensity: () => fixture.density,
}));

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => {
      const store = original.useStore();
      if (fixture.templates === undefined && fixture.connectedApps === undefined) return store;
      return { ...store, state: { ...store.state, config: { ...store.state.config, features: { skillAuthoring: true, templates: fixture.templates, connectedApps: fixture.connectedApps } } } };
    },
  };
});

vi.mock("@/lib/sidebar-logo-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sidebar-logo-preferences")>(),
  useShowSidebarLogo: () => fixture.showLogo,
}));

import { paletteShortcutLabel, Sidebar } from "./Sidebar";

const render = () => renderToStaticMarkup(
  createElement(StoreProvider, null, createElement(Sidebar, { open: true, onClose: () => {} })),
);

beforeEach(() => {
  vi.stubGlobal("window", { innerWidth: 1280, location: { protocol: "http:", search: "" } });
  setLocale("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  fixture.templates = undefined;
  fixture.connectedApps = undefined;
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
    "draws New as a round button like search, with the new-conversation glyph, at %s density",
    (density) => {
      fixture.density = density;
      const html = render();
      const news = html.match(/<button[^>]*data-sidebar-new[^>]*>[\s\S]*?<\/button>/g) ?? [];
      expect(news).toHaveLength(1);
      expect(news[0]).toContain('title="New"');
      expect(news[0]).toContain("lucide-square-pen");
      expect(news[0]).not.toContain("lucide-plus");
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

  it("hides Templates in the bottom menu until the experimental flag is on", () => {
    fixture.density = "comfortable";
    expect(render()).not.toContain(">Templates</span>");
    fixture.templates = false;
    expect(render()).not.toContain(">Templates</span>");
    fixture.templates = true;
    const html = render();
    expect(html).toContain(">Templates</span>");
    expect(html).not.toContain(">Connected apps</span>");
  });

  it("hides Connected apps in the bottom menu until its experimental flag is on", () => {
    fixture.density = "comfortable";
    expect(render()).not.toContain(">Connected apps</span>");
    expect(render()).not.toContain('data-tour="nav-apps"');
    fixture.connectedApps = false;
    expect(render()).not.toContain(">Connected apps</span>");
    fixture.connectedApps = true;
    const html = render();
    expect(html).toContain(">Connected apps</span>");
    expect(html).not.toContain(">Team map</span>");
    expect(html).not.toContain(">Automations</span>");
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

