import { describe, expect, it } from "vitest";
import {
  AFTERGLOW_MS,
  EnergyField,
  MAX_WAVES,
  WAVE_MS,
  WAVE_REACH,
  quietMap,
  saturate,
  waveAt,
  waveEnvelope,
  type EnergyColors,
  type EnergyFrame,
  type EnergyGrid,
  type EnergyRenderer,
} from "./glyph-energy";

const COLORS: EnergyColors = {
  ink: { r: 1, g: 1, b: 1 },
  tint: { r: 0.3, g: 0.55, b: 1 },
  hot: { r: 0.6, g: 0.75, b: 1 },
  scheme: "dark",
};

function harness(options: { quiet?: Array<{ left: number; top: number; right: number; bottom: number }> } = {}) {
  let time = 1000;
  const frames: Array<() => void> = [];
  const draws: Array<Pick<EnergyFrame, "count" | "live"> & { hover: number }> = [];
  const quiets: Uint8Array[] = [];
  const grids: EnergyGrid[] = [];
  let rectCalls = 0;
  let quietCalls = 0;
  const renderer: EnergyRenderer = {
    resize: (grid) => void grids.push(grid),
    setColors: () => {},
    setQuiet: (map) => void quiets.push(map.slice()),
    draw: (frame) => void draws.push({ count: frame.count, live: frame.live, hover: frame.hover[2] }),
    destroy: () => {},
  };
  const field = new EnergyField({
    renderer,
    rect: () => {
      rectCalls += 1;
      return { left: 100, top: 50 };
    },
    now: () => time,
    requestFrame: (callback) => {
      frames.push(() => callback(time));
      return frames.length;
    },
    cancelFrame: () => {
      frames.length = 0;
    },
    quietRects: options.quiet
      ? () => {
          quietCalls += 1;
          return options.quiet!;
        }
      : undefined,
  });
  const step = (ms: number) => {
    time += ms;
    const pending = frames.splice(0);
    for (const run of pending) run();
    return pending.length;
  };
  const run = (ms: number, frame = 1000 / 120) => {
    let frames = 0;
    for (let t = 0; t < ms; t += frame) frames += step(frame);
    return frames;
  };
  return { field, draws, quiets, grids, step, run, pending: () => frames.length, rectCalls: () => rectCalls, quietCalls: () => quietCalls };
}

describe("glyph energy: the wave", () => {
  it("runs outward, slowing down, and reaches its reach at the end", () => {
    let last = -1;
    let lastStep = Infinity;
    for (let t = 0; t < WAVE_MS; t += 100) {
      const { radius } = waveAt(t);
      expect(radius).toBeGreaterThan(last);
      if (last >= 0) {
        expect(radius - last).toBeLessThanOrEqual(lastStep + 1e-9);
        lastStep = radius - last;
      }
      last = radius;
    }
    expect(waveAt(WAVE_MS - 1).radius).toBeGreaterThan(WAVE_REACH * 0.98);
  });

  it("decays exponentially and is gone at the end of its life", () => {
    expect(waveAt(0).amp).toBe(0);
    expect(waveAt(60).amp).toBeGreaterThan(0.85);
    expect(waveAt(600).amp).toBeLessThan(waveAt(300).amp);
    expect(waveAt(WAVE_MS - 5).amp).toBeLessThan(0.01);
    expect(waveAt(WAVE_MS).amp).toBe(0);
    expect(waveAt(-1).amp).toBe(0);
  });

  it("is brightest at the front, glows behind it brighter near the click, and is dark ahead of it", () => {
    const t = 500;
    const { radius, width } = waveAt(t);
    const front = waveEnvelope(radius, t);
    const center = waveEnvelope(0, t);
    const midway = waveEnvelope(radius * 0.6, t);
    const ahead = waveEnvelope(radius + 4 * width, t);
    expect(front).toBeGreaterThan(midway);
    expect(center).toBeGreaterThan(midway);
    expect(midway).toBeGreaterThan(0);
    expect(ahead).toBeLessThan(0.01);
  });

  it("saturates softly: two waves brighten a cell without clipping", () => {
    expect(saturate(0)).toBe(0);
    expect(saturate(0.5)).toBeLessThan(saturate(1));
    expect(saturate(1)).toBeLessThan(saturate(2));
    expect(saturate(10)).toBeLessThanOrEqual(1);
  });
});

