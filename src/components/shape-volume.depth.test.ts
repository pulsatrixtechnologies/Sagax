// A move that shrinks a shape's body (thinking's dots, sleep, alert and
// exclaim's bar, burst, comet) must still draw one solid body: its slices
// (shape-volume.ts poseMatrices) thin with it. With the resting depth they
// smeared a dot into a pill beside its own thought dots, the "broken" shape
// mascot. Checked on the SVG as ShapeFrameSvg draws it, for every shape, every
// move and every size the app draws a shape at.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MASCOT_SHAPES, type MascotShape } from "../../shared/mascot-look";
import { ShapeFrameSvg, shapeSkinPaint } from "./ShapeMascot";
import { SHAPE_ART, SHAPE_RADII } from "./shape-art";
import { bodyDepth, DEPTH_FULL, ShapeEngine, stillFrame, type ShapeFrame } from "./shape-engine";
import { MOVE_TIMING, SHAPE_MOVES, type ShapeMove } from "./shape-moves";
import { shapeSkinLayers } from "./skin-fx/shape-skins";
import { poseMatrices, REST_POSE, writePose, type Pose } from "./shape-volume";

/** Every size a shape avatar is drawn at (sidebar, chat header, bot panel, lists, cards, editor, desktop mascot). */
const SIZES = [14, 16, 18, 20, 24, 26, 28, 32, 36, 38, 42, 44, 56, 64, 96, 112, 128, 144, 160, 220, 256];
const POSES: Pose[] = [REST_POSE, { ...REST_POSE, yaw: 28, pitch: 18, roll: 8 }];
/** The moves that shrink the body to a dot, a bar or a speck. */
const SHRINKING: ShapeMove[] = ["thinking", "sleep", "alert", "exclaim", "burst", "comet"];

const nums = (s: string) => s.match(/-?\d*\.?\d+(?:e-?\d+)?/g)!.map(Number);

function svgFor(frame: ShapeFrame, size: number, pose: Pose): string {
  const color = "#F4F4F4";
  const paint = shapeSkinPaint("plain", color);
  const layers = shapeSkinLayers("plain", SHAPE_ART.circle.d, color, "t", false);
  return renderToStaticMarkup(h(ShapeFrameSvg, { frame, uid: "t", skin: "plain", paint, layers, size, pose }));
}

/** Where the body's middle lands under each slice's and the face's matrix (box units). */
function sliceCentres(svg: string): [number, number][] {
  return [...svg.matchAll(/<g transform="matrix\(([^)]*)\)" data-pose-(?:slice|face)/g)].map((m) => {
    const [a, b, c, d, e, f] = nums(m[1]);
    return [a * 50 + c * 50 + e, b * 50 + d * 50 + f];
  });
}

/** The body's thinnest half-width before the pose (box units, from its outline). */
function thinnest(frame: ShapeFrame): number {
  const n = nums(frame.body);
  let least = Infinity;
  for (let i = 0; i + 1 < n.length; i += 2) least = Math.min(least, Math.hypot(n[i] - 50, n[i + 1] - 50));
  return least;
}

/** How far the slices spread, against the body's own thinnest half-width: the share at rest is about 0.4. */
function smear(frame: ShapeFrame, size: number, pose: Pose): number {
  const centres = sliceCentres(svgFor(frame, size, pose));
  expect(centres.length).toBeGreaterThan(2);
  let spread = 0;
  for (const p of centres) for (const q of centres) spread = Math.max(spread, Math.hypot(p[0] - q[0], p[1] - q[1]));
  return spread / (thinnest(frame) * pose.scale);
}

function midMove(shape: MascotShape, move: ShapeMove): ShapeFrame {
  const run = new ShapeEngine({ shape, expression: "neutral", color: "#F4F4F4" }, 0);
  run.play(move, 0);
  const { duration, morph } = MOVE_TIMING[move];
  // the move fully in, before it slides back
  return run.frame(Math.min(duration, morph + 0.6));
}

describe("a shape's body keeps together at every size", () => {
  it("is full depth for a thick body, thinner for a thin one, and thins with a body shrunk to a dot or a bar", () => {
    for (const shape of MASCOT_SHAPES) {
      const rest = stillFrame({ shape, expression: "neutral", color: "#F4F4F4" }).depth;
      const thinnest = Math.min(...SHAPE_RADII[shape]);
      expect(rest, shape).toBe(thinnest >= DEPTH_FULL ? 1 : thinnest / DEPTH_FULL);
      expect(midMove(shape, "thinking").depth).toBeLessThan(0.35);
      expect(midMove(shape, "egg").depth).toBeGreaterThan(0.6);
    }
    expect(bodyDepth([DEPTH_FULL / 2, DEPTH_FULL / 2])).toBe(0.5);
    expect(bodyDepth([2, 2])).toBe(1);
  });

  it("draws the resting shapes as one body", () => {
    for (const shape of MASCOT_SHAPES) {
      const frame = stillFrame({ shape, expression: "neutral", color: "#F4F4F4" });
      for (const size of SIZES) for (const pose of POSES) expect(smear(frame, size, pose), `${shape} ${size}px`).toBeLessThan(0.75);
    }
  });

  it("never smears a dot, a bar or a speck into another shape", () => {
    for (const shape of MASCOT_SHAPES) {
      for (const move of SHRINKING) {
        const frame = midMove(shape, move);
        for (const size of SIZES) for (const pose of POSES) expect(smear(frame, size, pose), `${shape} ${move} ${size}px`).toBeLessThan(0.75);
      }
    }
  });

  it("keeps every move's body together", () => {
    for (const shape of MASCOT_SHAPES) {
      for (const move of SHAPE_MOVES) {
        const frame = midMove(shape, move);
        expect(smear(frame, 144, REST_POSE), `${shape} ${move}`).toBeLessThan(0.75);
      }
    }
  });

  it("writes the thinned slices on the live drawing too (the live loop's path)", () => {
    const frame = midMove("pill", "thinking");
    const written = new Map<string, string>();
    const node = (key: string, slice?: number) => ({
      getAttribute: (name: string) => (name === "data-pose-slice" ? String(slice ?? -1) : null),
      setAttribute: (_name: string, value: string) => written.set(key, value),
    });
    const svg = {
      querySelectorAll: (selector: string) => (selector === "[data-pose-slice]" ? [node("slice0", 0)] : selector === "[data-pose-face]" ? [node("face")] : []),
    } as unknown as SVGSVGElement;
    writePose(svg, "full", REST_POSE, frame);
    const thin = poseMatrices("full", REST_POSE, frame.depth);
    expect(written.get("slice0")).toBe(thin.slices[0]);
    expect(written.get("face")).toBe(thin.face);
    expect(thin.slices[0]).not.toBe(poseMatrices("full", REST_POSE).slices[0]);
  });
});
