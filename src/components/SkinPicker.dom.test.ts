// @vitest-environment happy-dom
// Settings > Appearance > Skin (2026-10-19): a tile per family, the chosen
// family's variants as swatches and its mode as a pill (Light, Dark, Auto).
// A saved skin opens on its own family, variant and scheme.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKIN_MODE_KEY, SKIN_VARIANTS_KEY } from "@/lib/skin-families";
import { SkinPicker } from "./SkinPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let systemDark = true;

beforeEach(() => {
  localStorage.clear();
  systemDark = true;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" ? systemDark : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.skin;
  vi.unstubAllGlobals();
});

function open(skin: string) {
  document.documentElement.dataset.skin = skin;
  localStorage.setItem("omb-skin", skin);
  act(() => root.render(createElement(SkinPicker)));
}

const tile = (id: string) => host.querySelector<HTMLButtonElement>(`[data-skin-family="${id}"]`);
const swatch = (id: string) => host.querySelector<HTMLButtonElement>(`[data-skin-variant="${id}"]`);
const modePill = () => host.querySelector<HTMLElement>('[data-settings-row="skinMode"]');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("SkinPicker", () => {
  it("shows the families, not the twelve skins, and Hibou 98 only once unlocked", () => {
    open("pulsatrix");
    const families = [...host.querySelectorAll("[data-skin-family]")].map((el) => el.getAttribute("data-skin-family"));
    expect(families).toEqual(["pulsatrix", "studio", "atelier"]);
    expect(tile("pulsatrix")!.getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).not.toMatch(/[–—]/);
  });

  it.each([
    ["midnight", "studio", "neutral", "Dark"],
    ["daylight", "studio", "neutral", "Light"],
    ["graphite", "studio", "slate", "Dark"],
    ["linen", "studio", "slate", "Light"],
    ["dusk", "studio", "plum", "Dark"],
    ["meadow", "studio", "meadow", "Light"],
    ["atelier", "atelier", "brass", "Light"],
    ["foundry", "atelier", "brass", "Dark"],
    ["lagoon", "atelier", "lagoon", "Light"],
    ["pulsatrix-light", "pulsatrix", null, "Light"],
  ])("opens a saved %s on its family %s, variant %s, mode %s, wearing the same skin", (skin, family, variant, mode) => {
    open(skin);
    expect(tile(family)!.getAttribute("aria-pressed")).toBe("true");
    // the selected tile's miniature is the worn skin itself
    expect(tile(family)!.querySelector("[data-skin]")!.getAttribute("data-skin")).toBe(skin);
    if (variant) expect(swatch(variant)!.getAttribute("aria-checked")).toBe("true");
    else expect(host.querySelector('[data-settings-row="skinVariant"]')).toBeNull();
    expect(modePill()!.textContent).toContain(mode);
    expect(document.documentElement.dataset.skin).toBe(skin);
  });

  it("picks a variant: the skin changes, the scheme stays where the variant has it", async () => {
    open("midnight");
    await act(async () => { swatch("slate")!.click(); await flush(); });
    expect(document.documentElement.dataset.skin).toBe("graphite");
    expect(localStorage.getItem("omb-skin")).toBe("graphite");
    await act(async () => { swatch("meadow")!.click(); await flush(); });
    // Meadow is light only
    expect(document.documentElement.dataset.skin).toBe("meadow");
    expect(JSON.parse(localStorage.getItem(SKIN_VARIANTS_KEY)!)).toEqual({ studio: "meadow" });
  });

  it("picks a family on its remembered variant", async () => {
    localStorage.setItem(SKIN_VARIANTS_KEY, JSON.stringify({ studio: "plum" }));
    open("pulsatrix");
    expect(tile("studio")!.querySelector("[data-skin]")!.getAttribute("data-skin")).toBe("dusk");
    await act(async () => { tile("studio")!.click(); await flush(); });
    expect(document.documentElement.dataset.skin).toBe("dusk");
  });

  it("Auto follows the system and is kept; a variant without a pair turns it off", async () => {
    open("midnight");
    systemDark = false;
    const trigger = modePill()!.querySelector<HTMLButtonElement>("[aria-haspopup='listbox']")!;
    await act(async () => { trigger.click(); await flush(); });
    const auto = [...host.querySelectorAll<HTMLElement>("[role='option']")].find((el) => el.textContent?.includes("Auto"))!;
    await act(async () => { auto.click(); await flush(); });
    expect(localStorage.getItem(SKIN_MODE_KEY)).toBe("auto");
    expect(document.documentElement.dataset.skin).toBe("daylight");
    await act(async () => { swatch("plum")!.click(); await flush(); });
    expect(document.documentElement.dataset.skin).toBe("dusk");
    expect(localStorage.getItem(SKIN_MODE_KEY)).toBeNull();
  });

  it("disables the modes a variant lacks", async () => {
    open("dusk");
    const trigger = modePill()!.querySelector<HTMLButtonElement>("[aria-haspopup='listbox']")!;
    await act(async () => { trigger.click(); await flush(); });
    const options = [...host.querySelectorAll<HTMLElement>("[role='option']")];
    const state = Object.fromEntries(options.map((el) => [el.textContent?.trim(), el.getAttribute("aria-disabled")]));
    expect(state["Light"]).toBe("true");
    expect(state["Dark"]).not.toBe("true");
  });

  it("keeps Hibou 98 a family of its own, with no variant or mode row", () => {
    localStorage.setItem("omb.retro98.unlocked", "1");
    open("retro98");
    expect(tile("retro98")!.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-settings-row="skinVariant"]')).toBeNull();
    expect(modePill()).toBeNull();
  });
});
