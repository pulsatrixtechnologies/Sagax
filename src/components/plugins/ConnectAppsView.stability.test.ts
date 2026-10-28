// @vitest-environment happy-dom
// Connect apps, 2026-10-28 regressions:
//   - the install scope stays under the title on every tab (it vanished on
//     My accounts and the tabs jumped up); on My accounts it shows turned
//     off, with the reason;
//   - "N connected" always does something: from the tab it leads to, it
//     shows the other part of the count, or brings the list back to the
//     top; it has a hover fill and a focus ring, and the close button no
//     longer covers its chevron;
//   - a plugin's page opens inside its tab (title, scope and tabs kept, a
//     back row as a Settings sub-page), with the app's real mark, its name
//     once, the technical id as metadata, where it is installed and its main
//     action.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { buildPluginItems } from "@/lib/plugins-model";
import { detailIdentity, installedEntries } from "@/lib/installed-model";
import { CATEGORY_MODAL } from "../category-modal";
import { ConnectAppsView, connectedTarget, type ConnectAppsTab } from "./ConnectAppsView";
import { PluginDetailView } from "./PluginDetailView";
import { ScopeToggle } from "./ScopeToggle";

vi.mock("@/state/store", () => ({ api: vi.fn(() => new Promise(() => {})), useStore: () => ({ state: {}, dispatch: vi.fn() }) }));

const items = buildPluginItems({
  servers: [{ name: "github-github", enabled: true, url: "https://api.githubcopilot.com/mcp/", source: "claude-plugins-official" }],
  marketplaces: [{ name: "claude-plugins-official", plugins: [{ name: "github", installed: true, servers: ["github-github"], skills: [] }] }],
});
const noop = () => {};
const TABS: ConnectAppsTab[] = ["installed", "discover", "accounts", "sources"];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

const view = (tab: ConnectAppsTab, extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(ConnectAppsView, {
  tab, onTab: noop, items, onOpenConnected: noop, refreshing: false, onRefresh: noop,
  scope: createElement("div", { "data-test-scope": "" }, "SCOPE"),
  installed: "I", discover: "D", accounts: "A", sources: "S", ...extra,
}));

describe("the scope bar on every tab", () => {
  it("draws the scope above the tabs on each tab, My accounts included", () => {
    for (const tab of TABS) {
      const html = view(tab);
      expect(html, tab).toMatch(/data-plugins-scope-slot[\s\S]*?data-test-scope[\s\S]*?role="tablist"/);
    }
  });

  it("on My accounts the toggle is shown turned off, with the line that says why", () => {
    flushSync(() => root.render(createElement(ScopeToggle, { scope: "bot", botName: "Rocket", onScope: noop, disabled: true, describedBy: "why" })));
    const group = host.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-disabled")).toBe("true");
    expect(group.getAttribute("aria-describedby")).toBe("why");
    const options = [...host.querySelectorAll<HTMLButtonElement>("[data-plugins-scope-option]")];
    expect(options).toHaveLength(2);
    expect(options.every((option) => option.disabled)).toBe(true);
    // the scope in use is still the one marked
    expect(host.querySelector('[data-plugins-scope-option="bot"]')?.getAttribute("aria-checked")).toBe("true");
  });
});

