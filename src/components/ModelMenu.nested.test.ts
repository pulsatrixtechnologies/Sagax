// @vitest-environment happy-dom
// The composer's model menu nests (JC, 2026-10-14: "too many models
// shown"): a short root (Auto, the bot's model, Favorites, one row per
// provider), each provider's models in a submenu, a star on every model
// row, and a search that lists every match flat.
import { createElement, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { MODEL_FAVORITES_KEY, favoriteKey, toggleModelFavorite, useModelFavorites } from "@/lib/model-favorites";
import type { ModelMenuRow, ModelMenuSection } from "@/lib/model-menu";
import { ModelSearchList } from "./ModelMenu";

const model = (instanceId: string, id: string, label: string, extra: Partial<ModelMenuRow> = {}): ModelMenuRow => ({
  key: favoriteKey(instanceId, id), kind: "model", instanceId, modelId: id, label, current: false, ...extra,
});
const sections: ModelMenuSection[] = [
  { key: "top", rows: [
    { key: "auto", kind: "auto", label: "Auto", detail: "the best model per task", current: false },
    { key: "follow", kind: "follow", label: "Atlas's model", detail: "Sonnet 5", current: true },
  ] },
  { key: "claude", label: "Claude (API key)", rows: [
    model("claude", "opus", "Claude Opus 5.5"),
    model("claude", "sonnet", "Claude Sonnet 5", { tags: ["Default"] }),
    model("claude", "haiku", "Claude Haiku 5.5"),
  ] },
  { key: "grok", label: "Grok", rows: [model("grok", "grok-4.7", "Grok 4.7"), model("grok", "grok-4.5", "Grok 4.5")] },
];

const picked = vi.fn();
const escaped = vi.fn();
let host: HTMLDivElement;
let root: Root;

function Menu({ groupProviders }: { groupProviders: boolean }) {
  const keys = useModelFavorites();
  const [, rerender] = useState(0);
  return createElement("div", { style: { position: "fixed", right: "8px", bottom: "8px", width: "340px" }, "data-menu-box": "" },
    createElement(ModelSearchList, {
      variant: "popover", submenus: true, groupProviders, autoFocus: true, sections, onPick: picked, onEscape: escaped,
      favorites: { keys, onToggle: (row) => { toggleModelFavorite(row.key); rerender((n) => n + 1); } },
    }));
}

const render = (groupProviders = false) => flushSync(() => root.render(createElement(Menu, { groupProviders })));
const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T & HTMLElement>(selector);
const $$ = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
const input = () => $<HTMLInputElement>("[data-model-search]")!;
const key = (target: Element, name: string) => flushSync(() => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
});
const click = (target: Element) => flushSync(() => {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
});
const type = (value: string) => {
  const field = input();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  flushSync(() => field.dispatchEvent(new Event("input", { bubbles: true })));
};
/** The model ids the root draws outside any submenu. */
const rootModels = () => $$("[data-model-list] [data-model-option]").map((row) => row.dataset.modelOption);
const submenu = () => $("[data-model-submenu]");

