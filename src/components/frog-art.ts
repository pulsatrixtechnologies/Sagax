// Frog's drawing, in a 0..100 box (src/components/FrogMascot.tsx): the smug
// sad frog in direction C, "aplat net", approved by JC on 2026-10-09 with
// the Shiba. Two flat tones (the skin and the pale belly) plus one shade tone
// in a crescent, one uniform outline, geometric shapes. The head's outline
// carries the two eye domes (one path, so no stroke ever cuts an eye); the
// heavy lids and the wide flat lips carry every expression. A frog has no
// brows: the brow layer exists and stays empty, the lids do its work. Under
// 48 px the drawing is a bust.
//
// Everything here is data and pure functions, the Shiba's contract
// (shiba-art.ts): the parts as path strings and draw operations with paint
// roles (`FrogRole`), so the component, the tests, the iOS export
// (ios-mascot-export.test.ts) and the keyframe renders read one geometry.
// Paths use absolute M L C Q Z only, so they move and mirror by their pairs.
//
// The moves (frog-moves.ts) add parts the still art never shows: the throat
// sac (puff, croak), the tongue and the fly it catches, the lily pad and the
// water line. The hind legs are always on a full drawing: a sitting squat
// that kicks out for a hop (filled thighs, shins and palmate feet).
import { contrastRatio } from "../../shared/mascot-colors";
import { ellipsePath, mixColor, movePath, type Point } from "./shiba-art";

export { ellipsePath, mapPairs, mirrorPath, mixColor, movePath, type Point } from "./shiba-art";

const r2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number) => String(r2(v));

/* ----------------------------------------------------------- geometry */

/** A rounded bean at x, y (the hands; the same drawing as the Shiba's paws). */
export function beanPath(x: number, y: number, rx: number, ry: number): string {
  return (
    `M${fmt(x - rx)} ${fmt(y)}C${fmt(x - rx)} ${fmt(y - ry * 1.1)} ${fmt(x - rx * 0.5)} ${fmt(y - ry * 1.3)} ${fmt(x)} ${fmt(y - ry * 1.3)}` +
    `C${fmt(x + rx * 0.5)} ${fmt(y - ry * 1.3)} ${fmt(x + rx)} ${fmt(y - ry * 1.1)} ${fmt(x + rx)} ${fmt(y)}` +
    `C${fmt(x + rx)} ${fmt(y + ry * 0.8)} ${fmt(x + rx * 0.5)} ${fmt(y + ry)} ${fmt(x)} ${fmt(y + ry)}` +
    `C${fmt(x - rx * 0.5)} ${fmt(y + ry)} ${fmt(x - rx)} ${fmt(y + ry * 0.8)} ${fmt(x - rx)} ${fmt(y)}Z`
  );
}

/** The approved parts (scratchpad others-c.mjs, export FROG). */
export const FROG_ART = {
  /** The wide head, its outline rising into the two eye domes. */
  head: "M17 58.5C17 51 19 45.5 22.5 41.5C22 29 28 20.5 36 20.5C44 20.5 48.5 26 50 32C51.5 26 56 20.5 64 20.5C72 20.5 78 29 77.5 41.5C81 45.5 83 51 83 58.5C83 69.5 69.5 77 50 77C30.5 77 17 69.5 17 58.5Z",
  /** The hunched body: the shoulders rise as two humps along the cheeks. */
  body: "M13 99C10.5 89 10.5 78 14.5 70.5C17.5 65 24 63.5 29.5 66.5C33 68.5 36 71.5 40 72.5L60 72.5C64 71.5 67 68.5 70.5 66.5C76 63.5 82.5 65 85.5 70.5C89.5 78 89.5 89 87 99Z",
  /** The pale belly, clipped to the body. */
  belly: "M35 80C33 87 34 94 37 100L63 100C66 94 67 87 65 80C58 83 42 83 35 80Z",
  hands: [beanPath(38, 95.5, 6.4, 4.8), beanPath(62, 95.5, 6.4, 4.8)] as const,
  /** The two round eyes in their domes. */
  eye: { y: 34, dx: 14, r: 8.4 },
  /** The throat sac under the lips: its middle and its full size (the puff scales it). */
  throat: { x: 50, y: 76, rx: 19, ry: 9.5 },
  /** The mouth's middle, where the tongue leaves from. */
  mouth: [50, 65.2] as Point,
} as const;

/** Where each moving part turns (box units). */
export const FROG_PIVOTS = {
  /** The neck: the head nods and tilts about it. */
  neck: [50, 72] as Point,
  /** The ground under the hands: squash, hops and the facing flip. */
  ground: [50, 99] as Point,
  eyeL: [36, 34] as Point,
  eyeR: [64, 34] as Point,
  mouth: FROG_ART.mouth,
  /** Each hand's wrist: a wave lifts and turns the hand about it. */
  handL: [38, 93] as Point,
  handR: [62, 93] as Point,
  /** The hips the hind legs hang from, left and right (on the body's flanks). */
  hipL: [26, 82] as Point,
  hipR: [74, 82] as Point,
} as const;

/** The bust crop: the box an avatar under 48 px shows (the head and the shoulders). */
export const FROG_BUST = { x: 11, y: 14, w: 78, h: 78 } as const;
export const FROG_BUST_MAX = 48;

