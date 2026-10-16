import { describe, expect, it } from "vitest";
import { GLYPHS, GlyphField, LEVELS, MAX_RIPPLES, RIPPLE_MS, restCell, ringIntensity, startsRipple, type GlyphColors, type GlyphContext } from "./glyph-ripple";

const COLORS: GlyphColors = { ink: "rgb(252, 252, 252)", tint: "rgb(77, 141, 255)", scheme: "dark" };

function fakeContext() {
  const calls = { clear: 0, draw: 0, alphas: [] as number[], sourceRows: [] as number[] };
  const context: GlyphContext = {
    globalAlpha: 1,
    clearRect: () => {
      calls.clear += 1;
    },
    drawImage(_image, _sx, sy) {
      calls.draw += 1;
      calls.alphas.push(this.globalAlpha);
      calls.sourceRows.push(sy);
    },
  };
  return { context, calls };
}

function harness() {
  let time = 0;
  const frames: Array<() => void> = [];
  const { context, calls } = fakeContext();
  let atlases = 0;
  const field = new GlyphField({
    context,
    atlas: () => {
      atlases += 1;
      return {} as CanvasImageSource;
    },
    rect: () => ({ left: 100, top: 50 }),
    now: () => time,
    requestFrame: (callback) => {
      frames.push(() => callback(time));
      return frames.length;
    },
    cancelFrame: () => {
      frames.length = 0;
    },
  });
  const step = (ms: number) => {
    time += ms;
    const pending = frames.splice(0);
    for (const run of pending) run();
    return pending.length;
  };
  return { field, calls, step, pendingFrames: () => frames.length, atlases: () => atlases };
}

describe("glyph field: the rest state", () => {
  it("draws islands of characters with blank water between, the same at every size", () => {
    let blank = 0;
    let total = 0;
    for (let row = 0; row < 60; row += 1) {
      for (let col = 0; col < 90; col += 1) {
        const cell = restCell(col, row);
        expect(cell.glyph).toBeGreaterThanOrEqual(0);
        expect(cell.glyph).toBeLessThan(GLYPHS.length);
        expect(cell.alpha).toBeGreaterThanOrEqual(0);
        expect(cell.alpha).toBeLessThanOrEqual(1);
        total += 1;
        if (cell.alpha === 0) blank += 1;
      }
    }
    // islands, not a uniform carpet and not empty
    expect(blank / total).toBeGreaterThan(0.35);
    expect(blank / total).toBeLessThan(0.9);
    expect(restCell(12, 7)).toEqual(restCell(12, 7));
  });

  it("paints the rest field once at mount and not again while idle", () => {
    const { field, calls, step, pendingFrames, atlases } = harness();
    field.setColors(COLORS);
    field.resize(1400, 900, 2);
    expect(atlases()).toBe(1);
    expect(calls.draw).toBeGreaterThan(0);
    // every rest glyph comes from the ink row, at the faint rest level
    expect(calls.sourceRows.every((row) => row === 0)).toBe(true);
    expect(Math.max(...calls.alphas)).toBeLessThanOrEqual(LEVELS.dark.rest + 1e-6);
    const drawn = calls.draw;
    expect(pendingFrames()).toBe(0);
    expect(step(1000)).toBe(0);
    expect(calls.draw).toBe(drawn);
    expect(field.animating).toBe(false);
  });

  it("only rebuilds on a real colour change (a skin switch)", () => {
    const { field, calls, atlases } = harness();
    field.setColors(COLORS);
    field.resize(700, 500, 1);
    const drawn = calls.draw;
    expect(field.setColors({ ...COLORS })).toBe(false);
    expect(calls.draw).toBe(drawn);
    expect(field.setColors({ ink: "rgb(11, 21, 38)", tint: "rgb(47, 98, 221)", scheme: "light" })).toBe(true);
    expect(atlases()).toBe(2);
    expect(calls.draw).toBeGreaterThan(drawn);
  });
});

