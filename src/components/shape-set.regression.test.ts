// Every shape holds together and keeps its face (2026-10-28). Rendered the
// way the app draws it (ShapeFrameSvg, the pose each shape stands in), for
// every shape at rest, after each move, and on a turned, rolled, squashed
// body:
// - the outline is one closed path and the body is one piece (the pumpkin's
//   stem stands in the body, never beside it);
// - the two eyes sit inside the body;
// - the two eyes are the same capsule, on one level line, upright, taller
//   than wide at rest, and come back to rest after a blink or a move.
// Before this the eyes were drawn through the body's own matrices and bend
// (a roll tilted them, the perspective made one taller than the other, a
// clip to the outline cut them into leaves), and the live loop could leave
// the outline and the eyes of two different frames on screen.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MASCOT_SHAPES, type MascotShape } from "../../shared/mascot-look";
import { ShapeFrameSvg, shapeSkinPaint, writeShapeFrame } from "./ShapeMascot";
import { angleOf, RADII_COUNT, SHAPE_ART, SHAPE_RADII, toBox } from "./shape-art";
import { blinkOpen, blinkSchedule, eyeOutline, gazeFrame, MORPH_S, ShapeEngine, stillFrame, type ShapeFrame } from "./shape-engine";
import { MOVE_TIMING, SHAPE_MOVES } from "./shape-moves";
import { shapeSkinLayers } from "./skin-fx/shape-skins";
import { faceInDrawing, forgetPose, groundLift, posedEyes, REST_POSE, SHAPE_FIT, warpPath, warpPoint, writePose, type Pose, type PosedEye } from "./shape-volume";

const RAD = Math.PI / 180;
const COLOR = "#3b82f6";
const grounded = (shape: MascotShape, pose: Pose = REST_POSE): Pose => ({ ...pose, scale: pose.scale * SHAPE_FIT[shape], lift: pose.lift + groundLift(shape) });
/** A body turned hard, rolled and squashed (a move's sway at its widest). */
const TURNED = (shape: MascotShape): Pose => grounded(shape, { ...REST_POSE, yaw: 28, pitch: 18, roll: 12 });
const SQUASHED = { x: 3, y: -2, rot: 18, sx: 1.08, sy: 0.9 };

const svgFor = (frame: ShapeFrame, pose: Pose) => {
  const paint = shapeSkinPaint("plain", COLOR);
  const layers = shapeSkinLayers("plain", SHAPE_ART.circle.d, COLOR, "t", false);
  return renderToStaticMarkup(h(ShapeFrameSvg, { frame, uid: "t", skin: "plain", paint, layers, size: 96, pose }));
};

/** The body's outline as the drawing shows it (bent, then the face's and the motion's matrices), sampled finely. */
function outlineInDrawing(radii: readonly number[], frame: ShapeFrame, pose: Pose): [number, number][] {
  const m = faceInDrawing(frame.motion, pose, frame.depth);
  const sy = Math.sin(pose.yaw * RAD);
  const cy = Math.cos(pose.yaw * RAD);
  const sp = Math.sin(pose.pitch * RAD);
  const cp = Math.cos(pose.pitch * RAD);
  return Array.from({ length: RADII_COUNT }, (_, i) => {
    const a = angleOf(i);
    const [bx, by] = toBox([radii[i] * Math.sin(a), -radii[i] * Math.cos(a)]);
    const [x, y] = warpPoint(bx, by, sy, cy, sp, cp);
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  });
}