/** The outline width at a drawing size: 1.9 units, never under 1.6 screen px. */
export function frogOutline(size: number): number {
  const box = size <= FROG_BUST_MAX ? FROG_BUST.w : 100;
  return r2(Math.max(1.9, (1.6 * box) / Math.max(1, size)));
}

/** The viewBox for a size: the whole box, or the bust under 48 px. */
export function frogViewBox(size: number): string {
  return size <= FROG_BUST_MAX ? `${FROG_BUST.x} ${FROG_BUST.y} ${FROG_BUST.w} ${FROG_BUST.h}` : "0 0 100 100";
}

/* -------------------------------------------------------------- colors */

/** What every part is painted with; a skin maps each role to a paint (skin-fx/frog-skins.tsx). */
export const FROG_ROLES = [
  "skin",
  "shade",
  "line",
  "belly",
  "bellyShade",
  "toe",
  "toeShade",
  "lid",
  "lidLine",
  "white",
  "ink",
  "pupil",
  "spec",
  "lip",
  "lipShade",
  "lipLine",
  "mouth",
  "tongue",
  "blush",
  "sweat",
  "throat",
  "throatShade",
  "pad",
  "padShade",
  "padLine",
  "water",
  "waterLine",
  "fly",
] as const;
export type FrogRole = (typeof FROG_ROLES)[number];
export type FrogPalette = Record<FrogRole, string>;

/** The canonical skin green (the approved art, no bot color). */
export const FROG_GREEN = "#74AE48";
/** How much of the bot color the skin takes. */
export const FROG_TINT = 0.24;
const BELLY = "#E4EDB6";
/** The least contrast between the skin and the pale belly before the skin is darkened. */
export const SKIN_MIN_CONTRAST = 1.45;

function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A #rrggbb color as hue (degrees), saturation and lightness (0..1). */
export function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Hue, saturation and lightness back to #rrggbb. */
export function fromHsl([h, s, l]: [number, number, number]): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v + m)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A base tone tinted by a bot color (others-c.mjs `tint`): the hue and the
 * lightness move toward the blend, the saturation never drops under the
 * base's, so a grey or a white bot never turns the frog grey.
 */
export function tintTone(base: string, color: string, t: number): string {
  const m = toHsl(mixColor(base, color, t));
  const b = toHsl(base);
  return fromHsl([m[0], Math.max(m[1], b[1] * 0.92), (m[2] + b[2]) / 2]);
}

/**
 * The skin for a bot color: the green taking FROG_TINT of it, then, for a
 * light color (white, cream, the pastels), darkened just enough that the
 * pale belly still reads against it.
 */
export function frogSkin(hex: string | null | undefined): string {
  const tinted = hex ? tintTone(FROG_GREEN, hex, FROG_TINT) : FROG_GREEN;
  let skin = tinted;
  for (let k = 0.04; k <= 0.6 && contrastRatio(skin, mixColor(BELLY, skin, 0.12)) < SKIN_MIN_CONTRAST; k += 0.04) skin = mixColor(tinted, "#0e2008", r2(k));
  return skin;
}

/** The palette around a skin tone (direction C's own tones); `frogPalette` picks the skin from a bot color. */
export function frogPaletteFor(skin: string): FrogPalette {
  const belly = mixColor(BELLY, skin, 0.12);
  return {
    skin,
    shade: mixColor(skin, "#1a3a10", 0.3),
    line: mixColor(skin, "#0e1a08", 0.74),
    belly,
    bellyShade: mixColor("#CCDA92", skin, 0.2),
    toe: skin,
    toeShade: mixColor(skin, "#1a3a10", 0.3),
    lid: skin,
    lidLine: "#1E1A12",
    white: "#ffffff",
    ink: "#1E1A12",
    pupil: "#1E1A12",
    spec: "#ffffff",
    lip: "#A9533F",
    lipShade: mixColor("#A9533F", "#3a1008", 0.3),
    lipLine: "#4A1F14",
    mouth: "#3A140E",
    tongue: "#F07F86",
    blush: "#F39A8C",
    sweat: "#9CD3F5",
    throat: mixColor("#F0F4D2", skin, 0.1),
    throatShade: mixColor("#D6E2A4", skin, 0.2),
    pad: "#4E9A3A",
    padShade: "#2F6E25",
    padLine: "#1B3F14",
    water: "#5FA8D8",
    waterLine: "#2C6E9E",
    fly: "#2A2A33",
  };
}

/** The plain palette for a bot color (or the canonical green without one). */
export function frogPalette(hex?: string | null): FrogPalette {
  return frogPaletteFor(frogSkin(hex));
}

/* ----------------------------------------------------------- draw ops */

/** One drawing operation: a path filled and/or stroked with roles, maybe clipped to another path. */
export interface FrogOp {
  d: string;
  fill?: FrogRole;
  stroke?: FrogRole;
  width?: number;
  opacity?: number;
  /** Drawn clipped to this path. */
  clip?: string;
  /** Round caps (open strokes). */
  round?: boolean;
}

/** A part filled flat with a shade crescent: the shade, then the base moved up-left over it, clipped to the part. */
function shaded(d: string, base: FrogRole, shade: FrogRole, dx: number, dy: number): FrogOp[] {
  return [
    { d, fill: shade },
    { d: movePath(d, dx, dy), fill: base, clip: d },
  ];
}

const outline = (d: string, width: number): FrogOp => ({ d, stroke: "line", width });

/* ---------------------------------------------------------- expressions */