describe("glyph energy: the frame loop", () => {
  it("draws the field at rest once on resize and runs nothing until a click", () => {
    const h = harness();
    h.field.setColors(COLORS);
    h.field.resize(1400, 900, 2);
    expect(h.grids[0]).toMatchObject({ cellPx: 28, cols: 50, rows: 33 });
    expect(h.draws).toEqual([{ count: 0, live: false, hover: 0 }]);
    expect(h.field.animating).toBe(false);
    expect(h.pending()).toBe(0);
  });

  it("runs frames only while a wave or its afterglow lives, then stops", () => {
    const h = harness();
    h.field.setColors(COLORS);
    h.field.resize(800, 600, 1);
    expect(h.field.wave(300, 200)).toBe(true);
    expect(h.field.animating).toBe(true);
    h.run(WAVE_MS - 20);
    expect(h.field.animating).toBe(true);
    h.run(AFTERGLOW_MS + 100);
    expect(h.field.animating).toBe(false);
    expect(h.draws.at(-1)?.live).toBe(false);
    // the field's box is read in a frame, once per new wave, never in the click
    expect(h.rectCalls()).toBe(1);
  });

  it("keeps at most MAX_WAVES waves: a new one replaces the oldest", () => {
    const h = harness();
    h.field.setColors(COLORS);
    h.field.resize(800, 600, 1);
    for (let k = 0; k < MAX_WAVES + 3; k += 1) h.field.wave(100 + k * 10, 100);
    expect(h.field.waveCount).toBe(MAX_WAVES);
    h.step(8);
    expect(h.draws.at(-1)?.count).toBe(MAX_WAVES);
  });

  it("cannot start before it has a size", () => {
    const h = harness();
    expect(h.field.wave(10, 10)).toBe(false);
    expect(h.field.animating).toBe(false);
  });

  it("the pointer glow eases in on a move, fades once the pointer rests, then stops", () => {
    const h = harness();
    h.field.setColors(COLORS);
    h.field.resize(800, 600, 1);
    h.field.hover(300, 300);
    h.run(60);
    const lit = h.draws.at(-1)!.hover;
    expect(lit).toBeGreaterThan(0.2);
    h.run(2000);
    expect(h.draws.at(-1)!.hover).toBe(0);
    expect(h.field.animating).toBe(false);
  });

  it("settle drops everything and draws the rest field (a hidden window)", () => {
    const h = harness();
    h.field.setColors(COLORS);
    h.field.resize(800, 600, 1);
    h.field.wave(300, 200);
    h.run(100);
    h.field.settle();
    expect(h.field.animating).toBe(false);
    expect(h.field.waveCount).toBe(0);
    expect(h.draws.at(-1)).toEqual({ count: 0, live: false, hover: 0 });
  });

  it("maps the text on screen when a wave starts, so lit glyphs stay low under it", () => {
    // a paragraph at client (130, 78)-(330, 106): canvas px (30, 28)-(230, 56)
    const h = harness({ quiet: [{ left: 130, top: 78, right: 330, bottom: 106 }] });
    h.field.setColors(COLORS);
    h.field.resize(280, 140, 1);
    expect(h.quietCalls()).toBe(0);
    h.field.wave(200, 100);
    h.step(8);
    expect(h.quietCalls()).toBe(1);
    const map = h.quiets[0];
    const cols = 20;
    // rows 2..3, cols 2..15 (14 px cells)
    expect(map[2 * cols + 2]).toBe(255);
    expect(map[3 * cols + 15]).toBe(255);
    expect(map[1 * cols + 5]).toBe(0);
    expect(map[4 * cols + 5]).toBe(0);
    expect(map[2 * cols + 17]).toBe(0);
    // no new map every frame
    h.step(8);
    expect(h.quietCalls()).toBe(1);
  });
});

describe("glyph energy: the quiet map", () => {
  it("covers the cells a rect mostly overlaps and clips to the grid", () => {
    const map = quietMap([{ left: -50, top: 7, right: 21, bottom: 400 }], 4, 3, 14);
    expect(Array.from(map)).toEqual([0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0]);
  });
});