function inside(poly: [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function expectPair(eyes: PosedEye[], label: string, rest: boolean) {
  expect(eyes, label).toHaveLength(2);
  const [l, r] = eyes;
  expect(Math.abs(l.w - r.w), `${label} same width`).toBeLessThan(1e-9);
  expect(Math.abs(l.h - r.h), `${label} same height`).toBeLessThan(1e-9);
  expect(Math.abs(l.y - r.y), `${label} level`).toBeLessThan(1e-9);
  expect(r.x - l.x, `${label} apart`).toBeGreaterThan((l.w + r.w) / 2);
  if (rest) {
    expect(l.tilt, `${label} upright`).toBe(0);
    expect(r.tilt, `${label} upright`).toBe(0);
    expect(l.h, `${label} taller than wide`).toBeGreaterThan(l.w * 1.4);
  }
}

/** A moment with no blink on this seed, after `from` s. */
function openMoment(seed: number, from: number): number {
  const starts = blinkSchedule(seed, from + 30);
  for (let t = from; t < from + 30; t += 0.05) if (blinkOpen(t, starts) === 1 && blinkOpen(t - 0.3, starts) === 1) return t;
  throw new Error("no open moment");
}

describe("every shape holds together and keeps its face", () => {
  it("draws one closed outline with two eyes inside it, at rest and turned hard", () => {
    for (const shape of MASCOT_SHAPES) {
      const frame = stillFrame({ shape, expression: "neutral", color: COLOR });
      expect(frame.body, shape).toMatch(/^M[^M]*Z$/);
      expect(SHAPE_RADII[shape].every((r) => Number.isFinite(r) && r > 0.3), shape).toBe(true);
      for (const [name, pose, motion] of [["rest", grounded(shape), frame.motion], ["turned", TURNED(shape), SQUASHED]] as const) {
        const posed = { ...frame, motion };
        const html = svgFor(posed, pose);
        const outline = /<path id="t-outline" d="([^"]+)"/.exec(html)?.[1] ?? "";
        expect(outline, `${shape} ${name} outline`).toMatch(/^M[^M]*Z$/);
        const eyesD = /<path d="([^"]+)"[^>]*data-shape-eyes=""/.exec(html)?.[1] ?? "";
        expect(eyesD.split("M").filter(Boolean), `${shape} ${name} eyes`).toHaveLength(2);
        // no clip: an eye is never cut into a leaf by the outline
        expect(html).not.toContain("eyes-clip");
        const body = outlineInDrawing(SHAPE_RADII[shape], posed, pose);
        for (const eye of posedEyes(posed, pose)) {
          for (const [x, y] of eyeOutline(eye.x, eye.y, eye.w, eye.h, eye.tilt)) expect(inside(body, x, y), `${shape} ${name} eye inside`).toBe(true);
        }
      }
    }
  });

  it("stands the pumpkin's stem in its body: its foot inside, its tip above", () => {
    const frame = stillFrame({ shape: "pumpkin", expression: "neutral", color: COLOR });
    expect(frame.stem).not.toBeNull();
    const pts = [...frame.stem!.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
    const body = SHAPE_RADII.pumpkin.map((r, i) => toBox([r * Math.sin(angleOf(i)), -r * Math.cos(angleOf(i))]) as [number, number]);
    expect(pts.some(([x, y]) => inside(body, x, y))).toBe(true);
    expect(Math.min(...pts.map(([, y]) => y))).toBeLessThan(Math.min(...body.map(([, y]) => y)));
    // drawn behind the face, in the bent outline's space
    const html = svgFor(frame, grounded("pumpkin"));
    expect(html).toContain("data-shape-stem");
    expect(html.indexOf("data-shape-stem")).toBeLessThan(html.indexOf('class="shape-fill"'));
    for (const shape of MASCOT_SHAPES) if (shape !== "pumpkin") expect(stillFrame({ shape, expression: "neutral", color: COLOR }).stem, shape).toBeNull();
  });

  it("keeps two equal, level, upright capsules on every shape, at rest and on a turned, rolled, squashed body", () => {
    for (const shape of MASCOT_SHAPES) {
      const frame = stillFrame({ shape, expression: "neutral", color: COLOR });
      expectPair(posedEyes(frame, grounded(shape)), `${shape} rest`, true);
      expectPair(posedEyes({ ...frame, motion: SQUASHED }, TURNED(shape)), `${shape} turned`, true);
      // the pointer's pull moves the face, never one eye above the other
      expectPair(posedEyes(gazeFrame({ shape, expression: "neutral", color: COLOR }, 0.8, -0.7), TURNED(shape)), `${shape} looking`, true);
    }
  });

  it("brings the eyes back to rest after every move and every blink", () => {
    for (const shape of MASCOT_SHAPES) {
      for (const move of SHAPE_MOVES) {
        const seed = 7;
        const state = { shape, expression: "neutral" as const, color: COLOR };
        const run = new ShapeEngine(state, 0, seed);
        // the same avatar that never played the move: the same wander, the same blinks
        const calm = new ShapeEngine(state, 0, seed);
        run.play(move, 0.5);
        const t = openMoment(seed, 0.5 + MOVE_TIMING[move].duration + MORPH_S + 0.2);
        for (let at = 0; at < t; at += 0.1) {
          run.frame(at);
          calm.frame(at);
        }
        const after = run.frame(t);
        expect(after.eyeShapes, `${shape} ${move}`).toEqual(calm.frame(t).eyeShapes);
        expect(after.eyeShapes.every((eye) => eye.tilt === 0)).toBe(true);
        expectPair(posedEyes(after, grounded(shape)), `${shape} after ${move}`, true);
      }
    }
  });
});

describe("the live drawing never mixes two frames", () => {
  const fakeSvg = () => {
    const attrs = new Map<string, string>();
    const node = (key: string) => ({ getAttribute: () => null, setAttribute: (n: string, v: string) => attrs.set(n === "d" ? key : `${key}.${n}`, v) });
    const nodes: Record<string, ReturnType<typeof node>[]> = {
      "[data-shape-outline]": [node("outline")],
      "[data-shape-eyes]": [node("eyes")],
      "[data-shape-stem]": [node("stem")],
    };
    const svg = { querySelectorAll: (selector: string) => nodes[selector] ?? [] } as unknown as SVGSVGElement;
    return { svg, attrs };
  };

  it("keeps the bent outline through a blink (writeShapeFrame leaves the outline and the eyes to writePose)", () => {
    const { svg, attrs } = fakeSvg();
    const pose = grounded("drop");
    const still = stillFrame({ shape: "drop", expression: "neutral", color: COLOR });
    const blink = gazeFrame({ shape: "drop", expression: "neutral", color: COLOR }, 0, 0, {}, { left: 0.4, right: 0.4 });
    writeShapeFrame(svg, still);
    writePose(svg, "full", pose, still);
    const bent = attrs.get("outline");
    expect(bent).toBe(warpPath(still.body, pose));
    for (const frame of [blink, still]) {
      writeShapeFrame(svg, frame);
      writePose(svg, "full", pose, frame);
      expect(attrs.get("outline")).toBe(bent);
    }
    // the eyes are open again, the same as before the blink
    const open = attrs.get("eyes");
    writeShapeFrame(svg, still);
    writePose(svg, "full", pose, still);
    expect(attrs.get("eyes")).toBe(open);
  });

  it("writes everything again after React drew its own outline", () => {
    const { svg, attrs } = fakeSvg();
    const pose = grounded("pumpkin");
    const frame = stillFrame({ shape: "pumpkin", expression: "neutral", color: COLOR });
    writePose(svg, "full", pose, frame);
    const bent = attrs.get("outline");
    // React re-renders with another frame's outline; the memo must not trust what it wrote before
    attrs.set("outline", "M0 0Z");
    forgetPose(svg);
    writePose(svg, "full", pose, frame);
    expect(attrs.get("outline")).toBe(bent);
    expect(attrs.get("stem")).toBe(warpPath(frame.stem!.d, pose));
  });
});