/** The sixteen faces, the Shapes' ids (shape-engine.ts SHAPE_EXPRESSIONS). */
export const FROG_EXPRESSIONS = ["neutral", "attentive", "surprised", "excited", "happy", "laughing", "angry", "sad", "scared", "suspicious", "confused", "curious", "proud", "shy", "bored", "sleepy"] as const;
export type FrogExpression = (typeof FROG_EXPRESSIONS)[number];

/** The v3 moods, by their expression (idle neutral, happy happy, thinking curious, alert surprised, sleepy sleepy). */
export const FROG_MOOD_EXPRESSION = { idle: "neutral", happy: "happy", thinking: "curious", alert: "surprised", sleepy: "sleepy" } as const satisfies Record<string, FrogExpression>;

/** An open eye: where the pupil looks (box units), its radius, the lid (0 open..1 shut), the lid's slope (+ inner corner down), the eye's size. */
export interface FrogOpenEye {
  kind: "open";
  look: Point;
  pupil: number;
  lid: number;
  lidTilt: number;
  scale: number;
}
/** Closed eyes: a happy arch, a sleeping curve, a laughing squint. */
export type FrogEyeSpec = FrogOpenEye | { kind: "arch" } | { kind: "closed" } | { kind: "squint" };

/** The lips' shapes: the approved five (smug, smile, side, o, rest) and the ones the other faces and the moves need. */
export const FROG_MOUTHS = ["smug", "smile", "side", "o", "rest", "grin", "frown", "wavy", "smirk", "small", "pout", "flat", "croak", "open"] as const;
export type FrogMouth = (typeof FROG_MOUTHS)[number];

export interface FrogFace {
  eyes: readonly [FrogEyeSpec, FrogEyeSpec];
  mouth: FrogMouth;
  blush?: boolean;
  sweat?: boolean;
  z?: boolean;
}

const open = (look: Point, pupil: number, lid: number, lidTilt = 0, scale = 1): FrogOpenEye => ({ kind: "open", look, pupil, lid, lidTilt, scale });
const pair = (eye: FrogEyeSpec, right: FrogEyeSpec = eye) => [eye, right] as const;

/**
 * The faces. The approved moods: idle is the smug half-lidded side glance
 * (lids at half, sloping down outward, the sad side), thinking the two
 * different lids with the gaze up and away, alert the wide round eyes and the
 * small round mouth, happy the arches and the smile, sleepy the curves.
 */
export const FROG_FACES: Readonly<Record<FrogExpression, FrogFace>> = {
  neutral: { eyes: pair(open([2.6, 2.6], 3.2, 0.5, -0.7)), mouth: "smug" },
  attentive: { eyes: pair(open([0, 0.8], 3.2, 0.16, -0.3)), mouth: "smug" },
  surprised: { eyes: pair(open([0, 0], 3, 0, 0, 1.06)), mouth: "o" },
  excited: { eyes: pair(open([0, -1], 3.6, 0, 0, 1.06)), mouth: "grin" },
  happy: { eyes: pair({ kind: "arch" }), mouth: "smile" },
  laughing: { eyes: pair({ kind: "squint" }), mouth: "grin", blush: true },
  angry: { eyes: pair(open([0, 1.2], 2.9, 0.46, 2.6)), mouth: "pout" },
  sad: { eyes: pair(open([0, 2.6], 3.2, 0.42, -2.6)), mouth: "frown" },
  scared: { eyes: pair(open([0, 0.6], 2.2, 0, 0, 1.04)), mouth: "wavy", sweat: true },
  suspicious: { eyes: pair(open([3.6, 1.2], 3, 0.6, 0.6)), mouth: "flat" },
  confused: { eyes: [open([1.4, 0], 3.2, 0.06, 0, 1.04), open([1.4, 0.6], 2.8, 0.48, 1.2, 0.96)], mouth: "wavy" },
  curious: { eyes: pair(open([-3.2, -1.2], 3.2, 0.12), open([-3.2, -1.2], 3.2, 0.44, -0.4)), mouth: "side" },
  proud: { eyes: pair(open([0, -1.8], 3, 0.56, -0.5)), mouth: "smirk" },
  shy: { eyes: pair(open([-3, 2.4], 3, 0.3, -1)), mouth: "small", blush: true },
  bored: { eyes: pair(open([0, 1.6], 3.1, 0.64, -0.2)), mouth: "flat" },
  sleepy: { eyes: pair({ kind: "closed" }), mouth: "rest", z: true },
};

/* -------------------------------------------------------------- layers */

