// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLICK_LIFE } from "./background-shaders";
import { BATTERY_PIXEL_SHARE, FRAME_MS, LINGER_MS, MAX_PIXELS, REST_TIME, setBatterySaverForTests, ShaderField, shaderGrid, type ShaderFrame, type ShaderRenderer } from "./background-engine";
import { mountGlyphField, startsRipple, type GlyphEngine } from "./glyph-ripple";

function harness(boost = 0) {
  let now = 1000;
  let queued: ((time: number) => void) | null = null;
  const draws: Array<Pick<ShaderFrame, "time" | "count" | "live"> & { presence: number }> = [];
  const renderer: ShaderRenderer = {
    resize: vi.fn(),
    setLook: vi.fn(),
    setQuiet: vi.fn(),
    draw: (frame) => draws.push({ time: frame.time, count: frame.count, live: frame.live, presence: frame.pointer[2] }),
    destroy: vi.fn(),
  };
  const field = new ShaderField({
    renderer,
    boost,
    rect: () => ({ left: 0, top: 0 }),
    now: () => now,
    requestFrame: (callback) => {
      queued = callback;
      return 1;
    },
    cancelFrame: () => {
      queued = null;
    },
    quietRects: () => [{ left: 0, top: 0, right: 100, bottom: 20 }],
  });
  const step = (ms: number) => {
    now += ms;
    const callback = queued;
    queued = null;
    callback?.(now);
  };
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 17) step(17);
  };
  return { field, renderer, draws, step, run, pending: () => queued !== null };
}

describe("shaderGrid", () => {
  it("draws at CSS resolution at most and under the pixel budget", () => {
    expect(shaderGrid(800, 600)).toMatchObject({ width: 800, height: 600, scale: 1 });
    const big = shaderGrid(3000, 2000);
    expect(big.width * big.height).toBeLessThanOrEqual(MAX_PIXELS * 1.01);
    expect(big.scale).toBeLessThan(1);
    expect(big.cols).toBe(Math.ceil(3000 / 14));
  });
});

describe("ShaderField", () => {
  afterEach(() => vi.restoreAllMocks());

  it("draws one still frame at rest and runs nothing", () => {
    const h = harness();
    h.field.resize(800, 600);
    expect(h.draws).toHaveLength(1);
    expect(h.draws[0]).toMatchObject({ time: REST_TIME, count: 0, live: 0 });
    expect(h.pending()).toBe(false);
  });

  it("runs while a click lives, then eases to a stop and keeps the last frame", () => {
    const h = harness();
    h.field.resize(800, 600);
    expect(h.field.click(100, 100)).toBe(true);
    expect(h.pending()).toBe(true);
    h.run(300);
    expect(h.draws.at(-1)!.count).toBe(1);
    expect(h.draws.at(-1)!.time).toBeGreaterThan(REST_TIME);
    expect(h.renderer.setQuiet).toHaveBeenCalled();
    h.run(CLICK_LIFE * 1000 + 6000);
    expect(h.pending()).toBe(false);
    const frozen = h.draws.at(-1)!.time;
    expect(h.draws.at(-1)!.count).toBe(0);
    h.run(500);
    expect(h.draws.at(-1)!.time).toBe(frozen);
  });

  it("keeps running while the pointer moves and stops after it rests", () => {
    const h = harness();
    h.field.resize(800, 600);
    for (let k = 0; k < 20; k += 1) {
      h.field.hover(100 + k * 5, 100);
      h.step(17);
    }
    expect(h.draws.at(-1)!.presence).toBeGreaterThan(0.5);
    h.run(LINGER_MS + 6000);
    expect(h.pending()).toBe(false);
    expect(h.draws.at(-1)!.presence).toBe(0);
  });

  it("never draws faster than 60 frames a second", () => {
    const h = harness();
    h.field.resize(800, 600);
    h.field.click(10, 10);
    const before = h.draws.length;
    for (let k = 0; k < 120; k += 1) h.step(8.33); // a 120 Hz display, one second
    expect(h.draws.length - before).toBeLessThanOrEqual(62);
    expect(FRAME_MS).toBeLessThan(17);
  });

  it("on battery: half the pixels and 30 frames a second", () => {
    setBatterySaverForTests(true);
    try {
      const h = harness();
      const grid = h.field.resize(3000, 2000);
      expect(grid.width * grid.height).toBeLessThanOrEqual(MAX_PIXELS * BATTERY_PIXEL_SHARE * 1.01);
      h.field.click(10, 10);
      const before = h.draws.length;
      for (let k = 0; k < 60; k += 1) h.step(16.67);
      expect(h.draws.length - before).toBeLessThanOrEqual(32);
    } finally {
      setBatterySaverForTests(false);
    }
  });

  it("speeds its clock up for a click when the effect asks (the warp)", () => {
    const slow = harness(0);
    const fast = harness(7);
    for (const h of [slow, fast]) {
      h.field.resize(800, 600);
      h.field.click(10, 10);
      h.run(600);
    }
    expect(fast.draws.at(-1)!.time - REST_TIME).toBeGreaterThan(2 * (slow.draws.at(-1)!.time - REST_TIME));
  });

  it("settles at once: no click, no loop, a still frame", () => {
    const h = harness();
    h.field.resize(800, 600);
    h.field.click(10, 10);
    h.run(100);
    h.field.settle();
    expect(h.pending()).toBe(false);
    expect(h.draws.at(-1)).toMatchObject({ count: 0, live: 0 });
    expect(h.field.clickCount).toBe(0);
  });

  it("caps the clicks alive at six", () => {
    const h = harness();
    h.field.resize(800, 600);
    for (let k = 0; k < 9; k += 1) h.field.click(k, k);
    expect(h.field.clickCount).toBe(6);
  });
});