beforeEach(() => {
  setLocale("en");
  localStorage.clear();
  picked.mockReset();
  escaped.mockReset();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { fn(0); return 0; });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  // the menu sits 340 px wide near the window's left edge
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 10, right: 350, top: 100, bottom: 500, width: 340, height: 400, x: 10, y: 100, toJSON: () => ({}),
  } as DOMRect);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the nested model menu", () => {
  it("has a short root: search, Auto, the bot's model checked, one row per provider and no flat model list", () => {
    render();
    expect(input().placeholder).toBe("Search models");
    expect($$("[data-model-list] [role=menuitemradio]").map((row) => row.dataset.modelRowKey)).toEqual(["auto", "follow"]);
    expect($("[data-follow-bot-model]")!.getAttribute("aria-checked")).toBe("true");
    expect(rootModels()).toEqual([]);
    expect($("[data-model-favorites]")).toBeNull();
    const providers = $$("[data-model-provider]");
    expect(providers.map((row) => row.textContent)).toEqual(["Claude (API key)", "Grok"]);
    for (const row of providers) {
      expect(row.getAttribute("role")).toBe("menuitem");
      expect(row.getAttribute("aria-haspopup")).toBe("menu");
      expect(row.getAttribute("aria-expanded")).toBe("false");
    }
    expect($("[data-model-list]")!.getAttribute("role")).toBe("menu");
  });

  it("opens a provider's models in a submenu beside the menu on click, and picks from it", () => {
    render();
    click($('[data-model-provider="claude"]')!);
    expect($('[data-model-provider="claude"]')!.getAttribute("aria-expanded")).toBe("true");
    expect(submenu()!.dataset.modelSubmenuPlacement).not.toBe("stacked");
    expect([...submenu()!.querySelectorAll<HTMLElement>("[data-model-option]")].map((row) => row.dataset.modelOption)).toEqual(["opus", "sonnet", "haiku"]);
    expect(submenu()!.textContent).toContain("Default");
    click(submenu()!.querySelector('[data-model-option="haiku"]')!);
    expect(picked).toHaveBeenCalledWith(expect.objectContaining({ modelId: "haiku", instanceId: "claude" }));
  });

  it("opens on hover after a short pause", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(hover: hover)", media: query }));
    try {
      render();
      flushSync(() => input().dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: $('[data-model-provider="grok"]') })));
      flushSync(() => vi.advanceTimersByTime(200));
      expect(submenu()?.dataset.modelSubmenu).toBe("grok");
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts a starred model under Auto, keeps it after a reload, and takes it away again", () => {
    render();
    click($('[data-model-provider="grok"]')!);
    const star = submenu()!.querySelector<HTMLElement>('[data-model-option="grok-4.7"] [data-model-favorite]')!;
    expect(star.getAttribute("aria-label")).toBe("Add Grok 4.7 to favorites");
    click(star);
    expect(picked).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(MODEL_FAVORITES_KEY)!)).toEqual([["grok", "grok-4.7"]]);
    // a fresh menu reads it back: Favorites sits right under Auto
    flushSync(() => root.unmount());
    root = createRoot(host);
    render();
    const groups = $$("[data-model-list] > [role=group]");
    expect(groups.map((group) => group.dataset.modelSection ?? (group.hasAttribute("data-model-favorites") ? "favorites" : "providers"))).toEqual(["top", "favorites", "providers"]);
    expect($("[data-model-favorites]")!.textContent).toContain("Favorites");
    expect(rootModels()).toEqual(["grok-4.7"]);
    const filled = $('[data-model-favorites] [data-model-favorite]')!;
    expect(filled.dataset.modelFavorite).toBe("on");
    expect(filled.getAttribute("aria-label")).toBe("Remove Grok 4.7 from favorites");
    click(filled);
    expect($("[data-model-favorites]")).toBeNull();
    expect(JSON.parse(localStorage.getItem(MODEL_FAVORITES_KEY)!)).toEqual([]);
  });

  it("lists every provider's matches flat while searching, with stars, and comes back to the submenus when cleared", () => {
    render();
    type(".5");
    expect($("[data-model-provider]")).toBeNull();
    expect($("[data-model-list]")!.getAttribute("role")).toBe("listbox");
    expect($$("[data-model-section]").map((section) => section.dataset.modelSection)).toEqual(["claude", "grok"]);
    expect($$("[data-model-option]").map((row) => row.dataset.modelOption)).toEqual(["opus", "haiku", "grok-4.5"]);
    expect($$("[data-model-option] [data-model-favorite]")).toHaveLength(3);
    key(input(), "Enter");
    expect(picked).toHaveBeenCalledWith(expect.objectContaining({ modelId: "opus" }));
    type("");
    expect($$("[data-model-provider]")).toHaveLength(2);
    expect(rootModels()).toEqual([]);
  });

  it("goes in with the right arrow, moves with the arrows, comes back with the left arrow and Escape", () => {
    render();
    input().focus();
    // the current row is active first; the providers come last
    const active = () => input().getAttribute("aria-activedescendant");
    const claudeRow = $('[data-model-provider="claude"]')!;
    while (active() !== claudeRow.id) key(input(), "ArrowDown");
    key(input(), "ArrowRight");
    expect(submenu()!.dataset.modelSubmenu).toBe("claude");
    expect(document.activeElement).toBe(submenu()!.querySelector('[data-model-option="opus"]'));
    key(document.activeElement!, "ArrowDown");
    expect((document.activeElement as HTMLElement).dataset.modelOption).toBe("sonnet");
    key(document.activeElement!, "ArrowRight");
    expect((document.activeElement as HTMLElement).dataset.modelFavorite).toBe("off");
    key(document.activeElement!, "ArrowLeft");
    expect((document.activeElement as HTMLElement).dataset.modelOption).toBe("sonnet");
    key(document.activeElement!, "ArrowLeft");
    expect(submenu()).toBeNull();
    expect(document.activeElement).toBe(input());
    expect(active()).toBe(claudeRow.id);
    key(input(), "Enter");
    expect(submenu()!.dataset.modelSubmenu).toBe("claude");
    key(document.activeElement!, "Enter");
    expect(picked).toHaveBeenCalledWith(expect.objectContaining({ modelId: "opus" }));
    picked.mockReset();
    key(document.activeElement!, "Escape");
    expect(submenu()).toBeNull();
    expect(escaped).not.toHaveBeenCalled();
    key(input(), "Escape");
    expect(escaped).toHaveBeenCalledOnce();
  });

  it("opens the submenu in place with Back when the window has no room beside the menu", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    render();
    click($('[data-model-provider="grok"]')!);
    expect(submenu()!.dataset.modelSubmenuPlacement).toBe("stacked");
    expect(submenu()!.querySelector("[data-model-submenu-back]")!.textContent).toContain("Back");
    click(submenu()!.querySelector("[data-model-submenu-back]")!);
    expect(submenu()).toBeNull();
  });
});