/** One eye's ops; `s` is -1 for the left eye, 1 for the right. `blink` (0..1) closes the lid further (a blink, a wink). */
export function frogEyeOps(spec: FrogEyeSpec, s: -1 | 1, ow: number, blink = 0): FrogOp[] {
  const { eye } = FROG_ART;
  const cx = 50 + s * eye.dx;
  const cy = eye.y;
  const arcW = eye.r * 0.7;
  const arc = r2(ow * 1.25);
  if (spec.kind === "arch") return [{ d: `M${fmt(cx - arcW)} ${fmt(cy + 1.6)}Q${fmt(cx)} ${fmt(cy - 4.6)} ${fmt(cx + arcW)} ${fmt(cy + 1.6)}`, stroke: "ink", width: arc, round: true }];
  if (spec.kind === "closed") return [{ d: `M${fmt(cx - arcW)} ${fmt(cy)}Q${fmt(cx)} ${fmt(cy + 3.8)} ${fmt(cx + arcW)} ${fmt(cy)}`, stroke: "ink", width: arc, round: true }];
  if (spec.kind === "squint") {
    // a chevron pointing toward the middle
    const tip = cx - s * 3;
    const back = cx + s * 3.4;
    return [{ d: `M${fmt(back)} ${fmt(cy - 3.4)}L${fmt(tip)} ${fmt(cy)}L${fmt(back)} ${fmt(cy + 3.4)}`, stroke: "ink", width: arc, round: true }];
  }
  const r = eye.r * spec.scale;
  const d = ellipsePath(cx, cy, r, r);
  const px = cx + spec.look[0];
  const py = cy + spec.look[1];
  const pr = spec.pupil;
  // a blink lowers the lid the rest of the way, and levels it as it closes
  const lid = Math.min(1, spec.lid + (1 - spec.lid) * Math.max(0, Math.min(1, blink)));
  const ops: FrogOp[] = [
    { d, fill: "white" },
    { d: ellipsePath(px, py, pr, pr), fill: "pupil", clip: d },
    { d: ellipsePath(px + pr * 0.35, py - pr * 0.4, pr * 0.34, pr * 0.34), fill: "spec", clip: d },
  ];
  if (lid > 0) {
    const top = cy - r;
    const lidY = top + lid * 2 * r;
    const tilt = s * spec.lidTilt * (1 - lid * lid);
    const L = r + 6;
    ops.push(
      { d: `M${fmt(cx - L)} ${fmt(top - 8)}L${fmt(cx + L)} ${fmt(top - 8)}L${fmt(cx + L)} ${fmt(lidY - tilt)}L${fmt(cx - L)} ${fmt(lidY + tilt)}Z`, fill: "lid", clip: d },
      { d: `M${fmt(cx - L)} ${fmt(lidY + tilt)}L${fmt(cx + L)} ${fmt(lidY - tilt)}`, stroke: "lidLine", width: ow, clip: d },
    );
  }
  ops.push({ d, stroke: "ink", width: ow });
  return ops;
}

/** An open eye's layers, for the rig: the white, the pupil and its glint (moved by a look), the face's own lid, the outline; all but the outline clipped to `clip`. */
export interface FrogEyeLayers {
  clip: string;
  white: FrogOp[];
  pupil: FrogOp[];
  lid: FrogOp[];
  outline: FrogOp[];
  /** The blink lid: a full-height lid with its line at the bottom, slid down from above the eye (translate y from -height to 0). */
  blink: FrogOp[];
  /** The lower blink lid, slid up from below the eye to meet the upper one. */
  low: FrogOp[];
  height: number;
  /** How far the face's own lid already closes the eye (0..1): a blink shows only past it. */
  rest: number;
}

/** The layers of an open eye (null for the closed kinds, which the rig draws as they are). */
export function frogEyeLayers(spec: FrogEyeSpec, s: -1 | 1, ow: number): FrogEyeLayers | null {
  if (spec.kind !== "open") return null;
  const ops = frogEyeOps(spec, s, ow, 0);
  const { eye } = FROG_ART;
  const cx = 50 + s * eye.dx;
  const r = eye.r * spec.scale;
  const clip = ops[0].d;
  const unclip = (op: FrogOp): FrogOp => ({ ...op, clip: undefined });
  const L = r + 3;
  const top = eye.y - r - 1;
  const height = 2 * r + 2;
  const meet = top + height * Math.max(0.6, spec.lid);
  return {
    clip,
    white: [ops[0]],
    pupil: ops.slice(1, 3).map(unclip),
    lid: ops.slice(3, -1).map(unclip),
    outline: [ops[ops.length - 1]],
    // the upper lid ends at the meeting line, the lower lid starts there; the rig slides them toward it
    blink: [
      { d: `M${fmt(cx - L)} ${fmt(top - height)}L${fmt(cx + L)} ${fmt(top - height)}L${fmt(cx + L)} ${fmt(meet)}L${fmt(cx - L)} ${fmt(meet)}Z`, fill: "lid" },
      { d: `M${fmt(cx - L)} ${fmt(meet)}Q${fmt(cx)} ${fmt(meet + 2.4)} ${fmt(cx + L)} ${fmt(meet)}`, stroke: "lidLine", width: ow },
    ],
    low: [{ d: `M${fmt(cx - L)} ${fmt(meet)}Q${fmt(cx)} ${fmt(meet + 2.4)} ${fmt(cx + L)} ${fmt(meet)}L${fmt(cx + L)} ${fmt(top + 2 * height)}L${fmt(cx - L)} ${fmt(top + 2 * height)}Z`, fill: "lid" }],
    height,
    rest: spec.lid,
  };
}

