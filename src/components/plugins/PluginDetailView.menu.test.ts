// @vitest-environment happy-dom
// Connect apps, simplified (2026-10-14): a plugin's Update, Test, Edit and
// Uninstall sit in one "..." menu, and the main view filters with All plus
// one Category menu that holds every category.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { buildPluginItems, CATEGORY_ORDER } from "@/lib/plugins-model";
import { PluginDetailView } from "./PluginDetailView";
import { ConnectAppsView } from "./ConnectAppsView";

vi.mock("@/state/store", () => ({ api: vi.fn(() => new Promise(() => {})), useStore: () => ({ state: {}, dispatch: vi.fn() }) }));

const items = buildPluginItems({ servers: [{ name: "glitcho", enabled: true, url: "https://qc1.example.net/mcp", auth: "connected" }] });
const noop = () => {};
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

const click = (element: Element | null) => flushSync(() => (element as HTMLElement).click());

describe("plugin detail menu", () => {
  it("opens on the \"...\" button and runs the chosen action", () => {
    const onUpdate = vi.fn();
    const onUninstall = vi.fn();
    const onTest = vi.fn();
    flushSync(() => root.render(createElement(PluginDetailView, {
      item: items[0]!, subtitle: "https://qc1.example.net/mcp", busy: false, onBack: noop, onClose: noop,
      onUpdate, onTest, onEdit: noop, onUninstall, details: [],
    })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    // an update waiting shows as a dot on the button
    expect(host.querySelector("[data-plugin-update-dot]")).not.toBeNull();
    click(host.querySelector("[data-plugin-actions]"));
    const actions = [...host.querySelectorAll("[data-plugin-action]")].map((node) => node.getAttribute("data-plugin-action"));
    expect(actions).toEqual(["update", "test", "edit", "uninstall"]);
    click(host.querySelector('[data-plugin-action="uninstall"]'));
    expect(onUninstall).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("has no menu when the plugin offers no action", () => {
    flushSync(() => root.render(createElement(PluginDetailView, {
      item: items[0]!, subtitle: "", busy: false, onBack: noop, onClose: noop, details: [],
    })));
    expect(host.querySelector("[data-plugin-actions]")).toBeNull();
  });
});

describe("Category menu", () => {
  it("lists every category and filters on one", () => {
    const onFilter = vi.fn();
    flushSync(() => root.render(createElement(ConnectAppsView, {
      items, loading: false, search: "", onSearch: noop, filter: "all", onFilter, onClose: noop,
      onOpenManage: noop, onOpenItem: noop, renderAction: () => null,
    })));
    click(host.querySelector('[aria-label="Category"]'));
    const options = [...host.querySelectorAll('[role="menuitemradio"]')];
    expect(options).toHaveLength(CATEGORY_ORDER.length);
    expect(options.map((node) => node.textContent)).toContain("Password managers");
    expect(options.map((node) => node.textContent)).toContain("Support");
    click(options.find((node) => node.textContent === "Finance")!);
    expect(onFilter).toHaveBeenCalledWith("finance");
  });

  it("shows the chosen category on the menu button", () => {
    flushSync(() => root.render(createElement(ConnectAppsView, {
      items, loading: false, search: "", onSearch: noop, filter: "design", onFilter: noop, onClose: noop,
      onOpenManage: noop, onOpenItem: noop, renderAction: () => null,
    })));
    expect(host.querySelector('[aria-label="Category"]')?.textContent).toBe("Design");
  });
});
