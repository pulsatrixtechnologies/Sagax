// @vitest-environment happy-dom
// The Achievements page's selected category: Settings' subtle fill only. Opened
// with a click, the entry takes focus without the keyboard ring (Chromium
// draws it around a focus() after a menu); opened from the keyboard, or once
// Tab or an arrow key moves, the standard ring shows (styles.css,
// [data-pointer-focus]:focus-visible).
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAchievementsForTests } from "@/lib/achievements";
import { setLastInputForTests } from "@/lib/input-modality";
import { setLocale } from "@/lib/i18n";
import { StoreProvider } from "@/state/store";
import { AchievementsScreen } from "./AchievementsScreen";

let host: HTMLDivElement;
let root: Root;
const current = () => host.querySelector<HTMLButtonElement>('[data-achievement-category][aria-current="page"]')!;

function mount() {
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(AchievementsScreen, { initialCategory: "voice" }))));
}

beforeEach(() => {
  setLocale("en");
  resetAchievementsForTests({ status: "unavailable" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  resetAchievementsForTests();
});

describe("the selected category's focus", () => {
  it("opened with a click: focused, marked so no keyboard ring shows", () => {
    setLastInputForTests("pointer");
    mount();
    expect(current().dataset.achievementCategory).toBe("voice");
    expect(document.activeElement).toBe(current());
    expect(current().hasAttribute("data-pointer-focus")).toBe(true);
  });

  it("opened from the keyboard: focused with the standard ring", () => {
    setLastInputForTests("keyboard");
    mount();
    expect(document.activeElement).toBe(current());
    expect(current().hasAttribute("data-pointer-focus")).toBe(false);
  });

  it("an arrow key moves to the next category, which shows the ring", () => {
    setLastInputForTests("pointer");
    mount();
    const nav = host.querySelector<HTMLElement>("[data-achievements-nav]")!;
    flushSync(() => { nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(current().dataset.achievementCategory).toBe("claude");
    expect(document.activeElement).toBe(current());
    expect(current().hasAttribute("data-pointer-focus")).toBe(false);
    // the one it left lost its mark with its focus
    expect(host.querySelector('[data-achievement-category="voice"]')!.hasAttribute("data-pointer-focus")).toBe(false);
  });
});
