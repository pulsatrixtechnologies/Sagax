// @vitest-environment happy-dom
// The glyph field behind the conversation (Settings > Appearance > Glyph
// ripple on click): off by default, a canvas that never takes a click, and
// no ring with reduced motion.
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLYPH_RIPPLE_KEY, setGlyphRippleEnabled } from "@/lib/glyph-ripple-preferences";
import { mountGlyphField, type GlyphContext, type GlyphEngine } from "@/lib/glyph-ripple";
import { mountGlyphEnergy } from "@/lib/glyph-energy";
import { GlyphRippleLayer, useGlyphRippleShown } from "./GlyphRippleLayer";
import { GlyphRippleRow } from "./settings/AppearanceSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let fine = true;

function fakeContext(): GlyphContext {
  return { globalAlpha: 1, clearRect: () => {}, drawImage: () => {} };
}

beforeEach(() => {
  fine = true;
  localStorage.clear();
  setGlyphRippleEnabled(false);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: fine)" ? fine : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => fakeContext()) as never);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.reducedMotion;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Pane() {
  const pane = createRef<HTMLDivElement>();
  const shown = useGlyphRippleShown();
  return createElement("div", { className: "relative" },
    createElement(GlyphRippleLayer, { paneRef: pane, shown }),
    createElement("div", { ref: pane, "data-pane": "" }, createElement("p", null, "hello")),
  );
}

describe("GlyphRippleLayer", () => {
  it("is off by default: no canvas, nothing mounted", () => {
    act(() => root.render(createElement(Pane)));
    expect(localStorage.getItem(GLYPH_RIPPLE_KEY)).toBe("0");
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("when on, one canvas that never takes a click and is hidden from assistive tech", () => {
    setGlyphRippleEnabled(true);
    act(() => root.render(createElement(Pane)));
    const canvases = host.querySelectorAll("canvas");
    expect(canvases).toHaveLength(1);
    const canvas = canvases[0];
    expect(canvas.className.split(" ")).toContain("pointer-events-none");
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    // behind the pane, which comes after it
    expect(canvas.nextElementSibling?.hasAttribute("data-pane")).toBe(true);
    // it follows the switch live
    act(() => setGlyphRippleEnabled(false));
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("stays away from a coarse pointer (phones, tablets): desktop only", () => {
    fine = false;
    setGlyphRippleEnabled(true);
    act(() => root.render(createElement(Pane)));
    expect(host.querySelector("canvas")).toBeNull();
  });
});

describe("mountGlyphField", () => {
  function mount() {
    const canvas = document.createElement("canvas");
    const pane = document.createElement("div");
    const message = document.createElement("p");
    const field = document.createElement("textarea");
    pane.append(message, field);
    document.body.append(canvas, pane);
    const mounted = mountGlyphField(canvas, pane);
    // happy-dom has no layout: give the field a size by hand
    mounted.field!.setColors({ ink: "#fff", tint: "#4d8dff", scheme: "dark" });
    mounted.field!.resize(800, 600, 1);
    const click = (target: Element) => target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, isPrimary: true, pointerType: "mouse", clientX: 40, clientY: 40 }));
    return { ...mounted, message, field: mounted.field!, textarea: field, click, cleanup: () => { mounted.unmount(); canvas.remove(); pane.remove(); } };
  }

  it("starts a ring on a click in the conversation, not in a field", () => {
    const view = mount();
    view.click(view.textarea);
    expect(view.field.rippleCount).toBe(0);
    view.click(view.message);
    expect(view.field.rippleCount).toBe(1);
    view.cleanup();
  });

  it("starts no ring with the app's reduce-motion switch on", () => {
    document.documentElement.dataset.reducedMotion = "true";
    const view = mount();
    view.click(view.message);
    expect(view.field.rippleCount).toBe(0);
    expect(view.field.animating).toBe(false);
    view.cleanup();
  });

  it("stops listening once unmounted", () => {
    const view = mount();
    view.unmount();
    view.click(view.message);
    expect(view.field.rippleCount).toBe(0);
    view.cleanup();
  });
});

describe("mountGlyphField with an engine that has a pointer glow", () => {
  function mount() {
    const canvas = document.createElement("canvas");
    const pane = document.createElement("div");
    const message = document.createElement("p");
    pane.append(message);
    document.body.append(canvas, pane);
    const calls = { ripple: 0, hover: 0, leave: 0, destroy: 0 };
    const engine: GlyphEngine = {
      setColors: () => {},
      resize: () => {},
      ripple: () => {
        calls.ripple += 1;
        return true;
      },
      hover: () => void (calls.hover += 1),
      leave: () => void (calls.leave += 1),
      settle: () => {},
      destroy: () => void (calls.destroy += 1),
    };
    const mounted = mountGlyphField(canvas, pane, engine);
    const move = (pointerType: string) => message.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType, clientX: 20, clientY: 20 }));
    return { calls, move, pane, mounted, cleanup: () => { mounted.unmount(); canvas.remove(); pane.remove(); } };
  }

  it("feeds mouse moves to the glyph, never touch, and fades on leave", () => {
    const view = mount();
    view.move("mouse");
    view.move("touch");
    expect(view.calls.hover).toBe(1);
    view.pane.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    expect(view.calls.leave).toBe(1);
    view.cleanup();
    expect(view.calls.destroy).toBe(1);
    view.move("mouse");
    expect(view.calls.hover).toBe(1);
  });

  it("gives no glow with reduced motion", () => {
    document.documentElement.dataset.reducedMotion = "true";
    const view = mount();
    view.move("mouse");
    expect(view.calls.hover).toBe(0);
    view.cleanup();
  });

  it("falls back to the 2D ring when the canvas has no WebGL2", () => {
    const canvas = document.createElement("canvas");
    const pane = document.createElement("div");
    document.body.append(canvas, pane);
    const { energy, unmount } = mountGlyphEnergy(canvas, pane);
    expect(energy).toBeNull();
    unmount();
    canvas.remove();
    pane.remove();
  });
});

describe("Settings > Appearance row", () => {
  it("turns the field on and off for this person, persisted", () => {
    act(() => root.render(createElement(GlyphRippleRow)));
    const toggle = host.querySelector<HTMLButtonElement>("[role='switch'], button[aria-checked]");
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute("aria-checked")).toBe("false");
    act(() => toggle!.click());
    expect(localStorage.getItem(GLYPH_RIPPLE_KEY)).toBe("1");
    expect(toggle!.getAttribute("aria-checked")).toBe("true");
    act(() => toggle!.click());
    expect(localStorage.getItem(GLYPH_RIPPLE_KEY)).toBe("0");
  });
});
