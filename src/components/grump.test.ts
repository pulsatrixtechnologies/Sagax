// Grump, the grumpy cat (direction C, "aplat net"): its drawing as data, its
// sixteen faces, the markings for every bot color, the stances and the bust.
import { describe, expect, it } from "vitest";
import { contrastRatio, MASCOT_COLOR_HEX } from "../../shared/mascot-colors";
import { SHAPE_EXPRESSIONS } from "./shape-engine";
import {
  GRUMP_ART,
  GRUMP_BUST_MAX,
  GRUMP_EXPRESSIONS,
  GRUMP_FACES,
  GRUMP_MOOD_EXPRESSION,
  GRUMP_MOUTHS,
  GRUMP_ORDER,
  GRUMP_STANCES,
  GRUMP_TAIL,
  MASK_MIN_CONTRAST,
  TAIL_JOINTS,
  grumpMask,
  grumpMouthOps,
  grumpOutline,
  grumpPalette,
  grumpParts,
  grumpStillSvg,
  grumpViewBox,
  GRUMP_GROUND,
  GRUMP_HIPS,
  GRUMP_LEG,
  GRUMP_LEGS,
  legIK,
  mirrorPath,
  rotatePath,
  tailPoints,
  type GrumpOp,
} from "./grump-art";

const ABSOLUTE = /^[MLCQZ0-9.\s-]+$/;
const pathsOf = (ops: readonly GrumpOp[]) => ops.flatMap((op) => [op.d, ...(op.clip ? [op.clip] : [])]);

