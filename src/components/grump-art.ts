// Grump's drawing, in a 0..100 box (src/components/GrumpMascot.tsx): the
// grumpy cat of direction C, "aplat net", approved by JC on 2026-10-09 with
// the Shiba (scratchpad others-c.mjs, export GRUMP). Two flat tones and a
// shade crescent per part, one uniform outline, geometric shapes: a cream
// body, dark markings (the mask with its light blaze, the ears, the tail)
// in the bot color, a white muzzle and chest, blue almond eyes slanted
// eight degrees with a slit pupil, a small pink nose and a mouth whose
// corners drop very low. The face is three layers that every expression
// swaps (the eyes, the brow capsules, the mouth) over a nose that never
// changes. Under 48 px the drawing is a bust.
//
// Everything here is data and pure functions, like shiba-art.ts (whose path
// helpers it shares): the parts as path strings and draw operations with
// paint roles (`GrumpRole`), so the component, the tests, the iOS export
// (ios-mascot-export.test.ts) and the keyframe renders read one geometry.
// Paths use absolute M L C Q Z only, so they move and mirror by their pairs.
//
// Poses (`GrumpStance`): `sit` is the approved art (a loaf of a body, paws
// folded in front, the tail along the bottom); `stand` is the walking body
// seen from the side (four two-segment legs, the tail up behind) under the
// same front-facing head; `lie` is the loaf, paws tucked; `curl` is the
// sleeping ball, the tail wrapped around the front and the head laid on it.
// The tail is a chain of segments (`tailPath`), so the rig in grump-moves.ts
// can wave it joint by joint.
import { contrastRatio } from "../../shared/mascot-colors";
import { ellipsePath, mapPairs, mirrorPath, mixColor, movePath, type Point } from "./shiba-art";

export { ellipsePath, mapPairs, mirrorPath, mixColor, movePath, type Point } from "./shiba-art";

/* ------------------------------------------------------------ helpers */

const r2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number) => String(r2(v));