/** The lips: [outer shape, the dark line that splits them, an open mouth's dark inside]. */
export const FROG_LIPS: Readonly<Record<FrogMouth, { shape: string; split?: string; inside?: string; tongue?: string }>> = {
  smug: { shape: "M32 62.6Q42 60.4 50 60.6Q58 60.4 68 62.6Q69.6 64.4 68 66.4Q58 69 50 68.8Q42 69 32 66.4Q30.4 64.4 32 62.6Z", split: "M32.6 64.5Q50 64 67.4 64.5" },
  smile: { shape: "M32 61.2Q42 62.8 50 63Q58 62.8 68 61.2Q69.4 63 68.2 65Q58 69.4 50 69.4Q42 69.4 31.8 65Q30.6 63 32 61.2Z", split: "M32.6 62.8Q50 66.8 67.4 62.8" },
  side: { shape: "M36 63.4Q44 61.4 52 61.8Q60 61.6 67 63.2Q68.4 64.8 67 66.6Q60 69 52 68.8Q44 69 36 67.2Q34.6 65.4 36 63.4Z", split: "M36.6 65.2Q51 64.4 66.4 65" },
  o: { shape: "M40 59.5Q50 57.5 60 59.5Q64.5 65 60 71Q50 73.5 40 71Q35.5 65 40 59.5Z", inside: ellipsePath(50, 65.2, 3.6, 3.4) },
  rest: { shape: "M32.5 62.8Q42 61 50 61.4Q58 61 67.5 62.8Q69 64.6 67.5 66.6Q58 69.2 50 69Q42 69.2 32.5 66.6Q31 64.6 32.5 62.8Z", split: "M33.2 64.8Q50 65.8 66.8 64.8" },
  grin: {
    shape: "M26 58.5Q38 61.5 50 61.6Q62 61.5 74 58.5Q76 60.5 74.6 63.5Q64 75 50 75Q36 75 25.4 63.5Q24 60.5 26 58.5Z",
    inside: "M30.5 62.2Q50 66.6 69.5 62.2Q62 71.2 50 71.4Q38 71.2 30.5 62.2Z",
    tongue: ellipsePath(50, 71, 8, 3.6),
  },
  frown: { shape: "M32 65.4Q42 61.2 50 61.2Q58 61.2 68 65.4Q69.4 67.2 67.8 68.6Q58 67.2 50 67.4Q42 67.2 32.2 68.6Q30.6 67.2 32 65.4Z", split: "M32.6 67Q50 62.4 67.4 67" },
  wavy: { shape: "M34 63Q42 61.2 50 61.6Q58 61.2 66 63Q67.4 64.8 66 66.6Q58 68.8 50 68.6Q42 68.8 34 66.6Q32.6 64.8 34 63Z", split: "M34.6 64.8Q39 63.4 43.4 64.8Q47.8 66.2 52.2 64.8Q56.6 63.4 61 64.8Q63.4 65.6 65.4 64.8" },
  smirk: { shape: "M32 64Q42 61.4 50 61.2Q58 60.6 67 59.2Q69 60.6 68 63Q58 68.2 50 68.8Q42 69.4 32 67.2Q30.4 65.6 32 64Z", split: "M32.6 65.6Q50 64.2 67.2 61.2" },
  small: { shape: "M40 63.2Q45 62 50 62.2Q55 62 60 63.2Q61.2 64.8 60 66.4Q55 67.8 50 67.8Q45 67.8 40 66.4Q38.8 64.8 40 63.2Z", split: "M40.6 64.8Q50 64.2 59.4 64.8" },
  pout: { shape: "M33 64.6Q42 62 50 62.4Q58 62 67 64.6Q68.4 66.6 66.8 68.2Q58 68.6 50 68.8Q42 68.6 33.2 68.2Q31.6 66.6 33 64.6Z", split: "M33.6 66.6Q42 65 50 65.8Q58 65 66.4 66.6" },
  flat: { shape: "M34 63.4Q50 62 66 63.4Q67.4 64.8 66 66.4Q50 68 34 66.4Q32.6 64.8 34 63.4Z", split: "M34.6 64.9Q50 64.6 65.4 64.9" },
  croak: { shape: "M35 58.6Q50 55.6 65 58.6Q71 65.6 65 72.8Q50 76.2 35 72.8Q29 65.6 35 58.6Z", inside: ellipsePath(50, 65.8, 10, 5.8), tongue: ellipsePath(50, 69.6, 6, 2.4) },
  open: { shape: "M32 61.8Q42 59.4 50 59.8Q58 59.4 68 61.8Q69.8 64.2 68 66.6Q58 69.8 50 69.6Q42 69.8 32 66.6Q30.2 64.2 32 61.8Z", inside: ellipsePath(50, 65.2, 8, 2.2) },
};

/** The mouth layer: the lips with their shade, the outline, then the split or the open inside. */
export function frogMouthOps(kind: FrogMouth, ow: number): FrogOp[] {
  const lips = FROG_LIPS[kind];
  const ops: FrogOp[] = [...shaded(lips.shape, "lip", "lipShade", -1.2, -1.6), { d: lips.shape, stroke: "lipLine", width: ow }];
  if (lips.inside) {
    ops.push({ d: lips.inside, fill: kind === "o" ? "lipLine" : "mouth" });
    if (lips.tongue) ops.push({ d: lips.tongue, fill: "tongue", clip: lips.inside });
  }
  if (lips.split) ops.push({ d: lips.split, stroke: "lipLine", width: ow, round: true });
  return ops;
}

/** What a face adds: blush, a sweat drop, the sleeping z. */
export function frogExtraOps(face: FrogFace, ow: number, bust: boolean): FrogOp[] {
  const ops: FrogOp[] = [];
  if (face.blush) for (const s of [-1, 1]) ops.push({ d: ellipsePath(50 + s * 26, 55, 4.4, 2.3), fill: "blush", opacity: 0.55 });
  if (face.sweat) ops.push({ d: "M81 38C81 38 78.4 42 78.4 43.8C78.4 45.4 79.6 46.5 81 46.5C82.4 46.5 83.6 45.4 83.6 43.8C83.6 42 81 38 81 38Z", fill: "sweat", stroke: "line", width: r2(ow * 0.6) });
  if (face.z && !bust) {
    const z = "M82 12L88 12L82 19L88 19";
    ops.push({ d: z, stroke: "line", width: 3.6, round: true }, { d: z, stroke: "belly", width: 1.8, round: true });
  }
  return ops;
}