describe("Grump's art", () => {
  it("names its sixteen faces like the Shapes, and its five approved moods among them", () => {
    expect([...GRUMP_EXPRESSIONS]).toEqual([...SHAPE_EXPRESSIONS]);
    expect(GRUMP_MOOD_EXPRESSION).toEqual({ idle: "neutral", happy: "happy", thinking: "curious", alert: "surprised", sleepy: "sleepy" });
    expect(Object.keys(GRUMP_FACES).sort()).toEqual([...GRUMP_EXPRESSIONS].sort());
  });

  it("draws every face with its three layers: two eyes, two brow capsules and a mouth", () => {
    for (const expression of GRUMP_EXPRESSIONS) {
      const parts = grumpParts({ expression, size: 120 });
      expect(parts.eyeL.length, expression).toBeGreaterThan(0);
      expect(parts.eyeR.length, expression).toBeGreaterThan(0);
      expect(parts.brows, expression).toHaveLength(2);
      expect(parts.mouth.length, expression).toBeGreaterThanOrEqual(2);
      expect(parts.nose.length).toBe(2);
    }
    const faces = new Set(GRUMP_EXPRESSIONS.map((expression) => grumpStillSvg({ color: "#8B5E3C", expression, size: 120 })));
    expect(faces.size).toBe(GRUMP_EXPRESSIONS.length);
  });

  it("is grumpy at rest: half lids and the deep arc", () => {
    const rest = GRUMP_FACES.neutral;
    expect(rest.mouth).toBe("grump");
    expect(rest.eyes[0].kind === "open" && rest.eyes[0].lid).toBeGreaterThan(0.3);
  });

  it("keeps every path absolute (M L C Q Z only), so it moves, mirrors and parses on the phone", () => {
    for (const stance of GRUMP_STANCES) {
      for (const expression of GRUMP_EXPRESSIONS) {
        const parts = grumpParts({ expression, size: 200, stance, tailBend: [10, -10, 20, -20], blink: 0.5, look: [1, -1] });
        for (const d of Object.values(parts).flatMap(pathsOf)) expect(d, `${stance} ${expression}`).toMatch(ABSOLUTE);
      }
    }
    for (const mouth of GRUMP_MOUTHS) for (const d of pathsOf(grumpMouthOps(mouth, 2))) expect(d, mouth).toMatch(ABSOLUTE);
  });

  it("mirrors the right ear from the left one and turns paths about a point", () => {
    expect(GRUMP_ART.earR).toBe(mirrorPath(GRUMP_ART.earL));
    expect(rotatePath("M60 50L50 50", 90, 50, 50)).toBe("M50 60L50 50");
    expect(rotatePath("M1 2", 0, 0, 0)).toBe("M1 2");
  });

  it("bends the tail joint by joint and keeps its segment lengths", () => {
    for (const stance of GRUMP_STANCES) {
      expect(GRUMP_TAIL[stance]).toHaveLength(TAIL_JOINTS + 1);
      const rest = tailPoints(stance);
      const bent = tailPoints(stance, [20, 20, 20, 20]);
      expect(bent[0]).toEqual(rest[0]);
      for (let i = 1; i < rest.length; i += 1) {
        const a = Math.hypot(rest[i][0] - rest[i - 1][0], rest[i][1] - rest[i - 1][1]);
        const b = Math.hypot(bent[i][0] - bent[i - 1][0], bent[i][1] - bent[i - 1][1]);
        expect(b).toBeCloseTo(a, 5);
      }
      expect(bent.at(-1)).not.toEqual(rest.at(-1));
    }
  });

  it("stands its legs on the ground and bends them the way a cat's bend", () => {
    for (const leg of GRUMP_LEGS) {
      const rest = legIK(leg, 0, 0);
      expect(rest.paw[1]).toBeCloseTo(GRUMP_GROUND, 0);
      // a lifted paw comes up, its segments keep their lengths
      const up = legIK(leg, 2, 4);
      expect(up.paw[1]).toBeCloseTo(GRUMP_GROUND - 4, 1);
      expect(Math.hypot(up.knee[0] - up.hip[0], up.knee[1] - up.hip[1])).toBeCloseTo(GRUMP_LEG.upper, 4);
      expect(Math.hypot(up.paw[0] - up.knee[0], up.paw[1] - up.knee[1])).toBeCloseTo(GRUMP_LEG.lower, 4);
    }
    // a front wrist bends forward, a hind hock backward
    const front = legIK("frontNear", 0, 5);
    const hind = legIK("backNear", 0, 5);
    expect(front.knee[0]).toBeGreaterThan(front.hip[0]);
    expect(hind.knee[0]).toBeLessThan(hind.hip[0]);
    // a crouched body keeps the paws planted
    const [hx, hy] = GRUMP_HIPS.frontNear;
    expect(legIK("frontNear", 0, 0, [hx, hy + 3]).paw[1]).toBeCloseTo(GRUMP_GROUND, 1);
  });

  it("draws each stance with the head on top", () => {
    for (const stance of ["stand", "lie", "curl"] as const) expect(GRUMP_ORDER[stance].at(-1)).toBe("head");
    // sitting, a lifted paw passes over the face
    expect(GRUMP_ORDER.sit).toEqual(["body", "tail", "head", "paws"]);
    expect(GRUMP_ORDER.stand).toEqual(["tail", "legsFar", "legsNear", "body", "head"]);
  });

  it("crops to the bust under 48 px and leaves the tail out", () => {
    expect(grumpViewBox(32)).toBe("11 14 78 78");
    expect(grumpViewBox(GRUMP_BUST_MAX)).toBe("11 14 78 78");
    expect(grumpViewBox(49)).toBe("0 0 100 100");
    expect(grumpParts({ expression: "neutral", size: 32 }).tail).toEqual([]);
    expect(grumpParts({ expression: "neutral", size: 96 }).tail.length).toBeGreaterThan(0);
    expect(grumpParts({ expression: "sleepy", size: 32 }).extras).toEqual([]);
  });

  it("keeps one outline width, never under 1.6 screen px", () => {
    for (const size of [16, 24, 32, 44, 48, 64, 96, 240]) {
      const ow = grumpOutline(size);
      const box = size <= GRUMP_BUST_MAX ? 78 : 100;
      expect((ow * size) / box, String(size)).toBeGreaterThanOrEqual(1.6 - 0.01);
      expect(ow).toBeGreaterThanOrEqual(1.9);
    }
  });

  it("wears the bot color on its markings, darkened just enough for the mask to read on the cream fur", () => {
    for (const [name, hex] of Object.entries(MASCOT_COLOR_HEX)) {
      const palette = grumpPalette(hex);
      expect(contrastRatio(palette.coat, palette.cream), name).toBeGreaterThanOrEqual(MASK_MIN_CONTRAST);
    }
    // white markings turn grey, never another hue
    const white = grumpMask("#FFFFFF");
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(white.slice(i, i + 2), 16));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(40);
    // the cream fur takes a hint of the markings
    expect(grumpPalette("#377FE6").cream).not.toBe(grumpPalette("#E78531").cream);
    // the markings follow the hue of the bot color
    const blue = grumpPalette("#377FE6").coat;
    expect(Number.parseInt(blue.slice(5, 7), 16)).toBeGreaterThan(Number.parseInt(blue.slice(1, 3), 16));
  });

  it("paints every role a palette defines", () => {
    const palette = grumpPalette("#377FE6");
    for (const stance of GRUMP_STANCES) {
      for (const expression of GRUMP_EXPRESSIONS) {
        const parts = grumpParts({ expression, size: 200, stance });
        for (const op of (Object.values(parts) as GrumpOp[][]).flat()) {
          if (op.fill) expect(palette[op.fill], op.fill).toMatch(/^#[0-9a-fA-F]{6}$/);
          if (op.stroke) expect(palette[op.stroke], op.stroke).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
      }
    }
  });
});