describe("glyph field: a ring", () => {
  it("is strongest on its band, fades with time and is gone at the end", () => {
    expect(ringIntensity(0, 0)).toBeGreaterThan(0.5);
    expect(ringIntensity(400, 0)).toBe(0);
    expect(ringIntensity(0, RIPPLE_MS)).toBe(0);
    const early = Math.max(...Array.from({ length: 600 }, (_, d) => ringIntensity(d, 150)));
    const late = Math.max(...Array.from({ length: 600 }, (_, d) => ringIntensity(d, 800)));
    expect(late).toBeLessThan(early);
  });

  it("animates only while alive, then puts every lit cell back and stops", () => {
    const { field, calls, step, pendingFrames } = harness();
    field.setColors(COLORS);
    field.resize(1400, 900, 1);
    expect(field.ripple(500, 300)).toBe(true);
    expect(field.animating).toBe(true);
    let frames = 0;
    while (pendingFrames() > 0 && frames < 500) {
      calls.sourceRows.length = 0;
      step(16);
      frames += 1;
    }
    // about RIPPLE_MS / 16 frames, then nothing scheduled
    expect(frames).toBeGreaterThan(40);
    expect(frames).toBeLessThan(RIPPLE_MS / 16 + 4);
    expect(field.animating).toBe(false);
    expect(field.frames).toBe(frames);
    // the last frame only restored cells: no tint left on screen
    expect(calls.sourceRows.includes(14)).toBe(false);
  });

  it("touches the ring's cells only, never the whole field", () => {
    const { field, calls, step } = harness();
    field.setColors(COLORS);
    field.resize(2800, 1800, 2);
    const cells = field.size.cols * field.size.rows;
    field.ripple(800, 500);
    let worst = 0;
    for (let k = 0; k < 70; k += 1) {
      const before = calls.draw + calls.clear;
      step(16);
      worst = Math.max(worst, calls.draw + calls.clear - before);
    }
    // a frame is a fraction of a full repaint
    expect(worst).toBeLessThan(cells * 1.2);
    expect(worst).toBeGreaterThan(0);
  });

  it("keeps at most three rings: a fourth click replaces the oldest", () => {
    const { field, step } = harness();
    field.setColors(COLORS);
    field.resize(1400, 900, 1);
    for (let k = 0; k < 6; k += 1) {
      field.ripple(200 + k * 40, 300);
      step(5);
    }
    expect(field.rippleCount).toBe(MAX_RIPPLES);
  });

  it("settles at once when the window hides", () => {
    const { field, step, pendingFrames } = harness();
    field.setColors(COLORS);
    field.resize(1400, 900, 1);
    field.ripple(500, 300);
    step(16);
    step(16);
    field.settle();
    expect(field.animating).toBe(false);
    expect(field.rippleCount).toBe(0);
    expect(pendingFrames()).toBe(0);
  });

  it("does nothing before it has a size and colours", () => {
    const { field, pendingFrames } = harness();
    expect(field.ripple(10, 10)).toBe(false);
    expect(pendingFrames()).toBe(0);
  });
});

describe("glyph field: which clicks start a ring", () => {
  const env = { reducedMotion: false, hidden: false };
  const target = (inside: string | null) => ({ closest: (selector: string) => (inside && selector.includes(inside) ? {} : null) }) as unknown as EventTarget;

  it("a main-button mouse or pen click on a message or empty space", () => {
    expect(startsRipple({ button: 0, isPrimary: true, pointerType: "mouse", target: target(null) }, env)).toBe(true);
    expect(startsRipple({ button: 0, isPrimary: true, pointerType: "pen", target: target(null) }, env)).toBe(true);
  });

  it("never with reduced motion (system or the app's switch) or in a hidden window", () => {
    const click = { button: 0, pointerType: "mouse", target: target(null) };
    expect(startsRipple(click, { reducedMotion: true, hidden: false })).toBe(false);
    expect(startsRipple(click, { reducedMotion: false, hidden: true })).toBe(false);
  });

  it("never for touch, a secondary button or a second pointer", () => {
    expect(startsRipple({ button: 0, pointerType: "touch", target: target(null) }, env)).toBe(false);
    expect(startsRipple({ button: 2, pointerType: "mouse", target: target(null) }, env)).toBe(false);
    expect(startsRipple({ button: 0, isPrimary: false, pointerType: "mouse", target: target(null) }, env)).toBe(false);
  });

  it("never in a field, an edited message, a menu or a dialog", () => {
    for (const inside of ["textarea", "input", "contenteditable", "role='menu'", "role='menuitem'", "role='dialog'", "data-no-glyph-ripple"]) {
      expect(startsRipple({ button: 0, pointerType: "mouse", target: target(inside) }, env)).toBe(false);
    }
  });
});
