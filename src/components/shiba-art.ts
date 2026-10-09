// Shiba's drawing, in a 0..100 box (src/components/ShibaMascot.tsx): direction
// C, "aplat net", approved by JC on 2026-10-09. Two flat tones (the coat and
// the cream mask) plus one shade tone in a crescent, one uniform outline on
// the silhouette and the features alike, geometric shapes. The body sits; the
// face is three layers that every expression swaps (the eyes, the brow spots,
// the mouth) over a nose that never changes. Under 48 px the drawing is a
// bust (the box crops to the head and the tail is left out).
//
// Everything here is data and pure functions: the parts as path strings and
// draw operations with paint roles (`ShibaRole`), so the component, the
// tests, the iOS export (ios-mascot-export.test.ts) and the keyframe renders
// read the same geometry. Paths use absolute M L C Q Z only, so they move and
// mirror by their coordinate pairs.
//
// Poses: `sit` is the approved art; `stand` is the walking body seen from the
// side (four legs, the curled tail on the back) under the same front-facing
// head, the usual chibi walk; `lie` is the loaf for naps. The rig in
// shiba-moves.ts moves the parts about the pivots below.
import { contrastRatio } from "../../shared/mascot-colors";

/* ------------------------------------------------------------ helpers */

export type Point = readonly [number, number];

const r2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number) => String(r2(v));

/** Every x y pair of an absolute M L C Q path, moved by `fn`. */
export function mapPairs(d: string, fn: (x: number, y: number) => Point): string {
  return d.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => {
    const [a, b] = fn(Number(x), Number(y));
    return `${fmt(a)} ${fmt(b)}`;
  });
}

/** A path mirrored across the box's middle (the right ear from the left one). */
export const mirrorPath = (d: string) => mapPairs(d, (x, y) => [100 - x, y]);
/** A path moved by dx, dy. */
export const movePath = (d: string, dx: number, dy: number) => mapPairs(d, (x, y) => [x + dx, y + dy]);

