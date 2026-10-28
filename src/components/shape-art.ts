// The Shapes geometry. Every body is one closed outline drawn from 64 radii
// around its middle, smoothed into cubic curves, so any two bodies morph by
// blending their radii. The radius unit R is the circle's radius; the drawing
// box is 0..100 with the middle at BODY.center and one R worth BODY.unit box
// units.
//
// The bodies (2026-10-28) are the bloub network's tables (shape-tables.ts,
// MIT, see NOTICE), plus our pumpkin, built here from its own figure. The
// bodies some moves turn into (MOVE_RADII) are still our own geometry: a
// figure described as "is this point inside?" and a ray cast from the middle
// at each of the 64 angles.
import type { MascotShape } from "../../shared/mascot-look";
import { SHAPE_TABLES } from "./shape-tables";

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

/** How many radii make a body. */
export const RADII_COUNT = 64;

/** Where the body sits in the 0..100 box, and how many box units one R is. */
export const BODY = { center: [50, 50] as Point, unit: 40 } as const;

/** A body: one radius (in R) per angle, angle 0 straight up, clockwise. */
export type Radii = readonly number[];

/** The angle of radius i, radians (0 up, clockwise). */
export const angleOf = (i: number) => (i / RADII_COUNT) * Math.PI * 2;

/** The point of radius i in R units (x right, y down). */
export const radiusPoint = (radii: Radii, i: number): Point => {
  const a = angleOf(i);
  return [radii[i] * Math.sin(a), -radii[i] * Math.cos(a)];
};

/** The body's radius toward any angle (radians, 0 up, clockwise), read between the two nearest radii. */
export function radiusAt(radii: Radii, angle: number): number {
  const turn = (((angle / (Math.PI * 2)) % 1) + 1) % 1;
  const at = turn * RADII_COUNT;
  const i = Math.floor(at) % RADII_COUNT;
  const j = (i + 1) % RADII_COUNT;
  const f = at - Math.floor(at);
  return radii[i] * (1 - f) + radii[j] * f;
}

/** The body's radius toward a point (R units). */
export const radiusToward = (radii: Radii, x: number, y: number) => radiusAt(radii, Math.atan2(x, -y));

/** Two bodies blended (t 0..1). */
export function blendRadii(from: Radii, to: Radii, t: number): number[] {
  return from.map((r, i) => r + (to[i] - r) * t);
}

/** Shared easing and math for the shapes' motion. */
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const easeOutQuint = (t: number) => 1 - (1 - clamp01(t)) ** 5;
export const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const RAD = Math.PI / 180;

/** A point in R units (from the body's middle) in the 0..100 box. */
export const toBox = ([x, y]: Point): Point => [BODY.center[0] + x * BODY.unit, BODY.center[1] + y * BODY.unit];

/** A body's outline in box units, at a scale (1 = R is BODY.unit). */
export function outlinePath(radii: Radii, scale = 1): string {
  const [cx, cy] = BODY.center;
  const u = BODY.unit * scale;
  return smoothClosed(Array.from({ length: RADII_COUNT }, (_, i) => {
    const [x, y] = radiusPoint(radii, i);
    return [cx + x * u, cy + y * u] as Point;
  }));
}

/* ------------------------------------------------------------ figures */

type Inside = (x: number, y: number) => boolean;

/** Casts a ray from the middle at each angle and keeps the farthest point still inside the figure. */
export function radiiOf(inside: Inside, reach = 2.4): number[] {
  return Array.from({ length: RADII_COUNT }, (_, i) => {
    const a = angleOf(i);
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    // walk in from outside so a figure with dents keeps its outermost edge
    let r = reach;
    const step = 0.01;
    while (r > 0 && !inside(dx * r, dy * r)) r -= step;
    let lo = Math.max(0, r);
    let hi = Math.min(reach, r + step);
    for (let k = 0; k < 14; k += 1) {
      const mid = (lo + hi) / 2;
      if (inside(dx * mid, dy * mid)) lo = mid;
      else hi = mid;
    }
    return Math.round(lo * 10000) / 10000;
  });
}

/** Distance from a point to a segment. */
function toSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

/** Whether a point lies inside a convex polygon (any winding). */
function inConvex(points: Point[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** A convex polygon grown outward by `grow`: its corners come out round. */
function grownPolygon(points: Point[], grow: number): Inside {
  return (x, y) => {
    if (inConvex(points, x, y)) return true;
    for (let i = 0; i < points.length; i += 1) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % points.length];
      if (toSegment(x, y, ax, ay, bx, by) <= grow) return true;
    }
    return false;
  };
}

/** A regular polygon's corners around (cx, cy), the first `turn` degrees clockwise from straight up. */
function regular(sides: number, radius: number, turn = 0, cx = 0, cy = 0): Point[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = ((i / sides) * 360 + turn) * (Math.PI / 180);
    return [cx + radius * Math.sin(a), cy - radius * Math.cos(a)] as Point;
  });
}

const circle = (r: number): number[] => Array.from({ length: RADII_COUNT }, () => r);

/** A hexagon with its flat sides up and down, corners rounded. */
const hexagon = (turn = 30) => radiiOf(grownPolygon(regular(6, 0.85, turn), 0.23));

