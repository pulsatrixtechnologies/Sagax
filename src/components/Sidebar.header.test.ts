// Density is an occasional preference chosen in Settings > Appearance; the
// Sagax sidebar head keeps only its frequent controls (collapse and New).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale, t } from "@/lib/i18n";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { StoreProvider } from "@/state/store";

const fixture = vi.hoisted(() => ({ density: "comfortable" as SidebarDensity, templates: undefined as boolean | undefined, connectedApps: undefined as boolean | undefined }));

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
    "keeps collapse and add but no density menu at %s density",
    (density) => {
      fixture.density = density;
      const html = render();
      expect(html).toContain(density === "icons" ? 'aria-label="Expand sidebar"' : 'aria-label="Collapse sidebar to avatars"');
      expect(html).toContain('aria-label="New"');
      expect(html).not.toContain("Choose sidebar density");
      expect(html).not.toContain('title="Sidebar density"');
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
    expect(html).toContain(">Team map</span>");
  });

  it("spells the palette chord per platform", () => {
    expect(paletteShortcutLabel(true)).toBe("⌘K");
    expect(paletteShortcutLabel(false)).toBe("Ctrl+K");
    setLocale("fr");
    expect(t("sidebar.search")).toBe("Rechercher");
  });
});