/** A path turned `deg` degrees (clockwise on screen) about cx, cy. */
export function rotatePath(d: string, deg: number, cx: number, cy: number): string {
  if (!deg) return d;
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return mapPairs(d, (x, y) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
}

/** A rounded bean at x, y (the paws, as in the source). */
function pawPath(x: number, y: number, rx: number, ry: number): string {
  return (
    `M${fmt(x - rx)} ${fmt(y)}C${fmt(x - rx)} ${fmt(y - ry * 1.1)} ${fmt(x - rx * 0.5)} ${fmt(y - ry * 1.3)} ${fmt(x)} ${fmt(y - ry * 1.3)}` +
    `C${fmt(x + rx * 0.5)} ${fmt(y - ry * 1.3)} ${fmt(x + rx)} ${fmt(y - ry * 1.1)} ${fmt(x + rx)} ${fmt(y)}` +
    `C${fmt(x + rx)} ${fmt(y + ry * 0.8)} ${fmt(x + rx * 0.5)} ${fmt(y + ry)} ${fmt(x)} ${fmt(y + ry)}` +
    `C${fmt(x - rx * 0.5)} ${fmt(y + ry)} ${fmt(x - rx)} ${fmt(y + ry * 0.8)} ${fmt(x - rx)} ${fmt(y)}Z`
  );
}

/** A smooth open path through points (Catmull-Rom as cubic curves). */
export function smoothOpen(points: readonly Point[]): string {
  if (points.length < 2) return "";
  let d = `M${fmt(points[0][0])} ${fmt(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d;
}

/* ----------------------------------------------------------- geometry */

const EAR_L = "M17.5 46L17 22Q17.5 18.5 21 20L42 30Z";
const EAR_IN_L = "M21.5 39L21.5 26.5L33.5 31.5Z";

/** The approved parts (others-c.mjs GRUMP), plus the walking, lying and curled bodies. */
export const GRUMP_ART = {
  head: "M50 25C64 25 74 30.5 78 40C84 45.5 87.5 53 86.5 61C84.5 72 70.5 79 50 79C29.5 79 15.5 72 13.5 61C12.5 53 16 45.5 22 40C26 30.5 36 25 50 25Z",
  earL: EAR_L,
  earR: mirrorPath(EAR_L),
  earInL: EAR_IN_L,
  earInR: mirrorPath(EAR_IN_L),
  /** The dark mask, clipped to the head: its lower edge curves down under the eyes. */
  mask: "M8 24L92 24L92 55C85 60 76 61.5 69 58.5C64 56.5 60 53 56 53L44 53C40 53 36 56.5 31 58.5C24 61.5 15 60 8 55Z",
  /** The light blaze down the forehead. */
  blaze: "M46.6 24L53.4 24L51.6 44L50 49L48.4 44Z",
  /** The white muzzle and chin, one piece. */
  muzzle: "M50 50.5C55 50.5 58.5 53 60.5 56C67 56.5 71 60 70.5 64.5C70 71.5 63 76.5 50 77C37 76.5 30 71.5 29.5 64.5C29 60 33 56.5 39.5 56C41.5 53 45 50.5 50 50.5Z",
  /** Sitting: the wide low loaf, its white chest (clipped to it), the folded paws. */
  body: "M11 99C10 88 17 78.5 29 76C36 74.6 43 74.4 50 74.4C57 74.4 64 74.6 71 76C83 78.5 90 88 89 99Z",
  chest: "M36 76C34 84 35 91 39 99L61 99C65 91 66 84 64 76C58 79 42 79 36 76Z",
  paws: [pawPath(42.5, 95.6, 7.2, 3.8), pawPath(57.5, 95.6, 7.2, 3.8)] as const,
  /** Standing (facing right): a long body, the white chest and belly at the front. */
  standBody: "M27 62C40 59.5 57 59.5 68 62.5C77 65 81.5 71.5 80.5 78.5C79.5 85.5 74 89.5 66 89.5L31 89.5C22 89.5 16 85 16 77.5C16 69.5 19.5 63.5 27 62Z",
  standChest: "M61 70C69 67.5 80 71 81 78C81 85 76 89.5 68 89.5L46 89.5C53 85 55 74.5 61 70Z",
  /** Lying (the loaf, front view): low and wide, the paws tucked under, two toes showing. */
  lieBody: "M13 85C15 77 30 72.5 50 72.5C70 72.5 85 77 87 85C88.5 91 87 96 81 98.5L19 98.5C13 96 11.5 91 13 85Z",
  lieChest: "M35 75C32 82 33 91 37 99L63 99C67 91 68 82 65 75C59 78.5 41 78.5 35 75Z",
  liePaws: [pawPath(42, 97.4, 5.6, 2.4), pawPath(58, 97.4, 5.6, 2.4)] as const,
  /** Curled up asleep: a round cushion of a body. */
  curlBody: "M11 88C11 77 28 69.5 50 69.5C72 69.5 89 77 89 88C89 95.5 80 99 50 99C20 99 11 95.5 11 88Z",
  curlChest: "M20 84C24 92 36 98 50 98C38 95 28 90 26 82Z",
  /** The face's anchors (others-c.mjs). */
  eye: { y: 47.5, dx: 13, w: 6, h: 4.6, iris: 3.8, slant: 8 },
  brow: { y: 40.5, dx: 13, rx: 3.6, ry: 1.9 },
  nose: { y: 54.5, w: 6.4, h: 4.2 },
} as const;

/**
 * The tail at rest for each stance, as the joints of a chain (root first).
 * The sitting one follows the approved curve along the bottom, its root on
 * the right flank; the standing one rises behind in a loose hook.
 */
export const GRUMP_TAIL: Readonly<Record<GrumpStance, readonly Point[]>> = {
  sit: [
    [85.5, 83.5],
    [87.6, 89.4],
    [84.6, 93.4],
    [76.6, 95.2],
    [66, 94.6],
  ],
  stand: [
    [19, 68],
    [11.5, 64.5],
    [6.8, 57.6],
    [6.2, 49.6],
    [9.4, 43.6],
  ],
  lie: [
    [83, 92],
    [88.6, 95.2],
    [85.4, 98.4],
    [75, 99.2],
    [64, 98.6],
  ],
  curl: [
    [86, 88],
    [86.4, 95.2],
    [77, 99.6],
    [60, 100],
    [42, 98],
  ],
};

/**
 * The tail's points with each joint turned by `bend[i]` degrees on top of the
 * rest (a joint turns everything after it), so a wave runs root to tip.
 */
export function tailPoints(stance: GrumpStance, bend: readonly number[] = []): Point[] {
  const rest = GRUMP_TAIL[stance];
  const out: Point[] = [rest[0]];
  let turn = 0;
  for (let i = 1; i < rest.length; i += 1) {
    const [ax, ay] = rest[i - 1];
    const [bx, by] = rest[i];
    turn += bend[i - 1] ?? 0;
    const length = Math.hypot(bx - ax, by - ay);
    const angle = Math.atan2(by - ay, bx - ax) + (turn * Math.PI) / 180;
    const [px, py] = out[i - 1];
    out.push([px + Math.cos(angle) * length, py + Math.sin(angle) * length]);
  }
  return out;
}

/** The tail as one smooth stroke. */
export function tailPath(stance: GrumpStance, bend: readonly number[] = []): string {
  return smoothOpen(tailPoints(stance, bend));
}

/** How many joints a tail bends at. */
export const TAIL_JOINTS = 4;

/** Where each moving part turns (box units, in the sitting drawing). */
export const GRUMP_PIVOTS = {
  /** Each ear's base, hidden behind the head. */
  earL: [27, 38] as Point,
  earR: [73, 38] as Point,
  /** The neck: the head tilts and nods about it. */
  neck: [50, 76] as Point,
  /** The ground under the paws: squash, hops and the facing flip. */
  ground: [50, 98.5] as Point,
  eyeL: [37, 47.5] as Point,
  eyeR: [63, 47.5] as Point,
  mouth: [50, 64] as Point,
  /** The standing body's middle (the stretch rocks it about its back hips). */
  hipsBack: [26, 84] as Point,
} as const;

/** The standing body's hips (the legs hang from them), near and far side, facing right. */
export const GRUMP_HIPS = {
  frontNear: [65, 84] as Point,
  frontFar: [70.5, 82] as Point,
  backNear: [29, 84] as Point,
  backFar: [23, 82] as Point,
} as const;
export type GrumpLeg = keyof typeof GRUMP_HIPS;
export const GRUMP_LEGS = Object.keys(GRUMP_HIPS) as GrumpLeg[];
/** A standing leg: two segments (to the knee or hock, then to the paw), box units, and its thickness. */
export const GRUMP_LEG = { upper: 5.8, lower: 6.2, width: 7.2 } as const;

/** Where the head sits on each body: offset (box units), scale and turn (degrees) about the neck. The sitting art is the reference. */
export const GRUMP_STANCE_HEAD = {
  sit: { x: 0, y: 0, scale: 1, rot: 0 },
  stand: { x: 19, y: 1, scale: 0.72, rot: 0 },
  lie: { x: 0, y: 13, scale: 0.92, rot: 0 },
  curl: { x: -7, y: 17, scale: 0.84, rot: -10 },
} as const;
export type GrumpStance = "sit" | "stand" | "lie" | "curl";
export const GRUMP_STANCES = ["sit", "stand", "lie", "curl"] as const satisfies readonly GrumpStance[];

/** The bust crop: the box an avatar under 48 px shows (the head and ears). */
export const GRUMP_BUST = { x: 11, y: 14, w: 78, h: 78 } as const;
export const GRUMP_BUST_MAX = 48;

/** The outline width at a drawing size: 1.9 units, never under 1.6 screen px. */
export function grumpOutline(size: number): number {
  const box = size <= GRUMP_BUST_MAX ? GRUMP_BUST.w : 100;
  return r2(Math.max(1.9, (1.6 * box) / Math.max(1, size)));
}

/** Every outline at once, sitting (glows, auras, the hit area). */
export const GRUMP_SILHOUETTE = `${GRUMP_ART.earL} ${GRUMP_ART.earR} ${GRUMP_ART.body} ${GRUMP_ART.head}`;

/* -------------------------------------------------------------- colors */

/**
 * What every part is painted with; a skin maps each role to a paint
 * (skin-fx/grump-skins.tsx). `coat` is the markings (the mask, the ears, the
 * tail), `cream` the body fur, `muzzle` the white fur.
 */
export const GRUMP_ROLES = ["coat", "shade", "line", "cream", "creamShade", "muzzle", "muzzleShade", "blaze", "earIn", "brow", "lid", "white", "iris", "pupil", "ink", "spec", "mouth", "tongue", "tongueLine", "fang", "blush", "sweat", "nose"] as const;
export type GrumpRole = (typeof GRUMP_ROLES)[number];
export type GrumpPalette = Record<GrumpRole, string>;

const CREAM = "#F4E7CF";
const DARK = "#2a1a12";
/** The point markings are the bot color taken this far toward a dark brown (the approved colourpoint look). */
export const MASK_DEPTH = 0.42;
/** The least contrast between the markings and the cream fur before the markings are darkened further. */
export const MASK_MIN_CONTRAST = 2.2;
/** The color Grump shows where no bot gives one (the app icon, the gallery): a warm brown. */
export const GRUMP_DEFAULT_HEX = "#8B5E3C";

/**
 * The markings for a bot color: the color deepened like a colourpoint
 * cat's, and for a light one (white, butter, the pastels) darkened a little
 * more so the mask still reads against the cream fur.
 */
export function grumpMask(hex: string): string {
  let mask = mixColor(hex, DARK, MASK_DEPTH);
  for (let k = MASK_DEPTH + 0.04; k <= 0.8 && contrastRatio(mask, grumpCream(mask)) < MASK_MIN_CONTRAST; k += 0.04) mask = mixColor(hex, DARK, r2(k));
  return mask;
}

/** The cream fur, tinted by the markings. */
export function grumpCream(mask: string): string {
  return mixColor(CREAM, mask, 0.08);
}

/** The plain palette for a bot color (direction C's own tones). */
export function grumpPalette(hex: string): GrumpPalette {
  const coat = grumpMask(hex);
  const cream = grumpCream(coat);
  const light = mixColor(coat, CREAM, 0.55);
  return {
    coat,
    shade: mixColor(coat, "#120a06", 0.3),
    line: mixColor(coat, "#120a06", 0.62),
    cream,
    creamShade: mixColor("#E2CCA6", coat, 0.14),
    muzzle: "#FFFCF6",
    muzzleShade: mixColor("#EADFCF", coat, 0.06),
    blaze: cream,
    earIn: light,
    brow: light,
    lid: coat,
    white: "#ffffff",
    iris: "#7DB7E8",
    pupil: "#22170F",
    ink: "#22170F",
    spec: "#ffffff",
    mouth: "#4A1F1A",
    tongue: "#F07F86",
    tongueLine: "#C9545E",
    fang: "#ffffff",
    blush: "#F39A8C",
    sweat: "#9CD3F5",
    nose: "#C98686",
  };
}

/* ----------------------------------------------------------- draw ops */

/** One drawing operation: a path filled and/or stroked with roles, maybe clipped to another path. */
export interface GrumpOp {
  d: string;
  fill?: GrumpRole;
  stroke?: GrumpRole;
  width?: number;
  opacity?: number;
  /** Drawn clipped to this path. */
  clip?: string;
  /** Round caps (open strokes). */
  round?: boolean;
}

/** A part filled flat with a shade crescent: the shade, then the base moved up-left over it, clipped to the part. */
function shaded(d: string, base: GrumpRole, shade: GrumpRole, dx: number, dy: number): GrumpOp[] {
  return [
    { d, fill: shade },
    { d: movePath(d, dx, dy), fill: base, clip: d },
  ];
}

const outline = (d: string, width: number): GrumpOp => ({ d, stroke: "line", width });

/** Ops turned about a point (the slanted eyes). */
const rotateOps = (ops: GrumpOp[], deg: number, cx: number, cy: number): GrumpOp[] =>
  ops.map((op) => ({ ...op, d: rotatePath(op.d, deg, cx, cy), ...(op.clip ? { clip: rotatePath(op.clip, deg, cx, cy) } : {}) }));

/* ---------------------------------------------------------- expressions */

/**
 * The sixteen faces, the same ids as the Shapes (shape-engine.ts
 * SHAPE_EXPRESSIONS) so a state or a clip names one face for every
 * character. The approved moods are five of them: idle is neutral, happy is
 * happy, thinking is curious, alert is surprised, sleepy is sleepy. Grump is
 * grumpy at rest: half lids, brows pinched, the corners of the mouth low.
 */
export const GRUMP_EXPRESSIONS = ["neutral", "attentive", "surprised", "excited", "happy", "laughing", "angry", "sad", "scared", "suspicious", "confused", "curious", "proud", "shy", "bored", "sleepy"] as const;
export type GrumpExpression = (typeof GRUMP_EXPRESSIONS)[number];

/** The approved moods, by their expression. */
export const GRUMP_MOOD_EXPRESSION = { idle: "neutral", happy: "happy", thinking: "curious", alert: "surprised", sleepy: "sleepy" } as const satisfies Record<string, GrumpExpression>;

/** An open eye: where the iris looks (box units), how round the pupil is (0 a slit..1 round and wide), the lid (0 open..1 shut), its slope (+ inner corner down), the eye's size. */
export interface GrumpOpenEye {
  kind: "open";
  look: Point;
  dilate: number;
  lid: number;
  lidTilt: number;
  scale: number;
}
/** Closed eyes: a happy arch, a sleeping curve, a laughing squint. */
export type GrumpEyeSpec = GrumpOpenEye | { kind: "arch" } | { kind: "closed" } | { kind: "squint" };

/** The mouths: the approved five (grump, cat, side, o, pout) and the ones the other faces and the moves need. */
export const GRUMP_MOUTHS = ["grump", "cat", "side", "o", "pout", "flat", "wavy", "small", "smirk", "open", "fangs", "hiss", "yawn", "lick"] as const;
export type GrumpMouth = (typeof GRUMP_MOUTHS)[number];

export interface GrumpFace {
  eyes: readonly [GrumpEyeSpec, GrumpEyeSpec];
  /** Each brow capsule: rise (box units, - up) and turn (degrees). */
  brows: { l: Point; r: Point };
  mouth: GrumpMouth;
  blush?: boolean;
  sweat?: boolean;
  z?: boolean;
}

const open = (look: Point, dilate: number, lid: number, lidTilt = 0, scale = 1): GrumpOpenEye => ({ kind: "open", look, dilate, lid, lidTilt, scale });
const pair = (eye: GrumpEyeSpec, right: GrumpEyeSpec = eye) => [eye, right] as const;

export const GRUMP_FACES: Readonly<Record<GrumpExpression, GrumpFace>> = {
  // approved idle: half lids sloping out, pinched brows, the deep arc
  neutral: { eyes: pair(open([0, 0.4], 0, 0.36, -1.4)), brows: { l: [0, 22], r: [0, -22] }, mouth: "grump" },
  attentive: { eyes: pair(open([0, 0], 0.3, 0.12)), brows: { l: [-1.6, 8], r: [-1.6, -8] }, mouth: "pout" },
  // approved alert
  surprised: { eyes: pair(open([0, 0.2], 0.55, 0, 0, 1.16)), brows: { l: [-2.4, -6], r: [-2.4, 6] }, mouth: "o" },
  excited: { eyes: pair(open([0, -0.3], 1, 0, 0, 1.1)), brows: { l: [-3.2, -10], r: [-3.2, 10] }, mouth: "open" },
  // approved happy
  happy: { eyes: pair({ kind: "arch" }), brows: { l: [-1.2, 0], r: [-1.2, 0] }, mouth: "cat" },
  laughing: { eyes: pair({ kind: "squint" }), brows: { l: [-2.2, -12], r: [-2.2, 12] }, mouth: "open", blush: true },
  angry: { eyes: pair(open([0, 0.5], 0, 0.5, 2.6)), brows: { l: [1.6, 32], r: [1.6, -32] }, mouth: "fangs" },
  sad: { eyes: pair(open([0, 1.2], 0.5, 0.3, -2.4)), brows: { l: [-1.4, -22], r: [-1.4, 22] }, mouth: "pout" },
  scared: { eyes: pair(open([0, 0.3], 1, 0, 0, 1.12)), brows: { l: [-3.6, -18], r: [-3.6, 18] }, mouth: "wavy", sweat: true },
  suspicious: { eyes: pair(open([2.6, 0.3], 0, 0.56)), brows: { l: [1.2, 16], r: [-2.4, -2] }, mouth: "flat" },
  confused: { eyes: [open([1.2, 0], 0.3, 0.06, 0, 1.06), open([1.2, 0.4], 0.1, 0.42, 0.8, 0.94)], brows: { l: [-4, -16], r: [1, 12] }, mouth: "wavy" },
  // approved thinking
  curious: { eyes: pair(open([-1.6, -1], 0.3, 0.24, -0.8)), brows: { l: [-2.6, -10], r: [0.6, -20] }, mouth: "side" },
  proud: { eyes: pair(open([0, -1.2], 0, 0.5, -0.6)), brows: { l: [-2.4, -6], r: [-2.4, 6] }, mouth: "smirk" },
  shy: { eyes: pair(open([-2.4, 1.3], 0.6, 0.18)), brows: { l: [-1, -14], r: [-1, 14] }, mouth: "small", blush: true },
  bored: { eyes: pair(open([0, 0.8], 0, 0.62)), brows: { l: [1.2, 4], r: [1.2, -4] }, mouth: "flat" },
  // approved sleepy
  sleepy: { eyes: pair({ kind: "closed" }), brows: { l: [1, 14], r: [1, -14] }, mouth: "pout", z: true },
};

/* -------------------------------------------------------------- layers */

/** The almond of an open eye: the outer corner higher, the inner one rounder (the Shiba's almond). */
export function almondPath(cx: number, cy: number, s: number, w: number, h: number): string {
  const ox = cx + w * s;
  const ix = cx - w * s;
  return `M${fmt(ix)} ${fmt(cy + 0.8)}C${fmt(ix + 1.5 * s)} ${fmt(cy - h)} ${fmt(ox - 2.5 * s)} ${fmt(cy - h - 0.4)} ${fmt(ox)} ${fmt(cy - 1.2)}C${fmt(ox - 1.4 * s)} ${fmt(cy + h * 0.8)} ${fmt(ix + 2 * s)} ${fmt(cy + h * 0.9)} ${fmt(ix)} ${fmt(cy + 0.8)}Z`;
}

/**
 * One eye's ops; `s` is -1 for the left eye, 1 for the right. `blink`
 * closes an open eye further (0..1, the live blink); `lookAdd` moves the
 * iris on top of the face's own look (the gaze following something).
 */
export function grumpEyeOps(spec: GrumpEyeSpec, s: -1 | 1, ow: number, blink = 0, lookAdd: Point = [0, 0]): GrumpOp[] {
  const { eye } = GRUMP_ART;
  const cx = 50 + s * eye.dx;
  const cy = eye.y;
  const arcW = eye.w * 0.85;
  const arc = r2(ow * 1.25);
  const slant = s * -eye.slant;
  // the arcs stay level, as approved; only the open almond is slanted
  if (spec.kind === "arch") return [{ d: `M${fmt(cx - arcW)} ${fmt(cy + 1.6)}Q${fmt(cx)} ${fmt(cy - 4.6)} ${fmt(cx + arcW)} ${fmt(cy + 1.6)}`, stroke: "ink", width: arc, round: true }];
  if (spec.kind === "closed") return [{ d: `M${fmt(cx - arcW)} ${fmt(cy)}Q${fmt(cx)} ${fmt(cy + 3.8)} ${fmt(cx + arcW)} ${fmt(cy)}`, stroke: "ink", width: arc, round: true }];
  if (spec.kind === "squint") {
    // a chevron pointing toward the nose
    const tip = cx - s * 2.8;
    const back = cx + s * 3.2;
    return [{ d: `M${fmt(back)} ${fmt(cy - 3)}L${fmt(tip)} ${fmt(cy)}L${fmt(back)} ${fmt(cy + 3)}`, stroke: "ink", width: arc, round: true }];
  }
  const w = eye.w * spec.scale;
  const h = eye.h * spec.scale;
  const d = almondPath(cx, cy, s, w, h);
  const px = cx + spec.look[0] + lookAdd[0];
  const py = cy + spec.look[1] + lookAdd[1];
  const ir = eye.iris * spec.scale;
  // a slit narrows to a sliver; dilated, the pupil is a wide round disc
  const k = Math.max(0, Math.min(1, spec.dilate));
  const prx = ir * (0.2 + 0.52 * k);
  const pry = ir * (0.86 - 0.14 * k);
  const ops: GrumpOp[] = [
    { d, fill: "white" },
    { d: ellipsePath(px, py, ir, ir), fill: "iris", clip: d },
    { d: ellipsePath(px, py, prx, pry), fill: "pupil", clip: d },
    { d: ellipsePath(px + ir * 0.42, py - ir * 0.4, ir * 0.24, ir * 0.24), fill: "spec", clip: d },
  ];
  const lid = Math.min(1, spec.lid + (1 - spec.lid) * Math.max(0, Math.min(1, blink)));
  if (lid > 0) {
    const top = cy - h - 0.4;
    const lidY = top + lid * (2 * h + 0.8);
    const tilt = s * spec.lidTilt;
    const L = eye.w + 6;
    ops.push(
      { d: `M${fmt(cx - L)} ${fmt(top - 8)}L${fmt(cx + L)} ${fmt(top - 8)}L${fmt(cx + L)} ${fmt(lidY - tilt)}L${fmt(cx - L)} ${fmt(lidY + tilt)}Z`, fill: "lid", clip: d },
      { d: `M${fmt(cx - L)} ${fmt(lidY + tilt)}L${fmt(cx + L)} ${fmt(lidY - tilt)}`, stroke: "ink", width: ow, clip: d },
    );
  }
  ops.push({ d, stroke: "ink", width: ow });
  return rotateOps(ops, slant, cx, cy);
}

/** The two brow capsules. */
export function grumpBrowOps(face: GrumpFace): GrumpOp[] {
  const { brow } = GRUMP_ART;
  return ([-1, 1] as const).map((s) => {
    const [dy, rot] = s < 0 ? face.brows.l : face.brows.r;
    return { d: ellipsePath(50 + s * brow.dx, brow.y + dy, brow.rx, brow.ry, rot), fill: "brow" as const };
  });
}

/** The small pink nose, which every face shares. */
export function grumpNoseOps(ow: number): GrumpOp[] {
  const { y, w, h } = GRUMP_ART.nose;
  const d = `M${fmt(50 - w / 2)} ${fmt(y)}Q50 ${fmt(y - 1)} ${fmt(50 + w / 2)} ${fmt(y)}Q${fmt(50 + w * 0.2)} ${fmt(y + h)} 50 ${fmt(y + h)}Q${fmt(50 - w * 0.2)} ${fmt(y + h)} ${fmt(50 - w / 2)} ${fmt(y)}Z`;
  return [
    { d, fill: "nose", stroke: "ink", width: r2(ow * 0.8) },
    { d: ellipsePath(48.6, y + 0.9, 1.1, 0.6), fill: "spec", opacity: 0.5 },
  ];
}

/** The mouth: the line under the nose, then the mouth itself. */
export function grumpMouthOps(kind: GrumpMouth, ow: number): GrumpOp[] {
  const { y, h } = GRUMP_ART.nose;
  const line = (d: string, width = ow): GrumpOp => ({ d, stroke: "ink", width, round: true });
  const filled = (d: string): GrumpOp => ({ d, fill: "mouth", stroke: "ink", width: r2(ow * 0.9) });
  const ops: GrumpOp[] = [line(`M50 ${fmt(y + h)}L50 62`)];
  switch (kind) {
    case "grump":
      ops.push(line("M39.5 70.5Q42 62 50 62Q58 62 60.5 70.5"));
      break;
    case "cat":
      ops.push(line("M43 63.4Q46.5 66.4 50 62Q53.5 66.4 57 63.4"));
      break;
    case "side":
      ops.push(line("M43 67.6Q46 62.6 50 62.4Q55 62.8 58 65"));
      break;
    case "o":
      ops.push(filled(ellipsePath(50, 66, 2.6, 3)));
      break;
    case "pout":
      ops.push(line("M43 67Q46 62.6 50 62.4Q54 62.6 57 67"));
      break;
    case "flat":
      ops.push(line("M44.5 65.2Q50 63.6 55.5 65.2"));
      break;
    case "wavy":
      ops.push(line("M43.6 65.4Q45.4 63.8 47.2 65.4Q49 67 50.8 65.4Q52.6 63.8 54.4 65.4Q55.4 66.2 56.4 65.6"));
      break;
    case "small":
      ops.push(line("M47.4 64.4Q50 63 52.6 64.4"));
      break;
    case "smirk":
      ops.push(line("M44 65.6Q47 66.4 50 62.6Q54 65 57.4 61.8"));
      break;
    case "open": {
      const jaw = "M43.4 62.6Q50 64.4 56.6 62.6Q56.2 70.6 50 71Q43.8 70.6 43.4 62.6Z";
      ops.push(filled(jaw), { d: "M45.8 68Q50 65.2 54.2 68Q53.8 71.6 50 71.8Q46.2 71.6 45.8 68Z", fill: "tongue", clip: jaw }, { d: jaw, stroke: "ink", width: r2(ow * 0.9) });
      break;
    }
    case "fangs":
      // the deep arc with two small fangs at its peak
      ops.push(line("M40 70.5Q42.4 62.4 50 62.4Q57.6 62.4 60 70.5"), { d: "M45 64.2L46.6 67.4L48 63.2Z", fill: "fang", stroke: "ink", width: r2(ow * 0.6) }, { d: "M55 64.2L53.4 67.4L52 63.2Z", fill: "fang", stroke: "ink", width: r2(ow * 0.6) });
      break;
    case "hiss": {
      // wide open, corners pulled back, the four fangs out
      const jaw = "M39 62.4Q44 61 50 63Q56 61 61 62.4Q59.6 73.4 50 74Q40.4 73.4 39 62.4Z";
      ops.push(
        filled(jaw),
        { d: "M44.4 70.6Q50 67.4 55.6 70.6Q54.6 74.4 50 74.4Q45.4 74.4 44.4 70.6Z", fill: "tongue", clip: jaw },
        { d: "M42.4 63L43.8 67.8L45.4 63.4Z", fill: "fang", clip: jaw },
        { d: "M57.6 63L56.2 67.8L54.6 63.4Z", fill: "fang", clip: jaw },
        { d: "M43.6 73L44.8 69.6L46.2 73.2Z", fill: "fang", clip: jaw },
        { d: "M56.4 73L55.2 69.6L53.8 73.2Z", fill: "fang", clip: jaw },
        { d: jaw, stroke: "ink", width: r2(ow * 0.9) },
      );
      break;
    }
    case "yawn": {
      // a tall open oval, the tongue curled at its floor
      const jaw = "M44 63Q50 61.6 56 63Q57.4 71 55 75.4Q50 79 45 75.4Q42.6 71 44 63Z";
      ops.push(filled(jaw), { d: "M45 73.2Q50 69.6 55 73.2Q53.6 77.6 50 77.8Q46.4 77.6 45 73.2Z", fill: "tongue", clip: jaw }, { d: "M45.6 63.2L46.4 66L47.6 63Z", fill: "fang", clip: jaw }, { d: "M54.4 63.2L53.6 66L52.4 63Z", fill: "fang", clip: jaw }, { d: jaw, stroke: "ink", width: r2(ow * 0.9) });
      break;
    }
    case "lick":
      // the cat mouth with the tongue tip out (grooming)
      ops.push({ d: "M47.6 64.2Q50 63 52.4 64.2Q52.6 68.6 50 68.8Q47.4 68.6 47.6 64.2Z", fill: "tongue", stroke: "ink", width: r2(ow * 0.7) }, { d: "M50 64.4L50 67.4", stroke: "tongueLine", width: 0.7 }, line("M43 63.4Q46.5 66.4 50 62Q53.5 66.4 57 63.4"));
      break;
  }
  return ops;
}

/** What a face adds: blush, a sweat drop, the sleeping z. */
export function grumpExtraOps(face: GrumpFace, ow: number, bust: boolean): GrumpOp[] {
  const ops: GrumpOp[] = [];
  if (face.blush) for (const s of [-1, 1]) ops.push({ d: ellipsePath(50 + s * 15.5, 64, 3.6, 2), fill: "blush", opacity: 0.55 });
  if (face.sweat) ops.push({ d: "M80 33C80 33 77.4 37 77.4 38.8C77.4 40.4 78.6 41.5 80 41.5C81.4 41.5 82.6 40.4 82.6 38.8C82.6 37 80 33 80 33Z", fill: "sweat", stroke: "line", width: r2(ow * 0.6) });
  if (face.z && !bust) {
    const z = "M80 11L86 11L80 18L86 18";
    ops.push({ d: z, stroke: "line", width: 3.6, round: true }, { d: z, stroke: "cream", width: 1.8, round: true });
  }
  return ops;
}

/** The tail as a stroke: the outline, then the markings. */
export function grumpTailOps(d: string, ow: number): GrumpOp[] {
  const tw = r2(6 + 2 * ow);
  return [
    { d, stroke: "line", width: tw, round: true },
    { d, stroke: "coat", width: r2(tw - 2 * ow), round: true },
  ];
}

/** Where a standing leg's knee (or hock) and paw are for a hip angle (+ forward) and a bend at the joint (degrees, + folds the paw), from its hip (moved with the body when the torso tilts or crouches). */
export function legJoints(leg: GrumpLeg, hip: number, bend: number, hipAt: Point = GRUMP_HIPS[leg]): { hip: Point; knee: Point; paw: Point } {
  const [hx, hy] = hipAt;
  const a = (hip * Math.PI) / 180;
  const knee: Point = [hx + Math.sin(a) * GRUMP_LEG.upper, hy + Math.cos(a) * GRUMP_LEG.upper];
  // a front leg's wrist folds the paw back; a hind leg's hock folds it forward
  const front = leg.startsWith("front");
  const b = a + ((front ? -bend : bend) * Math.PI) / 180;
  const paw: Point = [knee[0] + Math.sin(b) * GRUMP_LEG.lower, knee[1] + Math.cos(b) * GRUMP_LEG.lower];
  return { hip: [hx, hy], knee, paw };
}

/** One standing leg: hip, joint, paw; the far legs in the shade tone, a white sock at the paw. */
export function grumpLegOps(leg: GrumpLeg, hip: number, bend: number, ow: number, hipAt?: Point): GrumpOp[] {
  const far = leg.endsWith("Far");
  const j = legJoints(leg, hip, bend, hipAt);
  const d = `M${fmt(j.hip[0])} ${fmt(j.hip[1])}L${fmt(j.knee[0])} ${fmt(j.knee[1])}L${fmt(j.paw[0])} ${fmt(j.paw[1])}`;
  const paw = ellipsePath(j.paw[0] + 1, j.paw[1] + 0.4, 4.2, 2.6);
  return [
    { d, stroke: "line", width: r2(GRUMP_LEG.width + 2 * ow), round: true },
    { d, stroke: far ? "creamShade" : "cream", width: GRUMP_LEG.width, round: true },
    { d: paw, fill: far ? "muzzleShade" : "muzzle", stroke: "line", width: ow },
  ];
}

export interface GrumpPartsInput {
  expression: GrumpExpression;
  /** A move's own mouth (the hiss, the yawn, the lick) over the face's. */
  mouth?: GrumpMouth | null;
  stance?: GrumpStance;
  /** The tail's joints bent (degrees, root first) on top of its rest. */
  tailBend?: readonly number[];
  /** The live blink (0 open..1 shut) and the gaze offset on top of the face. */
  blink?: number;
  look?: Point;
  /** The drawing's size in px: the outline and the bust crop follow it. */
  size: number;
}

/** The drawing's parts as ops, each a group the rig moves on its own. */
export interface GrumpParts {
  tail: GrumpOp[];
  body: GrumpOp[];
  paws: GrumpOp[];
  earL: GrumpOp[];
  earR: GrumpOp[];
  head: GrumpOp[];
  brows: GrumpOp[];
  eyeL: GrumpOp[];
  eyeR: GrumpOp[];
  nose: GrumpOp[];
  mouth: GrumpOp[];
  extras: GrumpOp[];
}

/** The order the groups are drawn in, per stance (the head group is the ears, the head and the face). */
export const GRUMP_ORDER: Readonly<Record<GrumpStance, readonly ("tail" | "body" | "paws" | "legsFar" | "legsNear" | "head")[]>> = {
  // the tail lies over the loaf and under the folded paws
  sit: ["body", "tail", "paws", "head"],
  stand: ["tail", "legsFar", "body", "legsNear", "head"],
  lie: ["body", "tail", "paws", "head"],
  curl: ["body", "paws", "tail", "head"],
};

/** The body and its paws for a stance. */
function bodyOps(stance: GrumpStance, ow: number): { body: GrumpOp[]; paws: GrumpOp[] } {
  const A = GRUMP_ART;
  const pawsOf = (list: readonly string[]) => list.flatMap((d) => [...shaded(d, "muzzle", "muzzleShade", -1, -1), outline(d, ow)]);
  const loaf = (body: string, chest: string, dx: number, dy: number) => [...shaded(body, "cream", "creamShade", dx, dy), ...shaded(chest, "muzzle", "muzzleShade", -2, -1).map((op) => ({ ...op, clip: body })), outline(body, ow)];
  if (stance === "stand") return { body: loaf(A.standBody, A.standChest, -2, -2.4), paws: [] };
  if (stance === "lie") return { body: loaf(A.lieBody, A.lieChest, -3, -1.4), paws: pawsOf(A.liePaws) };
  if (stance === "curl") return { body: loaf(A.curlBody, A.curlChest, -3, -2), paws: [] };
  return { body: loaf(A.body, A.chest, -3, -1), paws: pawsOf(A.paws) };
}

export function grumpParts(input: GrumpPartsInput): GrumpParts {
  const A = GRUMP_ART;
  const bust = input.size <= GRUMP_BUST_MAX;
  const ow = grumpOutline(input.size);
  const face = GRUMP_FACES[input.expression] ?? GRUMP_FACES.neutral;
  const stance = input.stance ?? "sit";
  const ear = (d: string, inner: string, dx: number): GrumpOp[] => [...shaded(d, "coat", "shade", dx, -1), { d: inner, fill: "earIn" }, outline(d, ow)];
  const { body, paws } = bodyOps(stance, ow);
  const look = input.look ?? [0, 0];
  const blink = input.blink ?? 0;
  return {
    tail: bust ? [] : grumpTailOps(tailPath(stance, input.tailBend), ow),
    body,
    paws,
    earL: ear(A.earL, A.earInL, 1.5),
    earR: ear(A.earR, A.earInR, -1.5),
    head: [
      ...shaded(A.head, "cream", "creamShade", -2.6, -3.4),
      ...shaded(A.mask, "coat", "shade", -1.8, -2.4).map((op) => ({ ...op, clip: A.head })),
      { d: A.blaze, fill: "blaze", clip: A.head },
      ...shaded(A.muzzle, "muzzle", "muzzleShade", -1.4, -1.8).map((op) => ({ ...op, clip: A.head })),
      outline(A.head, ow),
    ],
    brows: grumpBrowOps(face),
    eyeL: grumpEyeOps(face.eyes[0], -1, ow, blink, look),
    eyeR: grumpEyeOps(face.eyes[1], 1, ow, blink, look),
    nose: grumpNoseOps(ow),
    mouth: grumpMouthOps(input.mouth ?? face.mouth, ow),
    extras: grumpExtraOps(face, ow, bust),
  };
}

/** The viewBox for a size: the whole box, or the bust under 48 px. */
export function grumpViewBox(size: number): string {
  return size <= GRUMP_BUST_MAX ? `${GRUMP_BUST.x} ${GRUMP_BUST.y} ${GRUMP_BUST.w} ${GRUMP_BUST.h}` : "0 0 100 100";
}

/* --------------------------------------------------------------- SVG out */

/** Ops as SVG markup with a palette (tests, the iOS export's checks, the keyframe renders). `uid` keeps clip ids apart. */
export function grumpOpsToSvg(ops: readonly GrumpOp[], palette: GrumpPalette, uid: string): string {
  let n = 0;
  return ops
    .map((op) => {
      const attrs = [`d="${op.d}"`, `fill="${op.fill ? palette[op.fill] : "none"}"`];
      if (op.stroke) attrs.push(`stroke="${palette[op.stroke]}"`, `stroke-width="${op.width ?? 1}"`, `stroke-linejoin="round"`, `stroke-linecap="${op.round ? "round" : "butt"}"`);
      if (op.opacity !== undefined) attrs.push(`opacity="${op.opacity}"`);
      const path = `<path ${attrs.join(" ")}/>`;
      if (!op.clip) return path;
      const id = `${uid}c${(n += 1)}`;
      return `<clipPath id="${id}"><path d="${op.clip}"/></clipPath><g clip-path="url(#${id})">${path}</g>`;
    })
    .join("");
}

/** The head group's transform for a stance (about the neck), as an SVG attribute value, or "" at rest. */
export function grumpHeadTransform(stance: GrumpStance): string {
  const head = GRUMP_STANCE_HEAD[stance];
  if (head.scale === 1 && !head.x && !head.y && !head.rot) return "";
  const [nx, ny] = GRUMP_PIVOTS.neck;
  return `translate(${head.x} ${head.y}) rotate(${head.rot} ${nx} ${ny}) translate(${nx} ${ny}) scale(${head.scale}) translate(${-nx} ${-ny})`;
}

/** The whole still drawing as one SVG string, sitting at rest (or in another stance). */
export function grumpStillSvg(options: { color: string; expression?: GrumpExpression; size: number; stance?: GrumpStance; uid?: string; palette?: GrumpPalette }): string {
  const palette = options.palette ?? grumpPalette(options.color);
  const stance = options.stance ?? "sit";
  const parts = grumpParts({ expression: options.expression ?? "neutral", size: options.size, stance });
  const uid = options.uid ?? "grump";
  const transform = grumpHeadTransform(stance);
  const draw = (ops: GrumpOp[], key: string) => grumpOpsToSvg(ops, palette, `${uid}${key}`);
  const ow = grumpOutline(options.size);
  const face = (["brows", "eyeL", "eyeR", "nose", "mouth", "extras"] as const).map((key) => draw(parts[key], key)).join("");
  const legs = (side: "Far" | "Near") => GRUMP_LEGS.filter((leg) => leg.endsWith(side)).map((leg) => draw(grumpLegOps(leg, 0, 0, ow), leg)).join("");
  const group = {
    tail: () => draw(parts.tail, "t"),
    body: () => draw(parts.body, "b"),
    paws: () => draw(parts.paws, "p"),
    legsFar: () => legs("Far"),
    legsNear: () => legs("Near"),
    head: () => `<g${transform ? ` transform="${transform}"` : ""}>${draw(parts.earL, "el")}${draw(parts.earR, "er")}${draw(parts.head, "h")}${face}</g>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${grumpViewBox(options.size)}" width="${options.size}" height="${options.size}">${GRUMP_ORDER[stance].map((key) => group[key]()).join("")}</svg>`;
}