// Providers grouped (Simple since JC 2026-10-14, every mode since JC
// 2026-10-18): one "Provider ›" row under Auto, the bot's model and the
// favorites; the provider submenus stay inside it.
describe("the nested model menu with the providers grouped", () => {
  it("shows Auto, the bot's model and one Provider row instead of the providers", () => {
    render(true);
    expect($$("[data-model-list] [role=menuitemradio]").map((row) => row.dataset.modelRowKey)).toEqual(["auto", "follow"]);
    expect($$("[data-model-provider]")).toEqual([]);
    const all = $("[data-model-all]")!;
    expect(all.textContent).toBe("Provider");
    expect(all.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("keeps the favorites above Provider", () => {
    toggleModelFavorite(favoriteKey("grok", "grok-4.5"));
    render(true);
    expect($("[data-model-favorites]")).not.toBeNull();
    expect(rootModels()).toEqual(["grok-4.5"]);
    expect($("[data-model-all]")).not.toBeNull();
  });

  it("lists the providers in place of the root on click, each opening its submenu, and comes back", () => {
    render(true);
    click($("[data-model-all]")!);
    expect($("[data-model-all]")).toBeNull();
    expect($$("[data-model-list] [role=menuitemradio]")).toEqual([]);
    expect($$("[data-model-provider]").map((row) => row.textContent)).toEqual(["Claude (API key)", "Grok"]);
    click($('[data-model-provider="grok"]')!);
    expect(submenu()).not.toBeNull();
    click($$("[data-model-submenu] [data-model-option]").find((row) => row.dataset.modelOption === "grok-4.7")!);
    expect(picked).toHaveBeenCalledWith(expect.objectContaining({ modelId: "grok-4.7" }));
    click($("[data-model-all-back]")!);
    expect($("[data-model-all]")).not.toBeNull();
    expect($$("[data-model-provider]")).toEqual([]);
  });

  it("opens Provider with the keyboard and goes back with Escape before closing the menu", () => {
    render(true);
    // the bot's model is checked, so the next row down is Provider
    key(input(), "ArrowDown");
    expect(input().getAttribute("aria-activedescendant")).toBe($("[data-model-all]")!.id);
    key(input(), "ArrowRight");
    expect($$("[data-model-provider]").length).toBe(2);
    key(input(), "Escape");
    expect($("[data-model-all]")).not.toBeNull();
    expect(escaped).not.toHaveBeenCalled();
    key(input(), "Escape");
    expect(escaped).toHaveBeenCalledTimes(1);
  });

  it("searches every provider flat, as in Advanced", () => {
    render(true);
    type("grok");
    expect(rootModels()).toEqual(["grok-4.7", "grok-4.5"]);
    expect($("[data-model-all]")).toBeNull();
  });
});
