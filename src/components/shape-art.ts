// The thirteen original mascot shapes (shared/mascot-look.ts), as outlines in
// a 0..100 box, and the one face they all wear. Every shape gets exactly the
// same eyes (EYES): only where the face sits (its anchor) changes per shape,
// never the eyes themselves. Most outlines are generated (a radius function
// around a center, or a polygon with rounded corners) and smoothed into
// cubic curves, so each reads as a soft, filled body at any size.
import type { MascotShape } from "../../shared/mascot-look";

type Point = [number, number];

const round = (value: number) => Math.round(value * 100) / 100;

/** A closed, smooth path through the points (Catmull-Rom turned into cubic Beziers). */
export function smoothClosed(points: Point[], tension = 1): string {
  const n = points.length;
  let d = `M${round(points[0][0])} ${round(points[0][1])}`;
  for (let i = 0; i < n; i += 1) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const c1: Point = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
    const c2: Point = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
    d += `C${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])} ${round(p2[0])} ${round(p2[1])}`;
  }
  return `${d}Z`;
}

/** Points around a center at radius r(angle), angle 0 pointing up, clockwise. */
function polar(cx: number, cy: number, r: (angle: number) => number, count = 96, turn = 0): Point[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    const radius = r(a);
    return [cx + radius * Math.sin(a + turn), cy - radius * Math.cos(a + turn)];
  });
}

/** A polygon with each corner rounded by `radius`, drawn with quadratic curves at the corners. */
export function roundedPolygon(points: Point[], radius: number): string {
  const n = points.length;
  const at = (i: number) => points[(i + n) % n];
  let d = "";
  for (let i = 0; i < n; i += 1) {
    const prev = at(i - 1);
    const p = at(i);
    const next = at(i + 1);
    const toPrev = Math.hypot(prev[0] - p[0], prev[1] - p[1]);
    const toNext = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const r1 = Math.min(radius, toPrev / 2);
    const r2 = Math.min(radius, toNext / 2);
    const a: Point = [p[0] + ((prev[0] - p[0]) / toPrev) * r1, p[1] + ((prev[1] - p[1]) / toPrev) * r1];
    const b: Point = [p[0] + ((next[0] - p[0]) / toNext) * r2, p[1] + ((next[1] - p[1]) / toNext) * r2];
    d += `${i === 0 ? "M" : "L"}${round(a[0])} ${round(a[1])}Q${round(p[0])} ${round(p[1])} ${round(b[0])} ${round(b[1])}`;
  }
  return `${d}Z`;
}

/** A regular polygon's corners around a center, the first at `turn` degrees from straight up. */
function regular(cx: number, cy: number, r: number, sides: number, turnDeg = 0): Point[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = ((i / sides) * 360 + turnDeg) * (Math.PI / 180);
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  });
}

/** Rotates points about a center by degrees (clockwise on screen). */
function rotate(points: Point[], cx: number, cy: number, deg: number): Point[] {
  const a = (deg * Math.PI) / 180;
  return points.map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]);
}

/** One shape: its outline and where its face sits. */
export interface ShapeArt {
  d: string;
  /** The middle between the two eyes. */
  face: Point;
}

export const SHAPE_ART: Record<MascotShape, ShapeArt> = {
  // (1) a circle
  circle: { d: smoothClosed(polar(50, 50, () => 42, 48)), face: [56, 42] },
  // (2) a puffy cloud: six soft bumps
  cloud: { d: smoothClosed(polar(50, 52, (a) => 38 + 5 * Math.abs(Math.cos(3 * a)), 120)), face: [56, 44] },
  // (3) a rounded square, tilted a little
  squircle: { d: roundedPolygon(rotate([[14, 14], [86, 14], [86, 86], [14, 86]], 50, 50, -15), 18), face: [56, 42] },
  // (4) a four-point sparkle with soft, hollow sides
  sparkle: { d: smoothClosed(polar(50, 50, (a) => 27 + 20 * Math.abs(Math.cos(2 * a)) ** 1.6, 64)), face: [55, 47] },
  // (5) a four-lobe clover
  clover: { d: smoothClosed(polar(50, 50, (a) => 28 + 16 * Math.abs(Math.cos(2 * a)) ** 0.6, 128, Math.PI / 4)), face: [55, 45] },
  // (6) a bean, heart-like, leaning right: a wide top-right lobe, a point at the bottom left
  bean: {
    d: "M24 26C30 12 46 10 56 18C64 10 82 12 88 26C94 42 84 60 68 72C56 81 42 88 22 90C14 90 10 84 12 76C16 62 12 48 16 38C18 32 20 30 24 26Z",
    face: [60, 40],
  },
  // (7) an eight-lobe scalloped flower
  flower: { d: smoothClosed(polar(50, 50, (a) => 38 + 6 * Math.abs(Math.cos(4 * a)) ** 0.7, 160)), face: [55, 45] },
  // (8) a teardrop, its point at the top left
  drop: { d: smoothClosed(rotate(polar(50, 56, (a) => 32 + 38 * Math.max(0, Math.cos(a)) ** 6, 120), 50, 50, -40)), face: [58, 54] },
  // (9) a pill, lying down
  pill: { d: roundedPolygon([[6, 28], [94, 28], [94, 72], [6, 72]], 22), face: [56, 46] },
  // (10) a soft guitar pick: a wide top, a point at the bottom right
  pick: { d: roundedPolygon([[8, 16], [92, 12], [74, 92]], 30), face: [56, 38] },
  // (11) a rounded pentagon, a little house, tilted slightly
  house: { d: roundedPolygon(rotate([[50, 8], [92, 40], [82, 90], [18, 90], [8, 40]], 50, 52, 8), 14), face: [56, 50] },
  // (12) a six-point soft star
  star: { d: smoothClosed(polar(50, 50, (a) => 37 + 8 * Math.cos(6 * a), 144)), face: [55, 46] },
  // (13) a hexagon with rounded corners
  hexagon: { d: roundedPolygon(regular(50, 50, 44, 6, 0), 12), face: [56, 44] },
};

/**
 * The one face every shape wears: two dark ovals, about 1 : 2.2, tilted 15
 * degrees clockwise, the right one a little higher. Same size, same spacing,
 * on every shape; only the face's anchor moves.
 */
export const EYES = {
  rx: 3.8,
  ry: 8.4,
  tilt: 15,
  /** Each eye's offset from the face anchor. */
  left: [-8, 1.2] as Point,
  right: [8, -1.2] as Point,
} as const;
