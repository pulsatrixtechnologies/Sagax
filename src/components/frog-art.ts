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
// sac (puff, croak), the tongue and the fly it catches, the hind legs of a
// hop, the lily pad and the water line.
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
  hands: [beanPath(38, 95.5, 6.5, 4.2), beanPath(62, 95.5, 6.5, 4.2)] as const,
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
  /** The hips the hind legs hang from, left and right. */
  hipL: [25, 91] as Point,
  hipR: [75, 91] as Point,
} as const;

/** The bust crop: the box an avatar under 48 px shows (the head and the shoulders). */
export const FROG_BUST = { x: 11, y: 14, w: 78, h: 78 } as const;
export const FROG_BUST_MAX = 48;

/** The outline width at a drawing size: 1.9 units, never under 1.6 screen px. */
export function frogOutline(size: number): number {
  const box = size <= FROG_BUST_MAX ? FROG_BUST.w : 100;
  return r2(Math.max(1.9, (1.6 * box) / Math.max(1, size)));
}

/** Every outline at once (glows, auras, the hit area). */
export const FROG_SILHOUETTE = `${FROG_ART.body} ${FROG_ART.head}`;

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
  smug: { shape: "M26.5 62Q38 58.6 50 59.2Q62 58.6 73.5 62Q75.4 64.4 73.5 67.2Q62 71.6 50 71.4Q38 71.6 26.5 67.2Q24.6 64.4 26.5 62Z", split: "M27.2 64.4Q50 63.2 72.8 64.4" },
  smile: { shape: "M27 59.5Q38 62 50 62.2Q62 62 73 59.5Q75 61.5 73.6 64Q63 71.6 50 71.6Q37 71.6 26.4 64Q25 61.5 27 59.5Z", split: "M27.6 61.4Q50 67.8 72.4 61.4" },
  side: { shape: "M33 63.2Q44 60.4 54 61Q63 60.6 71 62.6Q72.8 64.8 71 67.4Q62 70.6 54 70.4Q44 70.8 33 68.2Q31.2 65.6 33 63.2Z", split: "M33.6 65.6Q52 64.4 70.4 65" },
  o: { shape: "M40 59.5Q50 57.5 60 59.5Q64.5 65 60 71Q50 73.5 40 71Q35.5 65 40 59.5Z", inside: ellipsePath(50, 65.2, 3.6, 3.4) },
  rest: { shape: "M27.5 62.6Q38 60 50 60.6Q62 60 72.5 62.6Q74.4 65.2 72.5 68Q62 71.8 50 71.6Q38 71.8 27.5 68Q25.6 65.2 27.5 62.6Z", split: "M28.2 65.2Q50 66.8 71.8 65.2" },
  grin: {
    shape: "M26 58.5Q38 61.5 50 61.6Q62 61.5 74 58.5Q76 60.5 74.6 63.5Q64 75 50 75Q36 75 25.4 63.5Q24 60.5 26 58.5Z",
    inside: "M30.5 62.2Q50 66.6 69.5 62.2Q62 71.2 50 71.4Q38 71.2 30.5 62.2Z",
    tongue: ellipsePath(50, 71, 8, 3.6),
  },
  frown: { shape: "M27 66Q38 59.4 50 59.4Q62 59.4 73 66Q74.6 68.6 72.6 70.6Q62 68.4 50 68.8Q38 68.4 27.4 70.6Q25.4 68.6 27 66Z", split: "M27.8 68.2Q50 60.8 72.2 68.2" },
  wavy: { shape: "M30 62.4Q40 60 50 60.6Q60 60 70 62.4Q71.8 64.8 70 67.4Q60 70.4 50 70.2Q40 70.4 30 67.4Q28.2 64.8 30 62.4Z", split: "M30.6 64.8Q35.5 63 40.4 64.8Q45.3 66.6 50.2 64.8Q55.1 63 60 64.8Q64.9 66.6 69.4 64.8" },
  smirk: { shape: "M27 64Q38 60.6 50 60.4Q62 59.4 72.6 57.4Q75 59 73.8 62.4Q63 69.8 50 70.6Q38 71.6 27 68.4Q25 66.2 27 64Z", split: "M27.6 66.2Q50 64.4 73.2 59.8" },
  small: { shape: "M38 62.8Q44 61.2 50 61.4Q56 61.2 62 62.8Q63.4 65 62 67.2Q56 69 50 69Q44 69 38 67.2Q36.6 65 38 62.8Z", split: "M38.6 65Q50 64.2 61.4 65" },
  pout: { shape: "M29 64.6Q40 60.8 50 61.6Q60 60.8 71 64.6Q72.6 67.4 70.6 69.6Q60 70.2 50 70.4Q40 70.2 29.4 69.6Q27.4 67.4 29 64.6Z", split: "M29.6 67.4Q40 65.2 50 66.6Q60 65.2 70.4 67.4" },
  flat: { shape: "M30 63Q50 61 70 63Q71.6 65 70 67Q50 69.4 30 67Q28.4 65 30 63Z", split: "M30.6 65Q50 64.6 69.4 65" },
  croak: { shape: "M35 58.6Q50 55.6 65 58.6Q71 65.6 65 72.8Q50 76.2 35 72.8Q29 65.6 35 58.6Z", inside: ellipsePath(50, 65.8, 10, 5.8), tongue: ellipsePath(50, 69.6, 6, 2.4) },
  open: { shape: "M27 61.4Q38 58 50 58.6Q62 58 73 61.4Q75.2 64.6 73 67.8Q62 72.6 50 72.4Q38 72.6 27 67.8Q24.8 64.6 27 61.4Z", inside: ellipsePath(50, 65.2, 11, 2.8) },
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