/** A triangle standing on its base, its three corners rounded. */
const triangle = () => radiiOf(grownPolygon(regular(3, 0.9, 0, 0, 0.12), 0.27));

/**
 * The pumpkin (2026-10-28): a round body a little wider than tall, made of
 * three overlapping lobes (a middle one and one on each side), so its outline
 * dips softly where two lobes meet, like a pumpkin's ribs seen from the front.
 */
export const PUMPKIN_LOBES = [
  { x: 0, y: 0.02, rx: 0.6, ry: 0.84 },
  { x: -0.42, y: 0.06, rx: 0.6, ry: 0.76 },
  { x: 0.42, y: 0.06, rx: 0.6, ry: 0.76 },
] as const;

const pumpkin = () => radiiOf((x, y) => PUMPKIN_LOBES.some((lobe) => ((x - lobe.x) / lobe.rx) ** 2 + ((y - lobe.y) / lobe.ry) ** 2 <= 1));

/**
 * The pumpkin's stem: a short dark stalk standing in the dip on top, leaning
 * a little to the left (box units). Its foot sinks into the body (the body is
 * drawn over it), and it rides on the body's top radius, so it follows the
 * outline while it breathes, morphs or squashes.
 */
export const STEM = {
  /** Where the foot sits (R, from the top of the body) and where the tip ends, relative to the foot. */
  foot: { x: -0.1, sink: 0.16 },
  tip: { x: -0.15, y: -0.38 },
  /** How far the stalk bows to the right, R. */
  bow: 0.06,
  /** Half its width at the foot and at the tip, R. */
  width: { foot: 0.1, tip: 0.07 },
} as const;

export function stemPath(radii: Radii): string {
  const top = radiusAt(radii, 0);
  const foot: Point = [STEM.foot.x, -top + STEM.foot.sink];
  const tip: Point = [foot[0] + STEM.tip.x, foot[1] + STEM.tip.y];
  const control: Point = [(foot[0] + tip[0]) / 2 + STEM.bow, (foot[1] + tip[1]) / 2];
  const at = (t: number): Point => [
    (1 - t) ** 2 * foot[0] + 2 * (1 - t) * t * control[0] + t * t * tip[0],
    (1 - t) ** 2 * foot[1] + 2 * (1 - t) * t * control[1] + t * t * tip[1],
  ];
  const steps = [0, 0.35, 0.7, 1];
  const side = (sign: number) =>
    steps.map((t) => {
      const [x, y] = at(t);
      const [x2, y2] = at(Math.min(1, t + 0.01));
      const [x1, y1] = at(Math.max(0, t - 0.01));
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const half = STEM.width.foot + (STEM.width.tip - STEM.width.foot) * t;
      return [x + (-dy / len) * half * sign, y + (dx / len) * half * sign] as Point;
    });
  const left = side(1);
  const right = side(-1).reverse();
  const [tx, ty] = at(1);
  const [px, py] = at(0.97);
  const len = Math.hypot(tx - px, ty - py) || 1;
  // a round cap a little past the tip
  const cap: Point = [tx + ((tx - px) / len) * STEM.width.tip * 0.8, ty + ((ty - py) / len) * STEM.width.tip * 0.8];
  return smoothClosed([...left, cap, ...right].map(toBox));
}

/** The default color of a pumpkin where the skin takes the bot's color. */
export const PUMPKIN_HEX = "#e78531";
/** The stem's ink: a dark wood brown. */
export const STEM_INK = "#3b2a1c";

/** An egg: an ellipse, narrower at the top. */
const egg = () => radiiOf((x, y) => (x / (0.8 * (1 + 0.13 * y))) ** 2 + ((y - 0.02) / 1.04) ** 2 <= 1);

/** An exclamation mark's stroke: a tall capsule standing on the middle. */
const bar = () => radiiOf((x, y) => toSegment(x, y, 0, -0.82, 0, 0.18) <= 0.15);

/** Every body, in R units: the bloub tables and the pumpkin. */
export const SHAPE_RADII: Readonly<Record<MascotShape, Radii>> = {
  ...SHAPE_TABLES,
  pumpkin: pumpkin(),
};

/** The bodies some moves turn into. */
export const MOVE_RADII = {
  dot: circle(0.165),
  sleepDot: circle(0.16),
  burstDot: circle(0.166),
  cometDot: circle(0.13),
  egg: egg(),
  hexagon: hexagon(0),
  triangle: triangle(),
  bar: bar(),
} as const satisfies Record<string, Radii>;

/** One shape: its outline (box units) and where its face sits at rest. */
export interface ShapeArt {
  d: string;
  /** The middle between the two eyes at rest (box units). */
  face: Point;
}

export const SHAPE_ART: Record<MascotShape, ShapeArt> = Object.fromEntries(
  (Object.keys(SHAPE_RADII) as MascotShape[]).map((shape) => [shape, { d: outlinePath(SHAPE_RADII[shape]), face: [52, 50] as Point }]),
) as Record<MascotShape, ShapeArt>;

/**
 * The resting eye, as a half-size in box units (the app icon draws its
 * capsules from these): a rounded bar about 0.19 R wide and 0.41 R tall.
 */
export const EYES = {
  rx: (0.19 * BODY.unit) / 2,
  ry: (0.41 * BODY.unit) / 2,
  tilt: -13,
} as const;