/* ----------------------------------------------------------- move parts */

/** The throat sac at `puff` (0 hidden..1 full, a croak goes past 1): a pale bubble under the lips. */
export function frogThroatOps(puff: number, ow: number): FrogOp[] {
  if (puff <= 0.02) return [];
  const { x, y, rx, ry } = FROG_ART.throat;
  const k = Math.min(1.35, puff);
  // the sac grows from under the lips, so its top stays put and it swells downward
  const h = ry * k;
  const d = ellipsePath(x, y - ry + h, rx * (0.55 + 0.45 * k), h);
  // a balloon's glint on the upper left
  const glint = ellipsePath(x - rx * 0.42 * k, y - ry + h * 0.62, 2.6 * k, 1.3 * k, -18);
  return [...shaded(d, "throat", "throatShade", -1.4, -1.8), { d, stroke: "line", width: ow }, { d: glint, fill: "spec", opacity: 0.7 }];
}

/** The tongue from the mouth to `tip` (box units), `reach` 0..1 of the way, and the fly it carries back. */
export function frogTongueOps(tip: Point, reach: number, ow: number): FrogOp[] {
  if (reach <= 0.01) return [];
  const [mx, my] = FROG_ART.mouth;
  const x = mx + (tip[0] - mx) * reach;
  const y = my + (tip[1] - my) * reach;
  // a slight sag, like a thrown rope
  const cx = (mx + x) / 2;
  const cy = (my + y) / 2 + 3 * reach;
  const d = `M${fmt(mx)} ${fmt(my)}Q${fmt(cx)} ${fmt(cy)} ${fmt(x)} ${fmt(y)}`;
  return [
    { d, stroke: "lipLine", width: r2(4.2 + 2 * ow), round: true },
    { d, stroke: "tongue", width: 4.2, round: true },
    { d: ellipsePath(x, y, 3.4, 3.1), fill: "tongue", stroke: "lipLine", width: ow },
  ];
}

/** A fly at x, y, wings at `flap` (-1..1). */
export function frogFlyOps(at: Point, flap: number, ow: number): FrogOp[] {
  const [x, y] = at;
  const wing = (s: -1 | 1) => ellipsePath(x + s * 2.4, y - 2.2 - flap * 0.8, 2.6, 1.5, s * (30 + flap * 20));
  return [
    { d: wing(-1), fill: "white", stroke: "line", width: r2(ow * 0.5), opacity: 0.85 },
    { d: wing(1), fill: "white", stroke: "line", width: r2(ow * 0.5), opacity: 0.85 },
    { d: ellipsePath(x, y, 2.2, 1.7), fill: "fly" },
  ];
}

/** A thick bone from `a` to `b` as a closed ellipse (round caps, one outline). */
function limbPath(a: Point, b: Point, halfW: number): string {
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return ellipsePath(cx, cy, len / 2 + halfW * 0.42, halfW, angle);
}

/** Down and out onto the pad: left 130 deg, right 50 deg (SVG y grows down). */
function frogFootHeading(s: -1 | 1): number {
  return ((90 - s * 40) * Math.PI) / 180;
}

/**
 * Map a point in the foot's local frame: `along` toward the toes, `across`
 * toward the belly (positive inner). Same construction on both sides.
 */
function frogFootLocal(ankle: Point, s: -1 | 1, scale: number): (along: number, across: number) => Point {
  const heading = frogFootHeading(s);
  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  let px = -uy;
  let py = ux;
  if ((50 - ankle[0]) * px < 0) {
    px = -px;
    py = -py;
  }
  return (along, across) => [ankle[0] + (ux * along + px * across) * scale, ankle[1] + (uy * along + py * across) * scale];
}

/**
 * One palmate hind foot: four rounded toes and shallow webbing as a single
 * silhouette, fanned down and a little out from `ankle`. `s` -1 left, 1 right.
 */
function frogFootPath(ankle: Point, s: -1 | 1, scale: number): string {
  const P = frogFootLocal(ankle, s, scale);
  const heel = P(-2.1, 0);
  const hw = 1.28;
  const crosses = [-4.05, -1.35, 1.35, 4.05];
  const cap = (c: number) => {
    const tip = P(8.05, c);
    const right = P(5.85, c + hw);
    const k = 0.82;
    return (
      `C${fmt(P(6.85, c - hw)[0])} ${fmt(P(6.85, c - hw)[1])} ${fmt(P(8.05, c - k)[0])} ${fmt(P(8.05, c - k)[1])} ${fmt(tip[0])} ${fmt(tip[1])}` +
      `C${fmt(P(8.05, c + k)[0])} ${fmt(P(8.05, c + k)[1])} ${fmt(P(6.85, c + hw)[0])} ${fmt(P(6.85, c + hw)[1])} ${fmt(right[0])} ${fmt(right[1])}`
    );
  };
  const web = (a: number, b: number) => {
    const to = P(5.85, b - hw);
    const m = P(4.7, (a + b) / 2);
    return `Q${fmt(m[0])} ${fmt(m[1])} ${fmt(to[0])} ${fmt(to[1])}`;
  };
  const first = P(5.85, crosses[0] - hw);
  let d =
    `M${fmt(heel[0])} ${fmt(heel[1])}` +
    `C${fmt(P(-0.2, -4.6)[0])} ${fmt(P(-0.2, -4.6)[1])} ${fmt(P(2.6, -5.4)[0])} ${fmt(P(2.6, -5.4)[1])} ${fmt(first[0])} ${fmt(first[1])}` +
    cap(crosses[0]);
  for (let i = 1; i < crosses.length; i += 1) d += web(crosses[i - 1], crosses[i]) + cap(crosses[i]);
  d += `C${fmt(P(2.6, 5.4)[0])} ${fmt(P(2.6, 5.4)[1])} ${fmt(P(-0.2, 4.6)[0])} ${fmt(P(-0.2, 4.6)[1])} ${fmt(heel[0])} ${fmt(heel[1])}Z`;
  return d;
}

