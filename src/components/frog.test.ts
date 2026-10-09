// Frog, the smug sad frog (direction C, "aplat net"): its drawing as data,
// its sixteen faces carried by the lids and the lips, the skin for every bot
// color and the bust crop.
import { describe, expect, it } from "vitest";
import { contrastRatio, MASCOT_COLOR_HEX } from "../../shared/mascot-colors";
import { SHAPE_EXPRESSIONS } from "./shape-engine";
import {
  FROG_ART,
  FROG_BUST_MAX,
  FROG_EXPRESSIONS,
  FROG_FACES,
  FROG_GREEN,
  FROG_MOOD_EXPRESSION,
  FROG_MOUTHS,
  FROG_ROLES,
  frogEyeOps,
  frogFlyOps,
  frogLegOps,
  frogMouthOps,
  frogOutline,
  frogPadOps,
  frogPalette,
  frogParts,
  frogSkin,
  frogStillSvg,
  frogThroatOps,
  frogTongueOps,
  frogViewBox,
  frogWaterOps,
  SKIN_MIN_CONTRAST,
  tintTone,
  toHsl,
  type FrogOp,
} from "./frog-art";

const ABSOLUTE = /^[MLCQZ0-9.\s-]+$/;
const pathsOf = (ops: readonly FrogOp[]) => ops.flatMap((op) => [op.d, ...(op.clip ? [op.clip] : [])]);