/** An ellipse as four cubic curves (no arcs: it moves and mirrors like every other part), turned `rot` degrees. */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number, rot = 0): string {
  const k = 0.5523;
  const a = (rot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const p = (x: number, y: number) => `${fmt(cx + x * c - y * s)} ${fmt(cy + x * s + y * c)}`;
  return (
    `M${p(rx, 0)}C${p(rx, k * ry)} ${p(k * rx, ry)} ${p(0, ry)}C${p(-k * rx, ry)} ${p(-rx, k * ry)} ${p(-rx, 0)}` +
    `C${p(-rx, -k * ry)} ${p(-k * rx, -ry)} ${p(0, -ry)}C${p(k * rx, -ry)} ${p(rx, -k * ry)} ${p(rx, 0)}Z`
  );
}

/** Two #rrggbb colors blended (t 0..1). */
export function mixColor(a: string, b: string, t: number): string {
  const x = Number.parseInt(a.slice(1, 7), 16);
  const y = Number.parseInt(b.slice(1, 7), 16);
  const ch = (shift: number) => Math.round(((x >> shift) & 255) * (1 - t) + ((y >> shift) & 255) * t);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

/* ----------------------------------------------------------- geometry */

/** A paw: a rounded bean at x, y. */
function pawPath(x: number, y: number, rx: number, ry: number): string {
  return (
    `M${fmt(x - rx)} ${fmt(y)}C${fmt(x - rx)} ${fmt(y - ry * 1.1)} ${fmt(x - rx * 0.5)} ${fmt(y - ry * 1.3)} ${fmt(x)} ${fmt(y - ry * 1.3)}` +
    `C${fmt(x + rx * 0.5)} ${fmt(y - ry * 1.3)} ${fmt(x + rx)} ${fmt(y - ry * 1.1)} ${fmt(x + rx)} ${fmt(y)}` +
    `C${fmt(x + rx)} ${fmt(y + ry * 0.8)} ${fmt(x + rx * 0.5)} ${fmt(y + ry)} ${fmt(x)} ${fmt(y + ry)}` +
    `C${fmt(x - rx * 0.5)} ${fmt(y + ry)} ${fmt(x - rx)} ${fmt(y + ry * 0.8)} ${fmt(x - rx)} ${fmt(y)}Z`
  );
}

const EAR_L = "M23 43L26.5 16.5Q27.5 13.5 30.5 15.5L46 27.5Z";
const EAR_IN_L = "M27.5 35L29.5 21L39.5 29Z";

/** Direction C's parts (scratchpad v3.mjs, the `C` geometry over `BASE`). */
export const SHIBA_ART = {
  head: "M50 21.5C64 21.5 73.5 29 76.5 40C81.5 45 84 52 82.5 60C80 71 68 77.5 50 77.5C32 77.5 20 71 17.5 60C16 52 18.5 45 23.5 40C26.5 29 36 21.5 50 21.5Z",
  earL: EAR_L,
  earR: mirrorPath(EAR_L),
  earInL: EAR_IN_L,
  earInR: mirrorPath(EAR_IN_L),
  /** The cream mask: muzzle, cheeks and the brow line, clipped to the head. */
  mask: "M18.5 57C21 51 30 49.5 37 52.5C41.5 54.5 44 50 46 45.5C47.4 42.6 48.6 41.8 50 41.8C51.4 41.8 52.6 42.6 54 45.5C56 50 58.5 54.5 63 52.5C70 49.5 79 51 81.5 57C84 66 76 76 64 78C59.5 78.8 54.8 79 50 79C45.2 79 40.5 78.8 36 78C24 76 16 66 18.5 57Z",
  /** Sitting: the body, its cream chest (clipped to it), the two front paws. */
  body: "M29 70C24 77 21.5 86 22.5 93C23 97 26 98.5 30 98.5L70 98.5C74 98.5 77 97 77.5 93C78.5 86 76 77 71 70Z",
  chest: "M37 72C34.5 80 35.5 90 41 99L59 99C64.5 90 65.5 80 63 72C58.5 76 41.5 76 37 72Z",
  paws: [pawPath(40, 95, 6.5, 4.5), pawPath(60, 95, 6.5, 4.5)] as const,
  /** The curled tail beside the sitting body, a thick stroke; its cream underside. */
  tail: "M73 92C80 94 88 89 88.5 81C89 74 83 70.5 78.5 72.5C74.5 74.5 75 80 78.5 81.5C81 82.5 82.5 80.5 82 79",
  tailCream: "M76 86C81 87 85.5 84 86 79.5",
  /** Standing (facing right): a loaf of a body with its cream chest at the front, the tail curled over the back. */
  standBody: "M24 60.5C34 57.5 56 57.5 66 60.5C74 63 77.5 69 76.5 75.5C75.5 82.5 71 86 64 86L26 86C19 86 14.5 82.5 14 75.5C13.5 68 17 62.5 24 60.5Z",
  standChest: "M56 64C64 62.5 74 65.5 76.5 72.5C77 80 72.5 86 66 86L44 86C47 80 50 69 56 64Z",
  standTail: "M19 66C10.5 63.5 7 54 12.5 48.5C17 44 24.5 46 24.5 52C24.5 56 20.5 57.5 18.5 55",
  standTailCream: "M15.5 61C11.5 58.5 10.5 54 12 51",
  /** Lying (a loaf, front view): the low body, its chest, the front paws stretched out, the tail around on the ground. */
  lieBody: "M13 84C15 76.5 30 73 50 73C70 73 85 76.5 87 84C88.5 90.5 87 96 81 98.5L19 98.5C13 96 11.5 90.5 13 84Z",
  lieChest: "M34 76C31 83 32 92 36 99L64 99C68 92 69 83 66 76C60 79 40 79 34 76Z",
  liePaws: [pawPath(36, 96.6, 7.6, 3.4), pawPath(64, 96.6, 7.6, 3.4)] as const,
  lieTail: "M80 96.5C87.5 98.5 94.5 95.5 95 90C95.5 86 91.5 84 89 86",
  /** The face's anchors (v3 BASE). */
  eye: { y: 46.5, dx: 11.5, w: 5.4, h: 4.4 },
  brow: { y: 39.2, dx: 12.5, rx: 3.5, ry: 2.3 },
  nose: { y: 53, w: 8.8, h: 6 },
} as const;

/** Where each moving part turns (box units, in the sitting drawing). */
export const SHIBA_PIVOTS = {
  /** The tail's root, beside the sitting body; the standing tail's root on the back. */
  tail: [74, 91.5] as Point,
  standTail: [19, 66] as Point,
  lieTail: [80, 96.5] as Point,
  /** Each ear's base, hidden behind the head. */
  earL: [34, 36] as Point,
  earR: [66, 36] as Point,
  /** The neck: the head tilts and nods about it. */
  neck: [50, 74] as Point,
  /** The ground under the paws: squash, hops and the facing flip. */
  ground: [50, 98.5] as Point,
  eyeL: [38.5, 46.5] as Point,
  eyeR: [61.5, 46.5] as Point,
  mouth: [50, 62] as Point,
  /** The front paws' middles, sitting and lying (the wave lifts the right one). */
  pawL: [40, 95] as Point,
  pawR: [60, 95] as Point,
} as const;

/** The standing body's hips (the legs hang from them), near and far side, facing right. */
export const SHIBA_HIPS = {
  frontNear: [62, 80] as Point,
  frontFar: [68, 78] as Point,
  backNear: [27, 80] as Point,
  backFar: [21, 78] as Point,
} as const;
export type ShibaLeg = keyof typeof SHIBA_HIPS;
export const SHIBA_LEGS = Object.keys(SHIBA_HIPS) as ShibaLeg[];
/** A standing leg's length to the middle of its paw, box units; its thickness. */
export const LEG = { length: 14, width: 7.4 } as const;

/** Where the head sits on each body: offset (box units) and scale about the neck. The sitting art is the reference. */
export const STANCE_HEAD = {
  sit: { x: 0, y: 0, scale: 1 },
  stand: { x: 19, y: -4, scale: 0.78 },
  lie: { x: 0, y: 15, scale: 0.9 },
} as const;
export type ShibaStance = keyof typeof STANCE_HEAD;

/** The bust crop: the box an avatar under 48 px shows (the head and ears). */
export const SHIBA_BUST = { x: 16, y: 12, w: 68, h: 68 } as const;
export const SHIBA_BUST_MAX = 48;

/** The outline width at a drawing size: 1.9 units, never under 1.6 screen px. */
export function shibaOutline(size: number): number {
  const box = size <= SHIBA_BUST_MAX ? SHIBA_BUST.w : 100;
  return r2(Math.max(1.9, (1.6 * box) / Math.max(1, size)));
}

/** Every outline at once, sitting (glows, auras, the hit area). */
export const SHIBA_SILHOUETTE = `${SHIBA_ART.earL} ${SHIBA_ART.earR} ${SHIBA_ART.body} ${SHIBA_ART.head}`;

/* -------------------------------------------------------------- colors */

/**
 * What every part is painted with; a skin maps each role to a paint (shiba
 * skins in skin-fx/shiba-skins.tsx). `coat` may be a gradient; `lid` is the
 * coat as one solid color (the eyelids, and the strokes of the legs and tail).
 */
export const SHIBA_ROLES = ["coat", "shade", "line", "cream", "creamShade", "earIn", "brow", "lid", "ink", "pupil", "white", "spec", "mouth", "tongue", "tongueLine", "blush", "sweat", "nose"] as const;
export type ShibaRole = (typeof SHIBA_ROLES)[number];
export type ShibaPalette = Record<ShibaRole, string>;

const CREAM = "#FFF4E2";
/** The least contrast between the coat and the cream mask before the coat is darkened. */
export const COAT_MIN_CONTRAST = 1.5;

/**
 * The coat for a bot color: the color itself, or for a light one (white,
 * cream, the pastels) the same hue darkened just enough that the cream mask
 * still reads against it.
 */
export function shibaCoat(hex: string): string {
  let coat = hex;
  for (let k = 0.04; k <= 0.6 && contrastRatio(coat, mixColor(CREAM, coat, 0.06)) < COAT_MIN_CONTRAST; k += 0.04) coat = mixColor(hex, "#000000", r2(k));
  return coat;
}

/** The plain palette for a coat color (direction C's own tones). */
export function shibaPalette(hex: string): ShibaPalette {
  const coat = shibaCoat(hex);
  const cream = mixColor(CREAM, coat, 0.06);
  return {
    coat,
    shade: mixColor(coat, "#5a2a10", 0.22),
    line: mixColor(coat, "#2a1408", 0.74),
    cream,
    creamShade: mixColor("#F0D8BA", coat, 0.14),
    earIn: cream,
    brow: cream,
    lid: coat,
    ink: "#2B1A12",
    pupil: "#2B1A12",
    white: "#ffffff",
    spec: "#ffffff",
    mouth: "#4A1F1A",
    tongue: "#F07F86",
    tongueLine: "#C9545E",
    blush: "#F39A8C",
    sweat: "#9CD3F5",
    nose: "#2B1A12",
  };
}

/* ----------------------------------------------------------- draw ops */

/** One drawing operation: a path filled and/or stroked with roles, maybe clipped to another path. */
export interface ShibaOp {
  d: string;
  fill?: ShibaRole;
  stroke?: ShibaRole;
  width?: number;
  opacity?: number;
  /** Drawn clipped to this path. */
  clip?: string;
  /** Round caps (open strokes). */
  round?: boolean;
}

/** A part filled flat with a shade crescent: the shade, then the base moved up-left over it, clipped to the part. */
function shaded(d: string, base: ShibaRole, shade: ShibaRole, dx: number, dy: number): ShibaOp[] {
  return [
    { d, fill: shade },
    { d: movePath(d, dx, dy), fill: base, clip: d },
  ];
}

const outline = (d: string, width: number): ShibaOp => ({ d, stroke: "line", width });

/* ---------------------------------------------------------- expressions */

/**
 * The sixteen faces, the same ids as the Shapes (shape-engine.ts
 * SHAPE_EXPRESSIONS) so a state or a clip names one face for every
 * character. The v3 moods are five of them: idle is neutral, happy is happy,
 * thinking is curious, alert is surprised, sleepy is sleepy.
 */
export const SHIBA_EXPRESSIONS = ["neutral", "attentive", "surprised", "excited", "happy", "laughing", "angry", "sad", "scared", "suspicious", "confused", "curious", "proud", "shy", "bored", "sleepy"] as const;
export type ShibaExpression = (typeof SHIBA_EXPRESSIONS)[number];

/** The v3 moods, by their expression. */
export const SHIBA_MOOD_EXPRESSION = { idle: "neutral", happy: "happy", thinking: "curious", alert: "surprised", sleepy: "sleepy" } as const satisfies Record<string, ShibaExpression>;

/** An open eye: where the pupil looks (box units), its radius, the lid (0 open..1 shut), how the lid slopes (+ inner corner down), the eye's size. */
export interface OpenEye {
  kind: "open";
  look: Point;
  pupil: number;
  lid: number;
  lidTilt: number;
  scale: number;
}
/** Closed eyes: a happy arch, a sleeping curve, a laughing squint. */
export type EyeSpec = OpenEye | { kind: "arch" } | { kind: "closed" } | { kind: "squint" };

export const MOUTHS = ["smirk", "open", "flat", "o", "w", "grin", "frown", "wavy", "small", "bark", "pant"] as const;
export type MouthKind = (typeof MOUTHS)[number];

export interface ShibaFace {
  eyes: readonly [EyeSpec, EyeSpec];
  /** Each brow spot: rise (box units, - up) and turn (degrees). */
  brows: { l: Point; r: Point };
  mouth: MouthKind;
  blush?: boolean;
  sweat?: boolean;
  z?: boolean;
}

const open = (look: Point, pupil: number, lid: number, lidTilt = 0, scale = 1): OpenEye => ({ kind: "open", look, pupil, lid, lidTilt, scale });
const pair = (eye: EyeSpec, right: EyeSpec = eye) => [eye, right] as const;

export const SHIBA_FACES: Readonly<Record<ShibaExpression, ShibaFace>> = {
  // v3 idle: the side glance, one brow up, the smirk
  neutral: { eyes: pair(open([2.8, 0.2], 2.7, 0.3, -0.6)), brows: { l: [0.4, -4], r: [-5.2, 22] }, mouth: "smirk" },
  attentive: { eyes: pair(open([0, 0.2], 2.8, 0.06)), brows: { l: [-2, -5], r: [-2, 5] }, mouth: "w" },
  // v3 alert
  surprised: { eyes: pair(open([0, 0.2], 2.9, 0, 0, 1.16)), brows: { l: [-3, -6], r: [-3, 6] }, mouth: "o" },
  excited: { eyes: pair(open([0, -0.4], 3.1, 0, 0, 1.1)), brows: { l: [-3.6, -9], r: [-3.6, 9] }, mouth: "open" },
  // v3 happy
  happy: { eyes: pair({ kind: "arch" }), brows: { l: [-1.2, 0], r: [-1.2, 0] }, mouth: "open" },
  laughing: { eyes: pair({ kind: "squint" }), brows: { l: [-2.2, -12], r: [-2.2, 12] }, mouth: "grin", blush: true },
  angry: { eyes: pair(open([0, 0.6], 2.5, 0.42, 2.4)), brows: { l: [1.4, 26], r: [1.4, -26] }, mouth: "frown" },
  sad: { eyes: pair(open([0, 1.3], 2.6, 0.26, -2.2)), brows: { l: [-1.2, -20], r: [-1.2, 20] }, mouth: "frown" },
  scared: { eyes: pair(open([0, 0.4], 1.9, 0, 0, 1.12)), brows: { l: [-4, -18], r: [-4, 18] }, mouth: "wavy", sweat: true },
  suspicious: { eyes: pair(open([3.2, 0.4], 2.6, 0.5)), brows: { l: [1.2, 6], r: [-3.2, 14] }, mouth: "flat" },
  confused: { eyes: [open([1.2, 0], 2.7, 0.05, 0, 1.06), open([1.2, 0.4], 2.4, 0.38, 0.8, 0.94)], brows: { l: [-4.4, -16], r: [1.2, 10] }, mouth: "wavy" },
  // v3 thinking
  curious: { eyes: pair(open([-2.2, -1.6], 2.7, 0.22)), brows: { l: [-5, -20], r: [0.8, 8] }, mouth: "flat" },
  proud: { eyes: pair(open([0, -1.4], 2.6, 0.46, -0.4)), brows: { l: [-2.6, -6], r: [-2.6, 6] }, mouth: "smirk" },
  shy: { eyes: pair(open([-2.6, 1.4], 2.6, 0.16)), brows: { l: [-1, -12], r: [-1, 12] }, mouth: "small", blush: true },
  bored: { eyes: pair(open([0, 0.8], 2.6, 0.56)), brows: { l: [1.2, 0], r: [1.2, 0] }, mouth: "flat" },
  // v3 sleepy
  sleepy: { eyes: pair({ kind: "closed" }), brows: { l: [1, 8], r: [1, -8] }, mouth: "w", z: true },
};

/* -------------------------------------------------------------- layers */

/** The almond of an open eye (v3 `almond`): the outer corner higher, the inner one rounder. */
export function almondPath(cx: number, cy: number, s: number, w: number, h: number): string {
  const ox = cx + w * s;
  const ix = cx - w * s;
  return `M${fmt(ix)} ${fmt(cy + 0.8)}C${fmt(ix + 1.5 * s)} ${fmt(cy - h)} ${fmt(ox - 2.5 * s)} ${fmt(cy - h - 0.4)} ${fmt(ox)} ${fmt(cy - 1.2)}C${fmt(ox - 1.4 * s)} ${fmt(cy + h * 0.8)} ${fmt(ix + 2 * s)} ${fmt(cy + h * 0.9)} ${fmt(ix)} ${fmt(cy + 0.8)}Z`;
}

/** One eye's ops; `s` is -1 for the left eye, 1 for the right. */
export function eyeOps(spec: EyeSpec, s: -1 | 1, ow: number): ShibaOp[] {
  const { eye } = SHIBA_ART;
  const cx = 50 + s * eye.dx;
  const cy = eye.y;
  const arcW = eye.w * 0.85;
  const arc = r2(ow * 1.25);
  if (spec.kind === "arch") return [{ d: `M${fmt(cx - arcW)} ${fmt(cy + 1.6)}Q${fmt(cx)} ${fmt(cy - 4.6)} ${fmt(cx + arcW)} ${fmt(cy + 1.6)}`, stroke: "ink", width: arc, round: true }];
  if (spec.kind === "closed") return [{ d: `M${fmt(cx - arcW)} ${fmt(cy)}Q${fmt(cx)} ${fmt(cy + 3.8)} ${fmt(cx + arcW)} ${fmt(cy)}`, stroke: "ink", width: arc, round: true }];
  if (spec.kind === "squint") {
    // a chevron pointing toward the nose
    const tip = cx - s * 2.6;
    const back = cx + s * 3;
    return [{ d: `M${fmt(back)} ${fmt(cy - 3)}L${fmt(tip)} ${fmt(cy)}L${fmt(back)} ${fmt(cy + 3)}`, stroke: "ink", width: arc, round: true }];
  }
  const w = eye.w * spec.scale;
  const h = eye.h * spec.scale;
  const d = almondPath(cx, cy, s, w, h);
  const px = cx + spec.look[0];
  const py = cy + spec.look[1];
  const pr = spec.pupil;
  const ops: ShibaOp[] = [
    { d, fill: "white" },
    { d: ellipsePath(px, py, pr, pr), fill: "pupil", clip: d },
    { d: ellipsePath(px + pr * 0.35, py - pr * 0.4, pr * 0.34, pr * 0.34), fill: "spec", clip: d },
  ];
  if (spec.lid > 0) {
    const top = cy - h - 0.4;
    const lidY = top + spec.lid * (2 * h);
    const tilt = s * spec.lidTilt;
    ops.push(
      { d: `M${fmt(cx - 10)} ${fmt(top - 6)}L${fmt(cx + 10)} ${fmt(top - 6)}L${fmt(cx + 10)} ${fmt(lidY - tilt)}L${fmt(cx - 10)} ${fmt(lidY + tilt)}Z`, fill: "lid", clip: d },
      { d: `M${fmt(cx - 10)} ${fmt(lidY + tilt)}L${fmt(cx + 10)} ${fmt(lidY - tilt)}`, stroke: "ink", width: ow, clip: d },
    );
  }
  ops.push({ d, stroke: "ink", width: ow });
  return ops;
}

/** The two brow spots. */
export function browOps(face: ShibaFace): ShibaOp[] {
  const { brow } = SHIBA_ART;
  return ([-1, 1] as const).map((s) => {
    const [dy, rot] = s < 0 ? face.brows.l : face.brows.r;
    return { d: ellipsePath(50 + s * brow.dx, brow.y + dy, brow.rx, brow.ry, rot), fill: "brow" as const };
  });
}

/** The nose, which every face shares, with its small highlight. */
export function noseOps(): ShibaOp[] {
  const { y, w, h } = SHIBA_ART.nose;
  const x0 = 50 - w / 2;
  const x1 = 50 + w / 2;
  const d = `M${fmt(x0)} ${fmt(y + h * 0.37)}C${fmt(x0)} ${fmt(y + h * 0.1)} ${fmt(x0 + w * 0.22)} ${fmt(y)} 50 ${fmt(y)}C${fmt(x1 - w * 0.22)} ${fmt(y)} ${fmt(x1)} ${fmt(y + h * 0.1)} ${fmt(x1)} ${fmt(y + h * 0.37)}C${fmt(x1)} ${fmt(y + h * 0.7)} ${fmt(50 + w * 0.2)} ${fmt(y + h)} 50 ${fmt(y + h)}C${fmt(50 - w * 0.2)} ${fmt(y + h)} ${fmt(x0)} ${fmt(y + h * 0.7)} ${fmt(x0)} ${fmt(y + h * 0.37)}Z`;
  return [
    { d, fill: "nose" },
    { d: ellipsePath(50 - w * 0.17, y + h * 0.24, w * 0.17, h * 0.12), fill: "spec", opacity: 0.55 },
  ];
}

const TONGUE_OPEN = "M46.2 65.4Q50 63 53.8 65.4Q53.4 69.8 50 70Q46.6 69.8 46.2 65.4Z";

/** The mouth: the line under the nose, then the mouth itself. */
export function mouthOps(kind: MouthKind, ow: number): ShibaOp[] {
  const line = (d: string, width = ow): ShibaOp => ({ d, stroke: "ink", width, round: true });
  const filled = (d: string): ShibaOp => ({ d, fill: "mouth", stroke: "ink", width: r2(ow * 0.9) });
  const ops: ShibaOp[] = [line("M50 58.6L50 61.2")];
  switch (kind) {
    case "smirk":
      ops.push(line("M45 61.6Q47.6 63.2 50 61.2Q53.4 63.4 57 59.8"));
      break;
    case "open":
      ops.push(filled("M43.5 60.8Q50 62.8 56.5 60.8Q56 67.8 50 68Q44 67.8 43.5 60.8Z"), { d: TONGUE_OPEN, fill: "tongue", stroke: "ink", width: r2(ow * 0.75) }, { d: "M50 65.2L50 68", stroke: "tongueLine", width: 0.8 });
      break;
    case "grin":
      ops.push(filled("M42.4 60.4Q50 63.4 57.6 60.4Q57.2 70.4 50 70.8Q42.8 70.4 42.4 60.4Z"), { d: "M45.6 66.6Q50 63.6 54.4 66.6Q54 71.6 50 71.8Q46 71.6 45.6 66.6Z", fill: "tongue", stroke: "ink", width: r2(ow * 0.75), clip: "M42.4 60.4Q50 63.4 57.6 60.4Q57.2 70.4 50 70.8Q42.8 70.4 42.4 60.4Z" });
      break;
    case "flat":
      ops.push(line("M46 62.6Q50 61.4 55.5 62.8"));
      break;
    case "o":
      ops.push(filled(ellipsePath(50, 63.6, 2.3, 2.5)));
      break;
    case "w":
      ops.push(line("M46.5 61.2Q48.4 62.6 50 61.2Q51.6 62.6 53.5 61.2"));
      break;
    case "frown":
      ops.push(line("M45.4 64.8Q50 61.2 54.6 64.8"));
      break;
    case "wavy":
      ops.push(line("M44.6 63.4Q46.4 61.8 48.2 63.4Q50 65 51.8 63.4Q53.6 61.8 55.4 63.4"));
      break;
    case "small":
      ops.push(line("M47.6 61.8Q50 63 52.4 61.8"));
      break;
    case "bark": {
      // wide open, the jaw dropped: the bark and the pant's open mouth
      const jaw = "M42.8 60.2Q50 62.6 57.2 60.2Q58 72.6 50 73.2Q42 72.6 42.8 60.2Z";
      ops.push(filled(jaw), { d: "M45.4 68.2Q50 64.8 54.6 68.2Q54.2 73.4 50 73.6Q45.8 73.4 45.4 68.2Z", fill: "tongue", clip: jaw }, { d: jaw, stroke: "ink", width: r2(ow * 0.9) });
      break;
    }
    case "pant":
      // open, the tongue hanging out over the chin
      ops.push(filled("M44 60.8Q50 62.8 56 60.8Q55.6 66.8 50 67Q44.4 66.8 44 60.8Z"), { d: "M46.4 64.4Q50 62.4 53.6 64.4Q53.8 72 50 72.6Q46.2 72 46.4 64.4Z", fill: "tongue", stroke: "ink", width: r2(ow * 0.75) }, { d: "M50 65L50 70", stroke: "tongueLine", width: 0.8 });
      break;
  }
  return ops;
}

/** What a face adds: blush, a sweat drop, the sleeping z. */
export function extraOps(face: ShibaFace, ow: number, bust: boolean): ShibaOp[] {
  const ops: ShibaOp[] = [];
  if (face.blush) for (const s of [-1, 1]) ops.push({ d: ellipsePath(50 + s * 21, 60, 3.8, 2.1), fill: "blush", opacity: 0.5 });
  if (face.sweat) ops.push({ d: "M77 31C77 31 74.4 35 74.4 36.8C74.4 38.4 75.6 39.5 77 39.5C78.4 39.5 79.6 38.4 79.6 36.8C79.6 35 77 31 77 31Z", fill: "sweat", stroke: "line", width: r2(ow * 0.6) });
  if (face.z && !bust) {
    const z = "M80 13L86 13L80 20L86 20";
    ops.push({ d: z, stroke: "line", width: 3.6, round: true }, { d: z, stroke: "cream", width: 1.8, round: true });
  }
  return ops;
}

/** One standing leg: hip to paw at `angle` degrees (+ forward), the paw lifted `lift` (0..1); far legs in the shade tone. */
export function legOps(leg: ShibaLeg, angle: number, lift: number, ow: number): ShibaOp[] {
  const [hx, hy] = SHIBA_HIPS[leg];
  const far = leg.endsWith("Far");
  const a = (angle * Math.PI) / 180;
  const length = LEG.length - lift * 3;
  const fx = hx + Math.sin(a) * length;
  const fy = hy + Math.cos(a) * length - lift * 1.5;
  const d = `M${fmt(hx)} ${fmt(hy)}L${fmt(fx)} ${fmt(fy)}`;
  const paw = ellipsePath(fx + 1.2, fy + 0.6, 4.2, 2.8);
  return [
    { d, stroke: "line", width: r2(LEG.width + 2 * ow), round: true },
    // strokes take the coat as one solid color (a gradient on a straight line has no box to spread over)
    { d, stroke: far ? "shade" : "lid", width: LEG.width, round: true },
    { d: paw, fill: far ? "creamShade" : "cream", stroke: "line", width: ow },
  ];
}

export interface ShibaPartsInput {
  expression: ShibaExpression;
  /** A move's own mouth (the bark, the pant) over the face's. */
  mouth?: MouthKind | null;
  stance?: ShibaStance;
  /** The drawing's size in px: the outline and the bust crop follow it. */
  size: number;
}

/** The drawing's parts as ops, each a group the rig moves on its own. */
export interface ShibaParts {
  tail: ShibaOp[];
  body: ShibaOp[];
  /** The front paws, sitting or lying (none standing: the legs carry them): the wave lifts one. */
  pawL: ShibaOp[];
  pawR: ShibaOp[];
  earL: ShibaOp[];
  earR: ShibaOp[];
  head: ShibaOp[];
  brows: ShibaOp[];
  eyeL: ShibaOp[];
  eyeR: ShibaOp[];
  nose: ShibaOp[];
  mouth: ShibaOp[];
  extras: ShibaOp[];
}

/** The body, its tail and (sitting or lying) its paws, for a stance. */
function bodyOps(stance: ShibaStance, ow: number, bust: boolean): { tail: ShibaOp[]; body: ShibaOp[]; pawL: ShibaOp[]; pawR: ShibaOp[] } {
  const A = SHIBA_ART;
  const tailOf = (d: string, cream: string | null): ShibaOp[] => {
    const tw = r2(6 + 2 * ow);
    const ops: ShibaOp[] = [
      { d, stroke: "line", width: tw, round: true },
      { d, stroke: "lid", width: r2(tw - 3), round: true },
    ];
    if (cream) ops.push({ d: cream, stroke: "cream", width: 2.2, round: true });
    return ops;
  };
  if (stance === "stand") {
    return {
      tail: tailOf(A.standTail, A.standTailCream),
      body: [...shaded(A.standBody, "coat", "shade", -2, -2.4), ...shaded(A.standChest, "cream", "creamShade", -1.5, -1.5).map((op) => ({ ...op, clip: A.standBody })), outline(A.standBody, ow)],
      pawL: [],
      pawR: [],
    };
  }
  const paw = (d: string) => [...shaded(d, "cream", "creamShade", -1, -1), outline(d, ow)];
  if (stance === "lie") {
    return {
      tail: tailOf(A.lieTail, null),
      body: [...shaded(A.lieBody, "coat", "shade", -3, -1.4), ...shaded(A.lieChest, "cream", "creamShade", -2, -1).map((op) => ({ ...op, clip: A.lieBody })), outline(A.lieBody, ow)],
      pawL: paw(A.liePaws[0]),
      pawR: paw(A.liePaws[1]),
    };
  }
  return {
    tail: bust ? [] : tailOf(A.tail, A.tailCream),
    body: [...shaded(A.body, "coat", "shade", -3, -1), ...shaded(A.chest, "cream", "creamShade", -2, -1).map((op) => ({ ...op, clip: A.body })), outline(A.body, ow)],
    pawL: paw(A.paws[0]),
    pawR: paw(A.paws[1]),
  };
}

export function shibaParts(input: ShibaPartsInput): ShibaParts {
  const A = SHIBA_ART;
  const bust = input.size <= SHIBA_BUST_MAX;
  const ow = shibaOutline(input.size);
  const face = SHIBA_FACES[input.expression] ?? SHIBA_FACES.neutral;
  const ear = (d: string, inner: string, dx: number): ShibaOp[] => [...shaded(d, "coat", "shade", dx, -1), { d: inner, fill: "earIn" }, outline(d, ow)];
  const { tail, body, pawL, pawR } = bodyOps(input.stance ?? "sit", ow, bust);
  return {
    tail,
    body,
    pawL,
    pawR,
    earL: ear(A.earL, A.earInL, 1.5),
    earR: ear(A.earR, A.earInR, -1.5),
    head: [...shaded(A.head, "coat", "shade", -2.6, -3.4), ...shaded(A.mask, "cream", "creamShade", -1.8, -2.6).map((op) => ({ ...op, clip: A.head })), outline(A.head, ow)],
    brows: browOps(face),
    eyeL: eyeOps(face.eyes[0], -1, ow),
    eyeR: eyeOps(face.eyes[1], 1, ow),
    nose: noseOps(),
    mouth: mouthOps(input.mouth ?? face.mouth, ow),
    extras: extraOps(face, ow, bust),
  };
}

/** The viewBox for a size: the whole box, or the bust under 48 px. */
export function shibaViewBox(size: number): string {
  return size <= SHIBA_BUST_MAX ? `${SHIBA_BUST.x} ${SHIBA_BUST.y} ${SHIBA_BUST.w} ${SHIBA_BUST.h}` : "0 0 100 100";
}

/* --------------------------------------------------------------- SVG out */

/** Ops as SVG markup with a palette (tests, the iOS export's checks, the keyframe renders). `uid` keeps clip ids apart. */
export function opsToSvg(ops: readonly ShibaOp[], palette: ShibaPalette, uid: string): string {
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

/** The whole still drawing as one SVG string, sitting at rest (or in another stance). */
export function shibaStillSvg(options: { color: string; expression?: ShibaExpression; size: number; stance?: ShibaStance; uid?: string; palette?: ShibaPalette }): string {
  const palette = options.palette ?? shibaPalette(options.color);
  const stance = options.stance ?? "sit";
  const parts = shibaParts({ expression: options.expression ?? "neutral", size: options.size, stance });
  const uid = options.uid ?? "shiba";
  const head = STANCE_HEAD[stance];
  const [nx, ny] = SHIBA_PIVOTS.neck;
  const headTransform = head.scale === 1 && !head.x && !head.y ? "" : ` transform="translate(${head.x} ${head.y}) translate(${nx} ${ny}) scale(${head.scale}) translate(${-nx} ${-ny})"`;
  const draw = (ops: ShibaOp[], key: string) => opsToSvg(ops, palette, `${uid}${key}`);
  const face = ["brows", "eyeL", "eyeR", "nose", "mouth", "extras"].map((key) => draw(parts[key as keyof ShibaParts], key)).join("");
  const ow = shibaOutline(options.size);
  const legs = (side: "Far" | "Near") => (stance === "stand" ? SHIBA_LEGS.filter((leg) => leg.endsWith(side)).map((leg) => draw(legOps(leg, 0, 0, ow), leg)).join("") : "");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${shibaViewBox(options.size)}" width="${options.size}" height="${options.size}">` +
    `${draw(parts.tail, "t")}${legs("Far")}${draw(parts.body, "b")}${draw(parts.pawL, "pl")}${draw(parts.pawR, "pr")}${legs("Near")}<g${headTransform}>${draw(parts.earL, "el")}${draw(parts.earR, "er")}${draw(parts.head, "h")}${face}</g></svg>`
  );
}