describe("N connected", () => {
  it("never stays put on the tab it leads to when the count has another part", () => {
    // own connections and engine connectors: from Installed it shows My accounts, and back
    expect(connectedTarget({ current: "installed", subpage: false, botScope: false, engineConnected: 3, ownConnected: 2 })).toEqual({ tab: "accounts", same: false });
    expect(connectedTarget({ current: "accounts", subpage: false, botScope: false, engineConnected: 3, ownConnected: 2 })).toEqual({ tab: "installed", same: false });
    expect(connectedTarget({ current: "discover", subpage: false, botScope: false, engineConnected: 3, ownConnected: 2 })).toEqual({ tab: "installed", same: false });
    // only engine connectors: My accounts (#1194)
    expect(connectedTarget({ current: "discover", subpage: false, botScope: false, engineConnected: 3, ownConnected: 0 })).toEqual({ tab: "accounts", same: false });
    // on the only tab that lists them: same tab, the panel scrolls it to the top and focuses it
    expect(connectedTarget({ current: "installed", subpage: false, botScope: true, engineConnected: 3, ownConnected: 1 })).toEqual({ tab: "installed", same: true });
    // from a plugin's page: back to the tab's list
    expect(connectedTarget({ current: "installed", subpage: true, botScope: false, engineConnected: 0, ownConnected: 1 })).toEqual({ tab: "installed", same: false });
  });

  it("is one button with a hover fill and a keyboard focus ring, and calls back on a click", () => {
    const onOpen = vi.fn();
    flushSync(() => root.render(createElement(ConnectAppsView, {
      tab: "installed", onTab: noop, items, onOpenConnected: onOpen, refreshing: false, onRefresh: noop,
    })));
    const button = host.querySelector<HTMLButtonElement>("button[data-plugins-connected]")!;
    expect(button.className).toContain("hover:bg-hover");
    expect(button.className).toContain("focus-visible:ring-2");
    flushSync(() => button.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("the title row keeps clear of the close button at every width", () => {
    expect(CATEGORY_MODAL.titleBar).toContain("pr-12");
    expect(CATEGORY_MODAL.titleBar).not.toMatch(/\bsm:px-/);
  });
});

describe("a plugin's page in its tab", () => {
  it("keeps the title, the scope and the tabs; the tab it came from stays marked", () => {
    const html = view("installed", { page: createElement("div", { "data-test-page": "" }, "PAGE") });
    expect(html).toMatch(/id="plugins-title"[^>]*>Connect Apps<\/h2>[\s\S]*?data-test-scope[\s\S]*?role="tablist"[\s\S]*?data-plugins-subpage[\s\S]*?data-test-page/);
    expect(html).toMatch(/aria-selected="true"[^>]*aria-current="page"[^>]*data-plugins-tab="installed"/);
    // the tab's own list is not drawn under the page
    expect(html).not.toMatch(/>I</);
  });

  it("names the plugin for people with its real mark; the id is metadata", () => {
    const entries = installedEntries(items);
    const plugin = items.find((item) => item.kind === "plugin")!;
    const identity = detailIdentity(plugin, entries);
    expect(identity.name).toBe("GitHub");
    expect(identity.icon.kind).toBe("app");
    expect(identity.icon.logo || identity.icon.domain).toBeTruthy();
  });

  it("shows the name once, where it is installed and the main action; the back row names the tab", () => {
    const entries = installedEntries(items);
    const plugin = items.find((item) => item.kind === "plugin")!;
    const identity = detailIdentity(plugin, entries);
    const onBack = vi.fn();
    flushSync(() => root.render(createElement(PluginDetailView, {
      item: plugin, displayName: identity.name, icon: identity.icon, subtitle: "example/marketplace", busy: false,
      onBack, trail: [{ label: "Installed", onSelect: onBack }], details: [],
      installState: [{ id: "everyone", label: "Installed for everyone", on: true }, { id: "bot", label: "Not installed on Rocket", on: false }],
      primaryAction: createElement("button", { type: "button", "data-test-primary": "" }, "Install for Rocket"),
    })));
    // one visible name, no second title in the back row
    const visibleNames = [...host.querySelectorAll("h2, [data-breadcrumb-current]")].filter((node) => node.textContent === "GitHub");
    expect(visibleNames).toHaveLength(1);
    expect(host.querySelector("[data-breadcrumb-current]")).toBeNull();
    expect(host.querySelector("[data-breadcrumb-crumb='0']")?.textContent).toBe("Installed");
    // the real mark, not the generic plugin piece
    expect(host.querySelector("[data-plugins-detail-head] img")).not.toBeNull();
    // the technical name and source as small metadata
    expect(host.querySelector("[data-plugins-detail-meta]")?.textContent).toBe("github · example/marketplace");
    const states = [...host.querySelectorAll("[data-install-state]")].map((node) => [node.getAttribute("data-install-state"), node.getAttribute("data-install-on")]);
    expect(states).toEqual([["everyone", "yes"], ["bot", "no"]]);
    expect(host.querySelector("[data-plugins-detail-head] [data-test-primary]")).not.toBeNull();
    flushSync(() => host.querySelector<HTMLElement>("[data-plugins-back]")!.click());
    expect(onBack).toHaveBeenCalled();
  });
});
