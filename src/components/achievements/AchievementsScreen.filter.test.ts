// @vitest-environment happy-dom
// The Achievements page in one column (2026-10-28): the categories are a
// filter of the toolbar, not a left column. Picking one narrows the grid to
// it, the counts stay on every pill, the gear swaps the cards for the
// settings and back, and the page takes focus so Escape works at once.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import type { AchievementSnapshot } from "../../../shared/achievements";
import { resetAchievementsForTests } from "@/lib/achievements";
import { setLocale } from "@/lib/i18n";
import { StoreProvider } from "@/state/store";
import { AchievementsScreen } from "./AchievementsScreen";

let host: HTMLDivElement;
let root: Root;

function snapshot(): AchievementSnapshot {
  return {
    points: 120,
    maxPoints: 1500,
    level: { level: 2, from: 100, to: 250 },
    unlockedCount: 2,
    count: ACHIEVEMENTS.length,
    streak: 3,
    rewards: [],
    recent: ["hello-bot"],
    items: ACHIEVEMENTS.map((item) => ({ id: item.id, current: 0, target: 1, ...(item.id === "hello-bot" || item.id === "first-words" ? { unlockedAt: 1 } : {}) })),
    settings: { showPoints: true, showTitle: true, toasts: true, native: false, public: false },
  };
}

const cards = () => [...host.querySelectorAll<HTMLElement>("[data-achievement-grid] [data-achievement]")].map((card) => card.dataset.achievement);
const chip = (id: string) => host.querySelector<HTMLButtonElement>(`[data-achievement-category-filter] [data-achievement-category="${id}"]`)!;
const click = (element: HTMLElement) => flushSync(() => { element.click(); });

beforeEach(() => {
  setLocale("en");
  // the page asks the server again on mount: answer with the same snapshot
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(snapshot()), { headers: { "content-type": "application/json" } }));
  resetAchievementsForTests({ status: "ready", snapshot: snapshot() });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(AchievementsScreen))));
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  resetAchievementsForTests();
  vi.unstubAllGlobals();
});

describe("the category filter", () => {
  it("has no navigation column; the page takes focus for its keyboard", () => {
    expect(host.querySelector("nav")).toBeNull();
    expect(document.activeElement).toBe(host.querySelector("[data-achievements-screen]"));
  });

  it("narrows the grid to the chosen category and back to All", () => {
    expect(cards()).toHaveLength(ACHIEVEMENTS.length);
    expect(chip("all").getAttribute("aria-pressed")).toBe("true");
    click(chip("voice"));
    const voice = ACHIEVEMENTS.filter((item) => item.category === "voice").map((item) => item.id);
    expect(cards()).toEqual(voice);
    expect(chip("voice").getAttribute("aria-pressed")).toBe("true");
    expect(chip("all").getAttribute("aria-pressed")).toBe("false");
    // the recent unlocks belong to All
    expect(host.querySelector("[data-recent-achievement]")).toBeNull();
    // every pill keeps its count while another is chosen
    expect(chip("onboarding").querySelector("[data-achievement-category-count]")!.textContent).toBe(`2/${ACHIEVEMENTS.filter((item) => item.category === "onboarding").length}`);
    expect(chip("all").querySelector("[data-achievement-category-count]")!.textContent).toBe(`2/${ACHIEVEMENTS.length}`);
    click(chip("all"));
    expect(cards()).toHaveLength(ACHIEVEMENTS.length);
    expect(host.querySelector("[data-recent-achievement]")).not.toBeNull();
  });

  it("combines with the search, and says so when nothing is left", () => {
    click(chip("onboarding"));
    const input = host.querySelector<HTMLInputElement>("[data-achievement-search]")!;
    flushSync(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "zzzz-nothing");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(cards()).toEqual([]);
    expect(host.querySelector("[data-achievements-empty]")!.textContent).toBe("No achievement matches these filters.");
  });

  it("the gear swaps the cards for the settings, and back to the same category", () => {
    click(chip("streaks"));
    const gear = host.querySelector<HTMLButtonElement>("[data-achievements-settings-button]")!;
    click(gear);
    expect(gear.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("[data-achievements-settings-page]")).not.toBeNull();
    expect(host.querySelector("[data-achievement-grid]")).toBeNull();
    click(gear);
    expect(chip("streaks").getAttribute("aria-pressed")).toBe("true");
    expect(cards()).toEqual(ACHIEVEMENTS.filter((item) => item.category === "streaks").map((item) => item.id));
  });
});