describe("Frog's art", () => {
  it("names its sixteen faces like the Shapes, and its five moods among them", () => {
    expect([...FROG_EXPRESSIONS]).toEqual([...SHAPE_EXPRESSIONS]);
    expect(FROG_MOOD_EXPRESSION).toEqual({ idle: "neutral", happy: "happy", thinking: "curious", alert: "surprised", sleepy: "sleepy" });
    expect(Object.keys(FROG_FACES).sort()).toEqual([...FROG_EXPRESSIONS].sort());
  });

  it("carries every face on the lids and the lips: no brows, no nose, two eyes and a mouth", () => {
    for (const expression of FROG_EXPRESSIONS) {
      const parts = frogParts({ expression, size: 120 });
      expect(parts.brows, expression).toEqual([]);
      expect(parts.nose, expression).toEqual([]);
      expect(parts.eyeL.length, expression).toBeGreaterThan(0);
      expect(parts.eyeR.length, expression).toBeGreaterThan(0);
      // the lips, their shade and their outline at least
      expect(parts.mouth.length, expression).toBeGreaterThanOrEqual(3);
    }
    const faces = new Set(FROG_EXPRESSIONS.map((expression) => frogStillSvg({ expression, size: 120 })));
    expect(faces.size).toBe(FROG_EXPRESSIONS.length);
    // the approved idle: heavy lids at half, the gaze aside
    const idle = FROG_FACES.neutral.eyes[0];
    expect(idle.kind === "open" && idle.lid).toBe(0.5);
  });

  it("keeps every path absolute (M L C Q Z only), so it moves, mirrors and parses on the phone", () => {
    for (const expression of FROG_EXPRESSIONS) {
      const parts = frogParts({ expression, size: 200, blink: [0.5, 1] });
      for (const d of Object.values(parts).flatMap(pathsOf)) expect(d, expression).toMatch(ABSOLUTE);
    }
    for (const mouth of FROG_MOUTHS) for (const d of pathsOf(frogMouthOps(mouth, 2))) expect(d, mouth).toMatch(ABSOLUTE);
    const moving = [...frogThroatOps(1.2, 2), ...frogTongueOps([90, 30], 0.7, 2), ...frogFlyOps([90, 30], 0.5, 2), ...frogLegOps(-1, 1, 2), ...frogLegOps(1, 0.5, 2), ...frogPadOps(2), ...frogWaterOps(67, 1.3, 2)];
    for (const d of pathsOf(moving)) expect(d).toMatch(ABSOLUTE);
  });

  it("closes one lid at a time for a blink, and draws nothing for a part at rest", () => {
    const lidLine = (ops: FrogOp[]) => ops.find((op) => op.stroke === "lidLine")?.d;
    const half = frogEyeOps(FROG_FACES.neutral.eyes[0], -1, 2, 0);
    const shut = frogEyeOps(FROG_FACES.neutral.eyes[0], -1, 2, 1);
    expect(lidLine(half)).not.toBe(lidLine(shut));
    // a wide-open eye grows a lid only when it blinks
    expect(lidLine(frogEyeOps(FROG_FACES.surprised.eyes[0], 1, 2, 0))).toBeUndefined();
    expect(lidLine(frogEyeOps(FROG_FACES.surprised.eyes[0], 1, 2, 0.6))).toBeDefined();
    expect(frogThroatOps(0, 2)).toEqual([]);
    expect(frogTongueOps([90, 30], 0, 2)).toEqual([]);
    expect(frogLegOps(1, 0, 2)).toEqual([]);
    expect(frogWaterOps(100, 0, 2)).toEqual([]);
  });

  it("crops to the bust under 48 px and leaves the sleeping z out", () => {
    expect(frogViewBox(32)).toBe("11 14 78 78");
    expect(frogViewBox(FROG_BUST_MAX)).toBe("11 14 78 78");
    expect(frogViewBox(49)).toBe("0 0 100 100");
    expect(frogParts({ expression: "sleepy", size: 32 }).extras).toEqual([]);
    expect(frogParts({ expression: "sleepy", size: 96 }).extras.length).toBeGreaterThan(0);
  });

  it("keeps one outline width, never under 1.6 screen px", () => {
    for (const size of [16, 24, 32, 44, 48, 64, 96, 240]) {
      const ow = frogOutline(size);
      const box = size <= FROG_BUST_MAX ? 78 : 100;
      expect((ow * size) / box, String(size)).toBeGreaterThanOrEqual(1.6 - 0.01);
      expect(ow).toBeGreaterThanOrEqual(1.9);
    }
    expect(frogOutline(240)).toBe(1.9);
  });

  it("takes 24 % of the bot color and stays a frog green-ish, saturated, with a readable belly", () => {
    expect(frogPalette().skin).toBe(FROG_GREEN);
    expect(frogSkin(null)).toBe(FROG_GREEN);
    const baseSat = toHsl(FROG_GREEN)[1];
    for (const [name, hex] of Object.entries(MASCOT_COLOR_HEX)) {
      const palette = frogPalette(hex);
      expect(contrastRatio(palette.skin, palette.belly), name).toBeGreaterThanOrEqual(SKIN_MIN_CONTRAST);
      // a grey, a white or a black bot never turns the frog grey
      expect(toHsl(palette.skin)[1], name).toBeGreaterThan(baseSat * 0.6);
      // the skin moves toward the bot color, it never becomes it
      expect(palette.skin.toLowerCase(), name).not.toBe(hex.toLowerCase());
    }
    // a blue bot gives a bluer green, an orange one a yellower green
    const hue = (hex: string) => toHsl(tintTone(FROG_GREEN, hex, 0.24))[0];
    const base = toHsl(FROG_GREEN)[0];
    expect(hue("#3F7FD6")).toBeGreaterThan(base);
    expect(hue("#E78531")).toBeLessThan(base);
  });

  it("paints every role a palette defines", () => {
    const palette = frogPalette("#377FE6");
    expect(Object.keys(palette).sort()).toEqual([...FROG_ROLES].sort());
    const parts = frogParts({ expression: "laughing", size: 200 });
    const all = [...(Object.values(parts) as FrogOp[][]).flat(), ...frogThroatOps(1, 2), ...frogTongueOps([80, 20], 1, 2), ...frogFlyOps([80, 20], 0, 2), ...frogLegOps(-1, 1, 2), ...frogPadOps(2), ...frogWaterOps(70, 0, 2)];
    for (const op of all) {
      if (op.fill) expect(palette[op.fill], op.fill).toMatch(/^#[0-9a-fA-F]{6}$/);
      if (op.stroke) expect(palette[op.stroke], op.stroke).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    expect(FROG_ART.eye.r).toBe(8.4);
  });
});