describe("the shared wiring (mountGlyphField)", () => {
  function engine() {
    const calls = { ripple: 0, hover: 0, settle: 0 };
    const e: GlyphEngine = {
      setColors: () => {},
      resize: () => {},
      ripple: () => {
        calls.ripple += 1;
        return true;
      },
      hover: () => void (calls.hover += 1),
      leave: () => {},
      settle: () => void (calls.settle += 1),
      destroy: () => {},
    };
    return { e, calls };
  }
  const down = (target: Element) => target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, isPrimary: true, pointerType: "mouse", clientX: 5, clientY: 5 }));

  afterEach(() => {
    delete document.documentElement.dataset.reducedMotion;
    document.body.innerHTML = "";
  });

  it("does nothing with reduced motion: no click, no pointer", () => {
    document.documentElement.dataset.reducedMotion = "true";
    const canvas = document.createElement("canvas");
    const pane = document.createElement("div");
    const text = document.createElement("p");
    pane.append(text);
    document.body.append(canvas, pane);
    const { e, calls } = engine();
    const { unmount } = mountGlyphField(canvas, pane, e);
    down(text);
    text.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
    expect(calls).toMatchObject({ ripple: 0, hover: 0 });
    unmount();
  });

  it("settles when the window loses focus", () => {
    const canvas = document.createElement("canvas");
    const pane = document.createElement("div");
    document.body.append(canvas, pane);
    const { e, calls } = engine();
    const { unmount } = mountGlyphField(canvas, pane, e);
    window.dispatchEvent(new Event("blur"));
    expect(calls.settle).toBe(1);
    unmount();
    window.dispatchEvent(new Event("blur"));
    expect(calls.settle).toBe(1);
  });

  it("lets the Settings preview take clicks inside its dialog, but never a menu inside the pane", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const pane = document.createElement("div");
    const text = document.createElement("p");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    pane.append(text, menu);
    dialog.append(pane);
    document.body.append(dialog);
    const env = { reducedMotion: false, hidden: false, pane };
    expect(startsRipple({ button: 0, pointerType: "mouse", target: text }, env)).toBe(true);
    expect(startsRipple({ button: 0, pointerType: "mouse", target: menu }, env)).toBe(false);
    // without the pane, the dialog still fences (the conversation's rule)
    expect(startsRipple({ button: 0, pointerType: "mouse", target: text }, { reducedMotion: false, hidden: false })).toBe(false);
  });
});
