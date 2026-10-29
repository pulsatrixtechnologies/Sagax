// The shapes' pose and paint (shape-volume.ts) and how ShapeFrameSvg draws
// them: vectors only, a pose that never shears a shape, the out-of-plane turn
// that keeps the top on top, the eyes' styles, one ground for every shape.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MASCOT_SHAPES, SHAPE_SKINS } from "../../shared/mascot-look";
import { ShapeFrameSvg, ShapeMascot, shapeSkinPaint } from "./ShapeMascot";
import { SHAPE_ART } from "./shape-art";
import { stillFrame } from "./shape-engine";
import { shapeSkinLayers } from "./skin-fx/shape-skins";
import { eyeStyleFor, groundLift, inkPaint, poseMatrices, REST_POSE, styledEyes, uprightPose, volumeDetail, warpPath, EYE_INK, EYE_INK_ON_DARK } from "./shape-volume";

const draw = (props: Record<string, unknown>) => renderToStaticMarkup(h(ShapeMascot, { color: "blue", animated: false, ...props } as never));
const nums = (m: string) => m.match(/-?\d*\.?\d+/g)!.map(Number);
const ys = (d: string) => {
  const n = nums(d);
  return n.filter((_, i) => i % 2 === 1);
};

describe("the pose", () => {
  it("turns and narrows a shape but never shears it", () => {
    for (const pose of [REST_POSE, { ...REST_POSE, yaw: 50, pitch: -20, roll: 10 }, { ...REST_POSE, yaw: -40, pitch: 25, roll: -30 }]) {
      const m = poseMatrices("full", pose);
      for (const t of [...m.slices, m.face]) {
        const [a, b, c, d] = nums(t);
        // the matrix's columns stay perpendicular: a rotation times a scale, no skew
        expect(Math.abs(a * c + b * d)).toBeLessThan(1e-3);
      }
    }
  });

  it("bends every outline with the resting turn only: a sway's yaw or pitch never keystones it", () => {
    const pebble = stillFrame({ shape: "bean", expression: "neutral", color: "#00a592" }).body;
    const rest = warpPath(pebble, REST_POSE);
    for (const yaw of [-50, 0, 50]) expect(warpPath(pebble, { ...REST_POSE, yaw, pitch: -yaw / 2 })).toBe(rest);
    const turned = ys(rest);
    expect(Math.max(...turned) - Math.min(...turned)).toBeGreaterThan(55);
    expect(uprightPose({ ...REST_POSE, yaw: 40, pitch: -20, roll: 9 })).toEqual({ ...REST_POSE, roll: 9 });
  });

  it("stands every shape on the same ground as the heart", () => {
    expect(groundLift("bean")).toBe(0);
    for (const shape of MASCOT_SHAPES) expect(Math.abs(groundLift(shape))).toBeLessThan(20);
  });

  it("draws fewer slices on small avatars", () => {
    expect(poseMatrices("tiny").slices.length).toBeLessThan(poseMatrices("full").slices.length);
    expect(volumeDetail(18)).toBe("tiny");
    expect(volumeDetail(36)).toBe("full");
  });
});

describe("paints and eyes", () => {
  it("one flat colour, opaque eyes: dark on light and coloured bodies, light on dark ones", () => {
    expect(inkPaint("#2a8fe8")).toMatchObject({ fill: "#2a8fe8", side: "#2a8fe8", eyes: EYE_INK, edge: null });
    expect(inkPaint("#f4f4f4").eyes).toBe(EYE_INK);
    expect(inkPaint("#f4f4f4").edge).not.toBeNull();
    // a white body's side is a little grey, not a hairline on every slice
    expect(inkPaint("#f4f4f4").side).not.toBe("#f4f4f4");
    expect(inkPaint("#0b0b0e").eyes).toBe(EYE_INK_ON_DARK);
  });

  it("draws ovals while busy and full arches when done, on the eyes' own boxes", () => {
    expect(eyeStyleFor("working")).toBe("oval");
    expect(eyeStyleFor("streaming")).toBe("oval");
    expect(eyeStyleFor("happy")).toBe("arc");
    expect(eyeStyleFor("idle")).toBe("capsule");
    const eyes = stillFrame({ shape: "circle", expression: "neutral", color: "#2a8fe8" }).eyes;
    expect(styledEyes(eyes, "capsule")).toBe(eyes);
    const ovals = styledEyes(eyes, "oval");
    const arcs = styledEyes(eyes, "arc");
    expect((ovals.match(/M/g) ?? []).length).toBe(2);
    expect((arcs.match(/M/g) ?? []).length).toBe(2);
    expect(arcs).toMatch(/A[^A]*A/);
  });
});

describe("the drawing", () => {
  it("is vectors only at every size: no image, no filter", () => {
    for (const size of [16, 24, 40, 56, 102]) {
      for (const skin of SHAPE_SKINS) {
        const html = draw({ size, skin, shape: "hexagon" });
        expect(html).not.toMatch(/<image|<foreignObject|filter=|feGaussianBlur/);
      }
    }
  });

  it("draws one outline turned into slices, a face, and opaque eyes on top", () => {
    const html = draw({ size: 56, shape: "cloud" });
    expect(html).toContain('data-volume="full"');
    // one outline in the defs (shared by the slices) and the face's own fill
    expect((html.match(/data-shape-outline=""/g) ?? []).length).toBe(1);
    expect((html.match(/data-shape-face=""/g) ?? []).length).toBe(1);
    expect((html.match(/<use href="#[^"]+-outline"/g) ?? []).length).toBeGreaterThan(3);
    expect((html.match(/data-pose-slice=/g) ?? []).length).toBeGreaterThan(3);
    expect(html).toContain("data-pose-face");
    expect(html).toMatch(/data-shape-eyes=""/);
    // the eyes sit in the face's group, after the face, under the same matrices
    const face = html.indexOf("data-shape-face");
    const eyes = html.indexOf("data-shape-eyes");
    const viewEnd = html.indexOf("</g>", eyes);
    expect(face).toBeGreaterThan(0);
    expect(eyes).toBeGreaterThan(face);
    expect(html.slice(face, viewEnd)).not.toContain("</g></g>");
    expect(html).not.toContain("Gradient id");
  });

  it("keeps the Outline skin flat", () => {
    const html = draw({ size: 56, skin: "outline" });
    expect(html).toContain('data-volume="flat"');
    expect(html).not.toContain("data-pose-slice");
  });

  it("draws a move's badge under the same pose as its notch", () => {
    const frame = { ...stillFrame({ shape: "circle", expression: "neutral", color: "#2a8fe8" }), badge: { x: 72, y: 30, r: 8, notch: 2 } };
    const paint = shapeSkinPaint("plain", "#2a8fe8");
    const html = renderToStaticMarkup(h(ShapeFrameSvg, { frame, uid: "t", skin: "plain", paint, layers: shapeSkinLayers("plain", SHAPE_ART.circle.d, "#2a8fe8", "t", true), size: 56 }));
    const view = html.slice(html.indexOf("data-shape-view"));
    expect(view).toContain('mask="url(#t-notch)"');
    expect(view).toContain('fill="#2a8fe8"');
  });
});
