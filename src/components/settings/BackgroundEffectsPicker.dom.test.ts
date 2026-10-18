// @vitest-environment happy-dom
// Settings > Appearance > Background effects: the gallery picks the effect,
// the swatches its colour, the pill the intensity, all persisted; the old
// glyph ripple switch arrives as the Glyph ripple tile.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKGROUND_EFFECTS } from "@/lib/background-effects";
import { BACKGROUND_EFFECT_KEY, GLYPH_RIPPLE_KEY, readBackgroundEffectPrefs, resetBackgroundEffectPrefsForTests } from "@/lib/background-effect-preferences";
import { BackgroundEffectsPicker } from "./BackgroundEffectsPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  resetBackgroundEffectPrefsForTests();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: fine)", media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  // no WebGL2 in happy-dom: tiles show their swatch, the preview the 2D ring
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => null) as never);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const tile = (id: string) => host.querySelector<HTMLButtonElement>(`[data-effect-tile="${id}"]`)!;

describe("BackgroundEffectsPicker", () => {
  it("shows a tile per effect, None selected by default, and no colour row", () => {
    act(() => root.render(createElement(BackgroundEffectsPicker)));
    expect(host.querySelectorAll("[data-effect-tile]")).toHaveLength(BACKGROUND_EFFECTS.length);
    expect(tile("none").getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("[role='radiogroup']")).toBeNull();
    expect(host.querySelector("[role='note']")).not.toBeNull();
  });

  it("brings the old switch over: on selects Glyph ripple", () => {
    localStorage.setItem(GLYPH_RIPPLE_KEY, "1");
    act(() => root.render(createElement(BackgroundEffectsPicker)));
    expect(tile("glyphs").getAttribute("aria-pressed")).toBe("true");
  });

  it("picks an effect, then a colour and an intensity, persisted at once", () => {
    act(() => root.render(createElement(BackgroundEffectsPicker)));
    act(() => tile("aurora").click());
    expect(tile("aurora").getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("[data-background-preview] canvas")?.getAttribute("data-background-effect")).toBe("aurora");
    // no WebGL2 here: a new canvas carries the 2D ring
    expect(host.querySelector("[data-background-preview] canvas")?.getAttribute("data-fallback")).toBe("2d");
    const swatches = host.querySelectorAll<HTMLButtonElement>("[data-palette-swatch]");
    expect(swatches.length).toBeGreaterThanOrEqual(4);
    expect(host.querySelector("[data-palette-swatch='aurora']")!.getAttribute("aria-checked")).toBe("true");
    act(() => host.querySelector<HTMLButtonElement>("[data-palette-swatch='violet']")!.click());
    expect(host.querySelector("[data-palette-swatch='violet']")!.getAttribute("aria-checked")).toBe("true");
    expect(host.querySelector("[data-background-preview] canvas")?.getAttribute("data-palette")).toBe("violet");
    const stored = JSON.parse(localStorage.getItem(BACKGROUND_EFFECT_KEY)!);
    expect(stored).toMatchObject({ effect: "aurora", palettes: { aurora: "violet" } });
    expect(readBackgroundEffectPrefs().palettes.aurora).toBe("violet");
    // back to None: no canvas in the preview
    act(() => tile("none").click());
    expect(host.querySelector("[data-background-preview] canvas")).toBeNull();
  });
});