function frogFootDigits(ankle: Point, s: -1 | 1, scale: number, ow: number, clip: string): FrogOp[] {
  const P = frogFootLocal(ankle, s, scale);
  const start = P(1.1, 0);
  return [-4.05, -1.35, 1.35, 4.05].map((c) => {
    const end = P(6.5, c);
    return { d: `M${fmt(start[0])} ${fmt(start[1])}L${fmt(end[0])} ${fmt(end[1])}`, stroke: "line" as const, width: r2(ow * 0.62), round: true, clip };
  });
}

/** A hind leg's joints at `extend` (0 squat..1 kicked out), `s` -1 left, 1 right: hip, knee, ankle. */
export function frogLegJoints(s: -1 | 1, extend: number): { hip: Point; knee: Point; ankle: Point } {
  const [hx, hy] = s < 0 ? FROG_PIVOTS.hipL : FROG_PIVOTS.hipR;
  const e = Math.min(1.1, Math.max(0, extend));
  // squat: a sitting W, knee out on the flank, ankle in and down on the pad;
  // kicked: the same W opens a little, the foot reaches down and out, still compact
  return {
    hip: [hx + s * 0.4, hy + e],
    knee: [hx + s * (19 + 5 * e), hy + 17 + 2 * e],
    ankle: [hx + s * (15 + 5 * e), hy + 18 + 4 * e],
  };
}

/**
 * One hind leg's shin and palmate foot, behind the body: `extend` 0 (the
 * sitting squat) .. 1 (a hop's kick, the stretch after a nap, dangling);
 * `s` -1 left, 1 right. The thigh over it is frogHaunchOps. Always drawn:
 * a frog keeps its hind legs.
 */
export function frogLegOps(s: -1 | 1, extend: number, ow: number): FrogOp[] {
  const e = Math.min(1.1, Math.max(0, extend));
  const { knee, ankle } = frogLegJoints(s, e);
  const shinW = 7.2 + 0.5 * Math.min(1, e);
  const shin = limbPath(knee, ankle, shinW);
  const scale = 1.28 + 0.08 * Math.min(1, e);
  const foot = frogFootPath(ankle, s, scale);
  return [...shaded(shin, "skin", "shade", -1, -1.2), outline(shin, ow), ...shaded(foot, "toe", "toeShade", -1.1, -1.3), outline(foot, ow), ...frogFootDigits(ankle, s, scale, ow, foot)];
}

/** One hind leg's thigh, over the body's flank: a fat haunch from the hip to the knee. */
export function frogHaunchOps(s: -1 | 1, extend: number, ow: number): FrogOp[] {
  const e = Math.min(1.1, Math.max(0, extend));
  const { hip, knee } = frogLegJoints(s, e);
  const d = limbPath(hip, knee, 8.6 + 0.8 * Math.min(1, e));
  return [...shaded(d, "skin", "shade", -1.4, -1.8), outline(d, ow)];
}

/** The shoulders the arms hang from, left and right. */
export const FROG_SHOULDERS: readonly [Point, Point] = [[31, 80], [69, 80]];

/** One arm, `s` -1 left, 1 right, to its hand moved by dx (outward), dy: a thick skin stroke from the shoulder to the wrist, nothing at rest. */
export function frogArmOps(s: -1 | 1, dx: number, dy: number, ow: number): FrogOp[] {
  if (Math.abs(dx) + Math.abs(dy) < 3) return [];
  const [sx, sy] = FROG_SHOULDERS[s < 0 ? 0 : 1];
  const [wx, wy] = s < 0 ? FROG_PIVOTS.handL : FROG_PIVOTS.handR;
  const ex = wx + s * dx;
  const ey = wy + dy;
  // a slight elbow bend out to the side
  const mx = (sx + ex) / 2 + s * 4;
  const my = (sy + ey) / 2 + 2;
  const d = `M${fmt(sx)} ${fmt(sy)}Q${fmt(mx)} ${fmt(my)} ${fmt(ex)} ${fmt(ey)}`;
  return [
    { d, stroke: "line", width: r2(6.5 + 2 * ow), round: true },
    { d, stroke: "skin", width: 6.5, round: true },
  ];
}