/** A hind leg's joints at `extend` (0 folded..1 stretched), `s` -1 left, 1 right: hip, knee, ankle. */
export function frogLegJoints(s: -1 | 1, extend: number): { hip: Point; knee: Point; ankle: Point } {
  const [hx, hy] = s < 0 ? FROG_PIVOTS.hipL : FROG_PIVOTS.hipR;
  const e = Math.min(1.1, Math.max(0, extend));
  // folded: the knee out at the side, the ankle tucked back under it;
  // stretched: the knee opens and the foot reaches down and wide, a frog's V
  return {
    hip: [hx + s * 2, hy + 1],
    knee: [hx + s * (15 - 2 * e), hy + 2 + 6 * e],
    ankle: [hx + s * (9 + 7 * e), hy + 9 + 15 * e],
  };
}

/**
 * One hind leg's shin and webbed foot, behind the body: `extend` 0 (folded
 * under the body, hidden) .. 1 (stretched, a jump's push or the stretch after
 * a nap); `s` -1 left, 1 right. The thigh over it is frogHaunchOps.
 */
export function frogLegOps(s: -1 | 1, extend: number, ow: number): FrogOp[] {
  if (extend <= 0.02) return [];
  const { knee, ankle } = frogLegJoints(s, extend);
  const d = `M${fmt(knee[0])} ${fmt(knee[1])}L${fmt(ankle[0])} ${fmt(ankle[1])}`;
  // the webbed foot: three long toes fanned down and out, webbing between them, round tips
  const toes = [-1, 0, 1].map((k) => {
    const a = ((90 - s * 28 + k * 32) * Math.PI) / 180;
    return [ankle[0] + Math.cos(a) * 12.5, ankle[1] + Math.sin(a) * 10] as const;
  });
  const [t0, t1, t2] = toes;
  const web = (p: readonly [number, number], q: readonly [number, number]) => `Q${fmt(((p[0] + q[0]) / 2) * 0.9 + ankle[0] * 0.1)} ${fmt(((p[1] + q[1]) / 2) * 0.9 + ankle[1] * 0.1)} ${fmt(q[0])} ${fmt(q[1])}`;
  const foot = `M${fmt(ankle[0])} ${fmt(ankle[1] - 1.5)}L${fmt(t0[0])} ${fmt(t0[1])}${web(t0, t1)}${web(t1, t2)}Z`;
  return [
    { d, stroke: "line", width: r2(7.5 + 2 * ow), round: true },
    { d, stroke: "skin", width: 7.5, round: true },
    { d: foot, fill: "toe", stroke: "line", width: ow },
    ...toes.map(([tx, ty]) => ({ d: ellipsePath(tx, ty, 2.6, 2.4), fill: "toe" as const, stroke: "line" as const, width: r2(ow * 0.8) })),
  ];
}

/** One hind leg's thigh, over the body's lower corner: a haunch from the hip to the knee that grows as the leg opens. */
export function frogHaunchOps(s: -1 | 1, extend: number, ow: number): FrogOp[] {
  if (extend <= 0.02) return [];
  const { hip, knee } = frogLegJoints(s, extend);
  const k = Math.min(1, extend * 3);
  const cx = (hip[0] + knee[0]) / 2;
  const cy = (hip[1] + knee[1]) / 2;
  const len = Math.hypot(knee[0] - hip[0], knee[1] - hip[1]);
  const angle = (Math.atan2(knee[1] - hip[1], knee[0] - hip[0]) * 180) / Math.PI;
  const d = ellipsePath(cx, cy, (len / 2 + 6) * k, 7.6 * k, angle);
  return [...shaded(d, "skin", "shade", -1.2, -1.6), { d, stroke: "line", width: ow }];
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

