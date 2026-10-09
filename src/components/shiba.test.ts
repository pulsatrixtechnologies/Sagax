// Shiba, the dog (direction C, "aplat net"): its drawing as data, its sixteen
// faces, the coat for every bot color and the bust crop.
import { describe, expect, it } from "vitest";
import { contrastRatio, MASCOT_COLOR_HEX } from "../../shared/mascot-colors";
import { SHAPE_EXPRESSIONS } from "./shape-engine";
import {
  COAT_MIN_CONTRAST,
  ellipsePath,
  mirrorPath,
  mixColor,
  MOUTHS,
  mouthOps,
  SHIBA_ART,
  SHIBA_BUST_MAX,
  SHIBA_EXPRESSIONS,
  SHIBA_FACES,
  SHIBA_MOOD_EXPRESSION,
  shibaCoat,
  shibaOutline,
  shibaPalette,
  shibaParts,
  shibaStillSvg,
  shibaViewBox,
  type ShibaOp,
} from "./shiba-art";

const ABSOLUTE = /^[MLCQZ0-9.\s-]+$/;
const pathsOf = (ops: readonly ShibaOp[]) => ops.flatMap((op) => [op.d, ...(op.clip ? [op.clip] : [])]);

describe("Shiba's art", () => {
  it("names its sixteen faces like the Shapes, and its five v3 moods among them", () => {
    expect([...SHIBA_EXPRESSIONS]).toEqual([...SHAPE_EXPRESSIONS]);
    expect(SHIBA_MOOD_EXPRESSION).toEqual({ idle: "neutral", happy: "happy", thinking: "curious", alert: "surprised", sleepy: "sleepy" });
    expect(Object.keys(SHIBA_FACES).sort()).toEqual([...SHIBA_EXPRESSIONS].sort());
  });

  it("draws every face with its three layers: two eyes, two brow spots and a mouth", () => {
    for (const expression of SHIBA_EXPRESSIONS) {
      const parts = shibaParts({ expression, size: 120 });
      expect(parts.eyeL.length, expression).toBeGreaterThan(0);
      expect(parts.eyeR.length, expression).toBeGreaterThan(0);
      expect(parts.brows, expression).toHaveLength(2);
      // the line under the nose, then the mouth itself
      expect(parts.mouth.length, expression).toBeGreaterThanOrEqual(2);
      expect(parts.nose.length).toBe(2);
    }
    // the faces differ from one another
    const faces = new Set(SHIBA_EXPRESSIONS.map((expression) => shibaStillSvg({ color: "#E78531", expression, size: 120 })));
    expect(faces.size).toBe(SHIBA_EXPRESSIONS.length);
  });

  it("keeps every path absolute (M L C Q Z only), so it moves, mirrors and parses on the phone", () => {
    for (const stance of ["sit", "stand", "lie"] as const) {
      for (const expression of SHIBA_EXPRESSIONS) {
        const parts = shibaParts({ expression, size: 200, stance });
        for (const d of Object.values(parts).flatMap(pathsOf)) expect(d, `${stance} ${expression}`).toMatch(ABSOLUTE);
      }
    }
    for (const mouth of MOUTHS) for (const d of pathsOf(mouthOps(mouth, 2))) expect(d).toMatch(ABSOLUTE);
  });

  it("mirrors the right ear from the left one", () => {
    expect(SHIBA_ART.earR).toBe(mirrorPath(SHIBA_ART.earL));
    expect(mirrorPath(SHIBA_ART.earR)).toBe(SHIBA_ART.earL);
    expect(ellipsePath(50, 50, 4, 2)).toMatch(/^M54 50C/);
  });

  it("crops to the bust under 48 px and leaves the tail out", () => {
    expect(shibaViewBox(32)).toBe("16 12 68 68");
    expect(shibaViewBox(SHIBA_BUST_MAX)).toBe("16 12 68 68");
    expect(shibaViewBox(49)).toBe("0 0 100 100");
    expect(shibaParts({ expression: "neutral", size: 32 }).tail).toEqual([]);
    expect(shibaParts({ expression: "neutral", size: 96 }).tail.length).toBeGreaterThan(0);
    // the sleeping z stays out of the crop
    expect(shibaParts({ expression: "sleepy", size: 32 }).extras).toEqual([]);
  });

  it("keeps one outline width, never under 1.6 screen px", () => {
    for (const size of [16, 24, 32, 44, 48, 64, 96, 240]) {
      const ow = shibaOutline(size);
      const box = size <= SHIBA_BUST_MAX ? 68 : 100;
      expect((ow * size) / box, String(size)).toBeGreaterThanOrEqual(1.6 - 0.01);
      expect(ow).toBeGreaterThanOrEqual(1.9);
    }
    expect(shibaOutline(240)).toBe(1.9);
  });

  it("wears the bot color, darkening a light one just enough for the cream mask to read", () => {
    expect(shibaCoat("#E78531")).toBe("#E78531");
    for (const [name, hex] of Object.entries(MASCOT_COLOR_HEX)) {
      const palette = shibaPalette(hex);
      expect(contrastRatio(palette.coat, palette.cream), name).toBeGreaterThanOrEqual(COAT_MIN_CONTRAST);
    }
    // white turns a light grey, never a different hue; a dark color stays itself
    const white = shibaCoat(MASCOT_COLOR_HEX.white);
    expect(white).not.toBe(MASCOT_COLOR_HEX.white);
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(white.slice(i, i + 2), 16));
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(shibaCoat(MASCOT_COLOR_HEX.black)).toBe(MASCOT_COLOR_HEX.black);
    expect(shibaCoat(MASCOT_COLOR_HEX.butter)).not.toBe(MASCOT_COLOR_HEX.butter);
    expect(mixColor("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("paints every role a palette defines", () => {
    const palette = shibaPalette("#377FE6");
    for (const stance of ["sit", "stand", "lie"] as const) {
      const parts = shibaParts({ expression: "laughing", size: 200, stance });
      for (const op of (Object.values(parts) as ShibaOp[][]).flat()) {
        if (op.fill) expect(palette[op.fill], op.fill).toMatch(/^#[0-9a-fA-F]{6}$/);
        if (op.stroke) expect(palette[op.stroke], op.stroke).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});