/** The lily pad under the frog: a wide flat leaf with its notch toward the viewer. */
export const FROG_PAD = "M50 94C72 94 92 96.5 92 100.5C92 104.5 72 107 54 107L50 101.5L46 107C28 107 8 104.5 8 100.5C8 96.5 28 94 50 94Z";
export function frogPadOps(ow: number): FrogOp[] {
  return [...shaded(FROG_PAD, "pad", "padShade", -2, -1.4), { d: FROG_PAD, stroke: "padLine", width: ow }, { d: "M50 101.5L50 96.4M50 98.4L38 96.6M50 98.4L62 96.6", stroke: "padShade", width: r2(ow * 0.6), round: true }];
}

/**
 * The pond in front of the frog at `level` (the water line's height in box
 * units: 100 is no water, 67 hides the lower third), its line rippling at
 * `phase` (s). A rounded pool, wider than the frog, so it reads as a pond on
 * the desktop and not as a box.
 */
export function frogWaterOps(level: number, phase: number, ow: number): FrogOp[] {
  if (level >= 99.5) return [];
  const amp = 0.9;
  const pts: string[] = [];
  for (let i = 0; i <= 10; i += 1) {
    const x = 2 + i * 9.6;
    // the ripples fade toward the pond's ends
    const y = level + Math.sin(phase * 3.2 + i * 1.3) * amp * Math.sin((i / 10) * Math.PI);
    pts.push(`${fmt(x)} ${fmt(y)}`);
  }
  const top = `M${pts.join("L")}`;
  const bottom = Math.max(level + 14, 106);
  const d = `${top}C${fmt(104)} ${fmt(level + 1)} ${fmt(104)} ${fmt(bottom)} 86 ${fmt(bottom + 2)}L14 ${fmt(bottom + 2)}C-4 ${fmt(bottom)} -4 ${fmt(level + 1)} 2 ${fmt(level)}Z`;
  const glint = Math.sin(phase * 2);
  return [
    { d, fill: "water", opacity: 0.9 },
    { d, stroke: "waterLine", width: ow },
    { d: `M${fmt(28 + glint * 2)} ${fmt(level + 5)}L${fmt(40 + glint * 2)} ${fmt(level + 5)}M${fmt(60 - glint * 2)} ${fmt(level + 9)}L${fmt(72 - glint * 2)} ${fmt(level + 9)}`, stroke: "white", width: r2(ow * 0.7), round: true, opacity: 0.6 },
  ];
}

/* --------------------------------------------------------------- parts */

export interface FrogPartsInput {
  expression: FrogExpression;
  /** A move's own lips (the croak, the tongue's open mouth) over the face's. */
  mouth?: FrogMouth | null;
  /** Per eye, how far a blink or a wink closes the lid (0..1). */
  blink?: readonly [number, number];
  /** The drawing's size in px: the outline and the bust crop follow it. */
  size: number;
}

/** The drawing's parts as ops, each a group the rig moves on its own. */
export interface FrogParts {
  body: FrogOp[];
  /** The two hands, each its own group (a wave lifts one). */
  handL: FrogOp[];
  handR: FrogOp[];
  head: FrogOp[];
  /** Empty: a frog has no brows; the lids carry their work. */
  brows: FrogOp[];
  eyeL: FrogOp[];
  eyeR: FrogOp[];
  /** Empty in the approved art (the lips sit right under the eyes). */
  nose: FrogOp[];
  mouth: FrogOp[];
  extras: FrogOp[];
}

export function frogParts(input: FrogPartsInput): FrogParts {
  const A = FROG_ART;
  const bust = input.size <= FROG_BUST_MAX;
  const ow = frogOutline(input.size);
  const face = FROG_FACES[input.expression] ?? FROG_FACES.neutral;
  const [bl, br] = input.blink ?? [0, 0];
  const hand = (d: string) => [...shaded(d, "toe", "toeShade", -1, -1), outline(d, ow)];
  return {
    body: [...shaded(A.body, "skin", "shade", -3, -1), ...shaded(A.belly, "belly", "bellyShade", -2, -1).map((op) => ({ ...op, clip: A.body })), outline(A.body, ow)],
    handL: hand(A.hands[0]),
    handR: hand(A.hands[1]),
    head: [...shaded(A.head, "skin", "shade", -2.6, -3.4), outline(A.head, ow)],
    brows: [],
    eyeL: frogEyeOps(face.eyes[0], -1, ow, bl),
    eyeR: frogEyeOps(face.eyes[1], 1, ow, br),
    nose: [],
    mouth: frogMouthOps(input.mouth ?? face.mouth, ow),
    extras: frogExtraOps(face, ow, bust),
  };
}

/* --------------------------------------------------------------- SVG out */

/** Ops as SVG markup with a palette (tests, the iOS export's checks, the keyframe renders). `uid` keeps clip ids apart. */
export function frogOpsToSvg(ops: readonly FrogOp[], palette: FrogPalette, uid: string): string {
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

/** The still drawing as one SVG string. */
export function frogStillSvg(options: { color?: string | null; expression?: FrogExpression; size: number; uid?: string; palette?: FrogPalette }): string {
  const palette = options.palette ?? frogPalette(options.color);
  const parts = frogParts({ expression: options.expression ?? "neutral", size: options.size });
  const uid = options.uid ?? "frog";
  const draw = (ops: FrogOp[], key: string) => frogOpsToSvg(ops, palette, `${uid}${key}`);
  const layers = (["body", "handL", "handR", "head", "brows", "eyeL", "eyeR", "nose", "mouth", "extras"] as const).map((key) => draw(parts[key], key)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${frogViewBox(options.size)}" width="${options.size}" height="${options.size}">${layers}</svg>`;
}

