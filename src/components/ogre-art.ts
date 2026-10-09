// Ogre's drawing, in a 0..100 box (src/components/OgreMascot.tsx): the big
// green ogre in direction C, "aplat net", approved by JC on 2026-10-09, the
// same family as Shiba (shiba-art.ts). Two flat tones and one shade tone in
// a crescent per part, one uniform outline, geometric shapes: a bald
// inverted-pear head, trumpet ears, a heavy brow, a three-lobed nose, a wide
// mouth, a massive neck, a cream tunic under an open vest. The skin takes a
// quarter of the bot color (`ogreSkin`), the vest wears the color itself.
//
// Everything here is data and pure functions: the parts as path strings and
// draw operations with paint roles (`OgreRole`), so the component, the tests,
// the iOS export (ios-mascot-export.test.ts) and the keyframe renders read
// the same geometry. Paths use absolute M L C Q Z only, so they move and
// mirror by their coordinate pairs.
//
// Stances: `rest` is the approved art (head and shoulders); `stand` is the
// whole ogre (the same head, smaller, on a barrel of a body with arms and two
// legs) for the walk and the moves that need hands; `log` is the whole ogre
// sitting on a log for the nap. Arms and legs are two bones each, placed by
// their hand or foot (`armOps`, `legOps`), so the rig in ogre-moves.ts
// authors poses as points.
import { contrastRatio } from "../../shared/mascot-colors";
import { almondPath, ellipsePath, mirrorPath, mixColor, movePath, type Point } from "./shiba-art";

export { ellipsePath, mapPairs, mirrorPath, mixColor, movePath, type Point } from "./shiba-art";

/* ------------------------------------------------------------ helpers */

const r2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number) => String(r2(v));

function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v + m)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A base tone tinted by a color (the scratchpad's `tint`): the hue and the
 * lightness move toward the mix, the saturation never drops much under the
 * base's, so a green ogre in a grey bot stays a green ogre.
 */
export function tintColor(base: string, color: string, t: number): string {
  const m = toHsl(mixColor(base, color, t));
  const b = toHsl(base);
  return fromHsl([m[0], Math.max(m[1], b[1] * 0.92), (m[2] + b[2]) / 2]);
}

/** Two bones with the joint on the outer side (an elbow, a knee: toward `side`, -1 left, 1 right). */
export function twoBoneOut(root: Point, target: Point, a: number, b: number, side: -1 | 1): { joint: Point; end: Point } {
  const one = twoBone(root, target, a, b, 1);
  const other = twoBone(root, target, a, b, -1);
  return (one.joint[0] - other.joint[0]) * side >= 0 ? one : other;
}

/**
 * Two bones from `root` to `target` (an arm, a leg): where the joint goes.
 * The joint bends toward `bend` (-1 left of the root-target line, 1 right);
 * a target out of reach straightens the limb toward it.
 */
export function twoBone(root: Point, target: Point, a: number, b: number, bend: 1 | -1): { joint: Point; end: Point } {
  const dx = target[0] - root[0];
  const dy = target[1] - root[1];
  const reach = Math.hypot(dx, dy) || 0.0001;
  const d = Math.min(reach, a + b - 0.001);
  const ux = dx / reach;
  const uy = dy / reach;
  const end: Point = [root[0] + ux * d, root[1] + uy * d];
  // law of cosines: how far along the line the joint's foot sits, then how far off it
  const foot = (a * a - b * b + d * d) / (2 * d);
  const off = Math.sqrt(Math.max(0, a * a - foot * foot));
  const joint: Point = [root[0] + ux * foot - uy * off * bend, root[1] + uy * foot + ux * off * bend];
  return { joint, end };
}

/* ----------------------------------------------------------- geometry */

const EAR_L = "M23 37.5C20 37.5 17 36.5 14.5 35L9.5 29Q7.2 26.7 6.2 30.1L5.4 42.3Q5.6 45.9 8.6 44.9L14.5 42.5C17.5 43.7 20.5 45.5 23.5 47Z";
const EAR_IN_L = "M7.8 31.5Q10.2 32.1 10.4 37.5Q10.2 42.9 7.8 42.7Q6.6 37.1 7.8 31.5Z";
const VEST_L = "M5 80L41 80C39.6 86 39.4 93 40.4 101L5 101Z";

/** The approved parts (scratchpad others-c.mjs, `OGRE`), plus the whole body for the moves. */
export const OGRE_ART = {
  head: "M50 16.5C61 16.5 69.5 22 71.5 31.5C76.5 37 80.5 45.5 80.5 54.5C80.5 67.5 68 75.5 50 75.5C32 75.5 19.5 67.5 19.5 54.5C19.5 45.5 23.5 37 28.5 31.5C30.5 22 39 16.5 50 16.5Z",
  /** The trumpet ears: a stem, then the bell, its dark opening. */
  earL: EAR_L,
  earR: mirrorPath(EAR_L),
  earInL: EAR_IN_L,
  earInR: mirrorPath(EAR_IN_L),
  /** The massive neck, drawn before the tunic so the tunic covers its lower edge. */
  neck: "M33 64C33 72 32.5 78.5 31 85L69 85C67.5 78.5 67 72 67 64Z",
  /** The shoulders: the cream tunic, the two halves of the open vest (clipped to it), the V collar in skin. */
  body: "M9 99C9 91 14.5 86 25 84C32 82.8 40 82.4 50 82.4C60 82.4 68 82.8 75 84C85.5 86 91 91 91 99Z",
  vestL: VEST_L,
  vestR: mirrorPath(VEST_L),
  collar: "M41.5 81L50 91.5L58.5 81Z",
  /** The vest's two front edges. */
  seams: "M41 82.4C39.6 87 39.4 93 40.2 99M59 82.4C60.4 87 60.6 93 59.8 99",
  nose: "M50 46.5C53.5 46.5 55 49.5 55.5 52C58.5 52 60.8 54.2 60.8 56.8C60.8 59.6 58.2 61.2 55.6 60.6C54 61.9 52 62.4 50 62.4C48 62.4 46 61.9 44.4 60.6C41.8 61.2 39.2 59.6 39.2 56.8C39.2 54.2 41.5 52 44.5 52C45 49.5 46.5 46.5 50 46.5Z",
  nostrils: [
    [46, 59.4],
    [54, 59.4],
  ] as const,
  /** The whole ogre (stand): the neck, the barrel body in the vest, the cream tunic front, the belt and its buckle. */
  standNeck: "M43 34C43 39 42.6 42.6 42 46L58 46C57.4 42.6 57 39 57 34Z",
  torso: "M30 47C34 44.6 41 43.8 50 43.8C59 43.8 66 44.6 70 47C75.5 50 78.5 57 79 64.5C79.6 74 74 81.5 63 82.5L37 82.5C26 81.5 20.4 74 21 64.5C21.5 57 24.5 50 30 47Z",
  /** The tunic showing between the vest's halves: the belly. */
  belly: "M43.5 44.6L56.5 44.6C60 52 64.6 58 64.6 67C64.6 76 58.5 82.6 50 82.6C41.5 82.6 35.4 76 35.4 67C35.4 58 40 52 43.5 44.6Z",
  standCollar: "M44 44.2L50 50.6L56 44.2Z",
  belt: "M18 73.4Q50 78.6 82 73.4L82 78.6Q50 83.8 18 78.6Z",
  buckle: "M46.4 75.4L53.6 75.4L53.6 81.2L46.4 81.2Z",
  /** The log the ogre naps on (behind the legs), its cut end, the bark. */
  log: "M12 86C12 83.6 13.6 82 16 82L84 82C86.4 82 88 83.6 88 86L88 94C88 96.4 86.4 98 84 98L16 98C13.6 98 12 96.4 12 94Z",
  logEnd: ellipsePath(84.6, 90, 3.4, 7.4),
  logRing: ellipsePath(84.6, 90, 1.5, 3.4),
  bark: "M17 87L28 87M21 93.4L31 93.4M70 86.4L77 86.4M66 93L76 93",
  /** The face's anchors. */
  eye: { y: 44.5, dx: 10.5, w: 5, h: 4.1 },
  brow: { y: 38.2, dx: 10.5, rx: 6.2, ry: 2.9 },
} as const;

/** Where each moving part turns (box units, in the rest drawing). */
export const OGRE_PIVOTS = {
  /** Each ear's root, hidden under the head's edge. */
  earL: [22, 42] as Point,
  earR: [78, 42] as Point,
  /** The neck: the head nods and tilts about it. */
  neck: [50, 70] as Point,
  /** The ground under the boots (stand) or the shoulders' bottom (rest): squash, stomps. */
  ground: [50, 99] as Point,
  /** The belly's bottom: its jiggle scales about it. */
  belly: [50, 82.6] as Point,
  eyeL: [39.5, 44.5] as Point,
  eyeR: [60.5, 44.5] as Point,
  mouth: [50, 67] as Point,
} as const;

/** The whole ogre's joints (stand): shoulders, hips; where the hands and the boots rest. */
export const OGRE_BODY = {
  shoulderL: [29.5, 50.5] as Point,
  shoulderR: [70.5, 50.5] as Point,
  hipL: [41.5, 79.5] as Point,
  hipR: [58.5, 79.5] as Point,
  handL: [22.4, 74.4] as Point,
  handR: [77.6, 74.4] as Point,
  footL: [40, 94.4] as Point,
  footR: [60, 94.4] as Point,
} as const;
/** Bone lengths and thickness, box units. */
export const ARM = { upper: 13, fore: 13, width: 8.6, hand: 5 } as const;
export const LEG = { thigh: 8.4, shin: 8.4, width: 10.4 } as const;

/** Where the head sits on each body: offset (box units) and scale about the neck; how far the body drops. The rest art is the reference. */
export const STANCE_HEAD = {
  rest: { x: 0, y: 0, scale: 1 },
  stand: { x: 0, y: -31, scale: 0.58 },
  log: { x: 0, y: -22.5, scale: 0.58 },
} as const;
export type OgreStance = keyof typeof STANCE_HEAD;
export const OGRE_STANCES = Object.keys(STANCE_HEAD) as OgreStance[];
/** How far the whole body sits lower on the log than standing. */
export const LOG_DROP = 8.5;
/** Where the boots rest on the log (knees out, feet on the ground). */
export const LOG_FEET = { footL: [31, 94.6] as Point, footR: [69, 94.6] as Point, handL: [32.4, 86.6] as Point, handR: [67.6, 86.6] as Point } as const;

/** The bust crop: the box an avatar under 48 px shows (the head and the trumpets). */
export const OGRE_BUST = { x: 5, y: 12, w: 90, h: 90 } as const;
export const OGRE_BUST_MAX = 48;

/** The outline width at a drawing size: 1.9 units, never under 1.6 screen px. */
export function ogreOutline(size: number): number {
  const box = size <= OGRE_BUST_MAX ? OGRE_BUST.w : 100;
  return r2(Math.max(1.9, (1.6 * box) / Math.max(1, size)));
}

/** Every outline at once, at rest (glows, auras, the hit area). */
export const OGRE_SILHOUETTE = `${OGRE_ART.earL} ${OGRE_ART.earR} ${OGRE_ART.body} ${OGRE_ART.head}`;

/* -------------------------------------------------------------- colors */

/** What every part is painted with; a skin maps each role to a paint (ogre skins in skin-fx/ogre-skins.tsx). */
export const OGRE_ROLES = [
  "skin",
  "skinShade",
  "line",
  "earIn",
  "brow",
  "lid",
  "tunic",
  "tunicShade",
  "vest",
  "vestShade",
  "pants",
  "boot",
  "buckle",
  "ink",
  "pupil",
  "white",
  "spec",
  "mouth",
  "tongue",
  "teeth",
  "blush",
  "sweat",
  "nostril",
  "log",
  "logShade",
  "logEnd",
  "mark",
] as const;
export type OgreRole = (typeof OGRE_ROLES)[number];
export type OgrePalette = Record<OgreRole, string>;

/** The archetype's own green, and the color the vest shows where no bot gives one. */
export const OGRE_SKIN = "#9DBE4A";
export const OGRE_VEST = "#7A5232";
export const OGRE_TUNIC = "#F1E6CB";
/** How much of the bot color the green skin takes. */
export const SKIN_TINT = 0.24;
/** How far the vest leans toward brown leather (the approved art). */
export const VEST_LEATHER = 0.42;
/** The least contrast between the vest and the tunic before the vest is darkened. */
export const VEST_MIN_CONTRAST = 1.6;

/** The skin for a bot color: the ogre green, a quarter of the way toward it. */
export function ogreSkin(hex: string | null | undefined): string {
  return hex ? tintColor(OGRE_SKIN, hex, SKIN_TINT) : OGRE_SKIN;
}

/**
 * The vest for a bot color: the color worn as leather (VEST_LEATHER toward
 * brown), and for a light one (white, cream, the pastels) darkened just
 * enough that the cream tunic still reads against it.
 */
export function ogreVest(hex: string | null | undefined): string {
  if (!hex) return OGRE_VEST;
  // the approved vest: the color worn like leather, a little toward brown
  const base = mixColor(hex, "#3a2410", VEST_LEATHER);
  let vest = base;
  for (let k = 0.04; k <= 0.7 && contrastRatio(vest, OGRE_TUNIC) < VEST_MIN_CONTRAST; k += 0.04) vest = mixColor(base, "#1a1008", r2(k));
  return vest;
}

/** The plain palette for a bot color: the skin a quarter toward it, the vest in it. */
export function ogrePalette(hex: string | null | undefined, overrides: { skin?: string; vest?: string } = {}): OgrePalette {
  const skin = overrides.skin ?? ogreSkin(hex);
  const vest = overrides.vest ?? ogreVest(hex);
  const skinDark = mixColor(skin, "#14200a", 0.52);
  return {
    skin,
    skinShade: mixColor(skin, "#1f3a10", 0.3),
    line: mixColor(skin, "#14200a", 0.74),
    earIn: skinDark,
    brow: skinDark,
    lid: skin,
    tunic: OGRE_TUNIC,
    tunicShade: mixColor("#E2D0A8", vest, 0.12),
    vest,
    vestShade: mixColor(vest, "#1a0e06", 0.28),
    pants: "#4E3A2A",
    boot: "#2E2219",
    buckle: "#D9B45A",
    ink: "#22180F",
    pupil: "#22180F",
    white: "#ffffff",
    spec: "#ffffff",
    mouth: "#4A1F1A",
    tongue: "#F07F86",
    teeth: "#FFF8E6",
    blush: "#E9877A",
    sweat: "#9CD3F5",
    nostril: "#22180F",
    log: "#8A5A34",
    logShade: "#5E3B20",
    logEnd: "#D9B27C",
    mark: skinDark,
  };
}

/* ----------------------------------------------------------- draw ops */

/** One drawing operation: a path filled and/or stroked with roles, maybe clipped to another path. */
export interface OgreOp {
  d: string;
  fill?: OgreRole;
  stroke?: OgreRole;
  width?: number;
  opacity?: number;
  /** Drawn clipped to this path. */
  clip?: string;
  /** Round caps (open strokes). */
  round?: boolean;
}

/** A part filled flat with a shade crescent: the shade, then the base moved up-left over it, clipped to the part. */
function shaded(d: string, base: OgreRole, shade: OgreRole, dx: number, dy: number): OgreOp[] {
  return [
    { d, fill: shade },
    { d: movePath(d, dx, dy), fill: base, clip: d },
  ];
}

const outline = (d: string, width: number): OgreOp => ({ d, stroke: "line", width });
const clipped = (ops: OgreOp[], clip: string): OgreOp[] => ops.map((op) => ({ ...op, clip }));

/* ---------------------------------------------------------- expressions */

/**
 * The sixteen faces, the same ids as the Shapes (shape-engine.ts
 * SHAPE_EXPRESSIONS) so a state or a clip names one face for every
 * character. The five approved moods are five of them: idle is neutral,
 * happy is happy, thinking is curious, alert is surprised, sleepy is sleepy.
 */
export const OGRE_EXPRESSIONS = ["neutral", "attentive", "surprised", "excited", "happy", "laughing", "angry", "sad", "scared", "suspicious", "confused", "curious", "proud", "shy", "bored", "sleepy"] as const;
export type OgreExpression = (typeof OGRE_EXPRESSIONS)[number];

/** The approved moods, by their expression. */
export const OGRE_MOOD_EXPRESSION = { idle: "neutral", happy: "happy", thinking: "curious", alert: "surprised", sleepy: "sleepy" } as const satisfies Record<string, OgreExpression>;

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

/**
 * The mouths: the approved five (smile, grin, side, o, small) and the ones
 * the other faces and the moves need: a belly laugh, a roar with the lower
 * tusks out, a chomp of clenched teeth, a gritted snarl.
 */
export const OGRE_MOUTHS = ["smile", "grin", "side", "o", "small", "flat", "frown", "wavy", "open", "smirk", "grit", "laugh", "roar", "chomp", "snore"] as const;
export type OgreMouth = (typeof OGRE_MOUTHS)[number];

export interface OgreFace {
  eyes: readonly [EyeSpec, EyeSpec];
  /** Each brow: rise (box units, - up) and turn (degrees, + clockwise). */
  brows: { l: Point; r: Point };
  mouth: OgreMouth;
  blush?: boolean;
  sweat?: boolean;
  z?: boolean;
}

const open = (look: Point, pupil: number, lid: number, lidTilt = 0, scale = 1): OpenEye => ({ kind: "open", look, pupil, lid, lidTilt, scale });
const pair = (eye: EyeSpec, right: EyeSpec = eye) => [eye, right] as const;

export const OGRE_FACES: Readonly<Record<OgreExpression, OgreFace>> = {
  // approved idle: a heavy-lidded side look, the wide smile with its dimples
  neutral: { eyes: pair(open([0.6, 0.4], 2.1, 0.3, -0.5)), brows: { l: [0, -6], r: [0, 6] }, mouth: "smile" },
  attentive: { eyes: pair(open([0, 0.2], 2.2, 0.08)), brows: { l: [-1.8, -3], r: [-1.8, 3] }, mouth: "small" },
  // approved alert
  surprised: { eyes: pair(open([0, 0.2], 2.2, 0, 0, 1.16)), brows: { l: [-3.4, 2], r: [-3.4, -2] }, mouth: "o" },
  excited: { eyes: pair(open([0, -0.4], 2.4, 0, 0, 1.1)), brows: { l: [-3.8, -8], r: [-3.8, 8] }, mouth: "open" },
  // approved happy
  happy: { eyes: pair({ kind: "arch" }), brows: { l: [-1.6, -9], r: [-1.6, 9] }, mouth: "grin" },
  laughing: { eyes: pair({ kind: "squint" }), brows: { l: [-2.6, -12], r: [-2.6, 12] }, mouth: "laugh", blush: true },
  angry: { eyes: pair(open([0, 0.6], 2, 0.42, 2.4)), brows: { l: [2, 18], r: [2, -18] }, mouth: "grit" },
  sad: { eyes: pair(open([0, 1.2], 2, 0.3, -2)), brows: { l: [-0.8, -18], r: [-0.8, 18] }, mouth: "frown" },
  scared: { eyes: pair(open([0, 0.4], 1.6, 0, 0, 1.12)), brows: { l: [-4, -14], r: [-4, 14] }, mouth: "wavy", sweat: true },
  suspicious: { eyes: pair(open([2.6, 0.4], 2, 0.5)), brows: { l: [1.6, 8], r: [-2.6, -4] }, mouth: "flat" },
  confused: { eyes: [open([1, 0], 2.1, 0.05, 0, 1.06), open([1, 0.4], 1.9, 0.38, 0.8, 0.94)], brows: { l: [-4, -14], r: [1.2, 8] }, mouth: "wavy" },
  // approved thinking
  curious: { eyes: pair(open([-1.8, -1.2], 2.1, 0.2)), brows: { l: [-3.4, -14], r: [0.8, 8] }, mouth: "side" },
  proud: { eyes: pair(open([0, -1.2], 2, 0.46, -0.4)), brows: { l: [-2.6, -6], r: [-2.6, 6] }, mouth: "smirk" },
  shy: { eyes: pair(open([-2.2, 1.2], 2, 0.16)), brows: { l: [-1, -12], r: [-1, 12] }, mouth: "small", blush: true },
  bored: { eyes: pair(open([0, 0.8], 2, 0.56)), brows: { l: [1.4, -2], r: [1.4, 2] }, mouth: "flat" },
  // approved sleepy
  sleepy: { eyes: pair({ kind: "closed" }), brows: { l: [1.2, 4], r: [1.2, -4] }, mouth: "small", z: true },
};

/* -------------------------------------------------------------- layers */

/** One eye's ops; `s` is -1 for the left eye, 1 for the right. */
export function eyeOps(spec: EyeSpec, s: -1 | 1, ow: number): OgreOp[] {
  const { eye } = OGRE_ART;
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
  const ops: OgreOp[] = [
    { d, fill: "white" },
    { d: ellipsePath(px, py, pr, pr), fill: "pupil", clip: d },
    { d: ellipsePath(px + pr * 0.35, py - pr * 0.4, pr * 0.34, pr * 0.34), fill: "spec", clip: d },
  ];
  if (spec.lid > 0) {
    const top = cy - h - 0.4;
    const lidY = top + spec.lid * (2 * h);
    const tilt = s * spec.lidTilt;
    const L = w + 6;
    ops.push(
      { d: `M${fmt(cx - L)} ${fmt(top - 8)}L${fmt(cx + L)} ${fmt(top - 8)}L${fmt(cx + L)} ${fmt(lidY - tilt)}L${fmt(cx - L)} ${fmt(lidY + tilt)}Z`, fill: "lid", clip: d },
      { d: `M${fmt(cx - L)} ${fmt(lidY + tilt)}L${fmt(cx + L)} ${fmt(lidY - tilt)}`, stroke: "ink", width: ow, clip: d },
    );
  }
  ops.push({ d, stroke: "ink", width: ow });
  return ops;
}

/** The two brows: thick capsules in the dark skin tone, the ogre's heavy arcade. */
export function browOps(face: OgreFace): OgreOp[] {
  const { brow } = OGRE_ART;
  return ([-1, 1] as const).map((s) => {
    const [dy, rot] = s < 0 ? face.brows.l : face.brows.r;
    return { d: ellipsePath(50 + s * brow.dx, brow.y + dy, brow.rx, brow.ry, rot), fill: "brow" as const };
  });
}

/** The big three-lobed nose, which every face shares, and its two nostrils. */
export function noseOps(ow: number): OgreOp[] {
  const { nose, nostrils } = OGRE_ART;
  return [...shaded(nose, "skin", "skinShade", -1.6, -1.8), outline(nose, ow), ...nostrils.map(([x, y]) => ({ d: ellipsePath(x, y, 1.4, 1), fill: "nostril" as const }))];
}

/** The mouth (the approved art draws it 1.5 units up: baked in here). */
export function mouthOps(kind: OgreMouth, ow: number): OgreOp[] {
  const up = (d: string) => movePath(d, 0, -1.5);
  const line = (d: string, width = ow): OgreOp => ({ d: up(d), stroke: "ink", width, round: true });
  const hole = (d: string): OgreOp => ({ d: up(d), fill: "mouth" });
  const edge = (d: string): OgreOp => ({ d: up(d), stroke: "ink", width: ow });
  const inside = (d: string, fill: OgreRole, clip: string): OgreOp => ({ d: up(d), fill, clip: up(clip) });
  switch (kind) {
    case "smile":
      return [line("M37 66Q50 73.5 63 66"), line("M35.6 64.6Q36.2 66.6 38.2 67"), line("M64.4 64.6Q63.8 66.6 61.8 67")];
    case "grin": {
      const d = "M35.5 65Q50 68.5 64.5 65Q62.5 77 50 77Q37.5 77 35.5 65Z";
      return [hole(d), inside("M30 60L70 60L70 69.6Q50 72.2 30 69.6Z", "teeth", d), inside(ellipsePath(50, 77, 7, 4), "tongue", d), edge(d)];
    }
    case "side":
      return [line("M42 68.5Q50 67 57 67.6Q59.6 67 61 64.8")];
    case "o":
      return [{ d: up(ellipsePath(50, 69.5, 4, 4.4)), fill: "mouth", stroke: "ink", width: ow }];
    case "small":
      return [line("M42 67Q50 71.5 58 67")];
    case "flat":
      return [line("M41 68.4Q50 67.4 59 68.4")];
    case "frown":
      return [line("M39 71Q50 63.6 61 71")];
    case "wavy":
      return [line("M39 68.4Q42 66.4 45 68.4Q48 70.4 51 68.4Q54 66.4 57 68.4Q59 69.6 61 68.4")];
    case "smirk":
      return [line("M40 67.4Q48 70.6 56 68.4Q59.4 67.4 61.6 64.6"), line("M62.6 63.2Q62.4 65.4 60.4 66.2")];
    case "open": {
      const d = "M39 65.5Q50 68 61 65.5Q60 75.4 50 75.6Q40 75.4 39 65.5Z";
      return [hole(d), inside(ellipsePath(50, 75.4, 6, 3.4), "tongue", d), edge(d)];
    }
    case "grit": {
      // clenched teeth, the angry snarl
      const d = "M38.6 65.8Q50 64 61.4 65.8Q62.2 69.2 61.4 72.4Q50 74.2 38.6 72.4Q37.8 69.2 38.6 65.8Z";
      return [{ d: up(d), fill: "teeth" }, line("M38.4 69.2Q50 70 61.6 69.2", r2(ow * 0.7)), line("M44.4 65.2L44.4 73.2M50 64.8L50 73.6M55.6 65.2L55.6 73.2", r2(ow * 0.6)), edge(d)];
    }
    case "laugh": {
      // the belly laugh: wide open, the top teeth, a big tongue
      const d = "M32.6 63Q50 67.4 67.4 63Q66 78.4 50 78.6Q34 78.4 32.6 63Z";
      return [hole(d), inside("M28 58L72 58L72 68.6Q50 71.8 28 68.6Z", "teeth", d), inside(ellipsePath(50, 79, 9, 5.4), "tongue", d), edge(d)];
    }
    case "roar": {
      // the roar: the jaw dropped, top teeth, the two lower tusks up
      const d = "M35.6 62Q50 64.6 64.4 62Q65 82.4 50 83.4Q35 82.4 35.6 62Z";
      const tusk = "M38.6 80.6L41.4 71.6L44.4 80.4Z";
      return [
        hole(d),
        inside("M28 56L72 56L72 66.6Q50 69.4 28 66.6Z", "teeth", d),
        inside(ellipsePath(50, 82.4, 7.4, 3.8), "tongue", d),
        inside(tusk, "teeth", d),
        inside(mirrorPath(tusk), "teeth", d),
        { d: up(tusk), stroke: "ink", width: r2(ow * 0.6), clip: up(d) },
        { d: up(mirrorPath(tusk)), stroke: "ink", width: r2(ow * 0.6), clip: up(d) },
        edge(d),
      ];
    }
    case "chomp": {
      // a mouthful: the teeth closed on it, the cheeks round
      const d = "M38 65.6Q50 69.2 62 65.6Q61 72.4 50 73Q39 72.4 38 65.6Z";
      return [{ d: up(d), fill: "teeth" }, line("M38.8 69Q50 71.4 61.2 69", r2(ow * 0.7)), line("M44 67L44 72M50 67.6L50 72.8M56 67L56 72", r2(ow * 0.55)), edge(d)];
    }
    case "snore": {
      // asleep with the mouth dropped open
      const d = "M44 67.2Q50 66 56 67.2Q57 73.6 50 74Q43 73.6 44 67.2Z";
      return [hole(d), edge(d)];
    }
  }
}

/** What a face adds: blush, a sweat drop, the sleeping z. */
export function extraOps(face: OgreFace, ow: number, bust: boolean): OgreOp[] {
  const ops: OgreOp[] = [];
  if (face.blush) for (const s of [-1, 1]) ops.push({ d: ellipsePath(50 + s * 21.5, 61, 4.2, 2.3), fill: "blush", opacity: 0.55 });
  if (face.sweat) ops.push({ d: "M77 25C77 25 74.4 29 74.4 30.8C74.4 32.4 75.6 33.5 77 33.5C78.4 33.5 79.6 32.4 79.6 30.8C79.6 29 77 25 77 25Z", fill: "sweat", stroke: "line", width: r2(ow * 0.6) });
  if (face.z && !bust) {
    const z = "M80 13L86 13L80 20L86 20";
    ops.push({ d: z, stroke: "line", width: 3.6, round: true }, { d: z, stroke: "tunic", width: 1.8, round: true });
  }
  return ops;
}

/** The skin marks a skin asks for: glowing cracks (Lava) on the head, ears and neck; rivets (Armor) on the vest. */
export type OgreMarks = "cracks" | "rivets";

/** The Lava ogre's cracks on the head (stroked in the `mark` role). */
export const CRACKS_HEAD = "M33 26.4L35.6 31.4L33.6 35.8M66.4 24.6L63.4 29.6L65.6 33M75.6 47L71.4 50.4L73.4 55.6M24.6 52L28.6 54.6L27 59.4M57 18.6L55.4 22.6L57.6 25.4M30 66.4L34.6 67.8M68.6 65.6L65.2 68.6";
export const CRACKS_EAR_L = "M12.6 35.6L16.6 38.4L19.6 37.8";
export const CRACKS_NECK = "M38 73L41 77.6L39.8 81M62 72L59.4 76.4";
export const CRACKS_STAND_NECK = "M46 37L48 40.4";
export const CRACKS_ARM = 0.5;

/** One rivet. */
const rivet = (x: number, y: number): OgreOp => ({ d: ellipsePath(x, y, 1.1, 1.1), fill: "buckle", stroke: "line", width: 0.6 });

function markOps(marks: OgreMarks | null | undefined, stance: OgreStance, part: "head" | "earL" | "earR" | "body"): OgreOp[] {
  if (!marks) return [];
  if (marks === "cracks") {
    if (part === "head") return [{ d: CRACKS_HEAD, stroke: "mark", width: 1.4, round: true, clip: OGRE_ART.head }];
    if (part === "earL") return [{ d: CRACKS_EAR_L, stroke: "mark", width: 1.2, round: true, clip: OGRE_ART.earL }];
    if (part === "earR") return [{ d: mirrorPath(CRACKS_EAR_L), stroke: "mark", width: 1.2, round: true, clip: OGRE_ART.earR }];
    return [{ d: stance === "rest" ? CRACKS_NECK : stanceBody(CRACKS_STAND_NECK, stance), stroke: "mark", width: 1.3, round: true }];
  }
  if (part !== "body") return [];
  if (stance === "rest") return [rivet(35.6, 86.4), rivet(35.2, 92.6), rivet(64.4, 86.4), rivet(64.8, 92.6), rivet(18, 90.4), rivet(82, 90.4)];
  const dy = stance === "log" ? LOG_DROP : 0;
  return [rivet(37.6, 53 + dy), rivet(35.4, 60 + dy), rivet(62.4, 53 + dy), rivet(64.6, 60 + dy), rivet(25.4, 58 + dy), rivet(74.6, 58 + dy)];
}

/** A body path moved to a stance (the log drops it). */
const stanceBody = (d: string, stance: OgreStance) => (stance === "log" ? movePath(d, 0, LOG_DROP) : d);
export const stancePoint = (p: Point, stance: OgreStance): Point => (stance === "log" ? [p[0], p[1] + LOG_DROP] : p);

/** An arm (whole ogre), shoulder to hand: the bare skin limb and the fist. `side` -1 left, 1 right; the elbow bends outward unless `bend` says otherwise. */
export function armOps(side: -1 | 1, hand: Point, ow: number, options: { stance?: OgreStance; bend?: 1 | -1; open?: boolean; root?: Point; bulge?: number } = {}): OgreOp[] {
  const stance = options.stance ?? "stand";
  const shoulder = options.root ?? stancePoint(side < 0 ? OGRE_BODY.shoulderL : OGRE_BODY.shoulderR, stance);
  // the elbow goes out, away from the body, unless the pose says otherwise
  const { joint, end } = options.bend ? twoBone(shoulder, hand, ARM.upper, ARM.fore, options.bend) : twoBoneOut(shoulder, hand, ARM.upper, ARM.fore, side);
  const d = `M${fmt(shoulder[0])} ${fmt(shoulder[1])}L${fmt(joint[0])} ${fmt(joint[1])}L${fmt(end[0])} ${fmt(end[1])}`;
  const fist = ellipsePath(end[0], end[1] + 0.4, ARM.hand, ARM.hand * 0.92);
  const ops: OgreOp[] = [
    { d, stroke: "line", width: r2(ARM.width + 2 * ow), round: true },
    { d, stroke: "skin", width: ARM.width, round: true },
    // the shade along the arm's lower side
    { d: movePath(d, 2.1, 1.1), stroke: "skinShade", width: r2(ARM.width * 0.42), round: true },
  ];
  if (options.bulge) {
    // the flexed biceps: a round swell on the upper arm, toward the hand's side
    const k = options.bulge;
    const mx = (shoulder[0] + joint[0]) / 2;
    const my = (shoulder[1] + joint[1]) / 2;
    const ux = joint[0] - shoulder[0];
    const uy = joint[1] - shoulder[1];
    const len = Math.hypot(ux, uy) || 1;
    // the side of the upper arm the forearm folds toward
    const fx = end[0] - joint[0];
    const fy = end[1] - joint[1];
    const toward = Math.sign(ux * fy - uy * fx) || 1;
    const nx = (-uy / len) * toward;
    const ny = (ux / len) * toward;
    const swell = ellipsePath(mx + nx * 2.6 * k, my + ny * 2.6 * k, (len / 2) * 0.95, ARM.width * 0.42 * (0.6 + 0.6 * k), (Math.atan2(uy, ux) * 180) / Math.PI);
    ops.push(...shaded(swell, "skin", "skinShade", -0.8, -1), outline(swell, ow), { d, stroke: "skin", width: r2(ARM.width - 1.2), round: true, clip: swell });
  }
  ops.push(...shaded(fist, "skin", "skinShade", -1, -1.1), outline(fist, ow));
  if (options.open) {
    // an open hand (the wave): three finger tips over the fist
    for (const k of [-1, 0, 1]) {
      const fx = end[0] + k * 2.6;
      const fy = end[1] - 4.4 + Math.abs(k) * 0.9;
      const finger = ellipsePath(fx, fy, 1.6, 2.2);
      ops.push({ d: finger, fill: "skin", stroke: "line", width: r2(ow * 0.8) });
    }
  }
  return ops;
}

/** A leg (whole ogre), hip to boot: the trousers and the boot. The knee bends outward. */
export function legOps(side: -1 | 1, foot: Point, ow: number, options: { stance?: OgreStance; root?: Point } = {}): OgreOp[] {
  const stance = options.stance ?? "stand";
  const hip = options.root ?? stancePoint(side < 0 ? OGRE_BODY.hipL : OGRE_BODY.hipR, stance);
  const { joint, end } = twoBoneOut(hip, foot, LEG.thigh, LEG.shin, side);
  const d = `M${fmt(hip[0])} ${fmt(hip[1])}L${fmt(joint[0])} ${fmt(joint[1])}L${fmt(end[0])} ${fmt(end[1])}`;
  // the boot points a little outward
  const boot = ellipsePath(end[0] + side * 1.4, end[1] + 1, 6.4, 3.4);
  return [
    { d, stroke: "line", width: r2(LEG.width + 2 * ow), round: true },
    { d, stroke: "pants", width: LEG.width, round: true },
    { d: boot, fill: "boot", stroke: "line", width: ow },
    { d: ellipsePath(end[0] + side * 0.4, end[1] - 0.2, 2.6, 1), fill: "spec", opacity: 0.18 },
  ];
}

export interface OgrePartsInput {
  expression: OgreExpression;
  /** A move's own mouth (the roar, the chomp) over the face's. */
  mouth?: OgreMouth | null;
  stance?: OgreStance;
  /** The drawing's size in px: the outline and the bust crop follow it. */
  size: number;
  /** A skin's marks (Lava's cracks, Armor's rivets). */
  marks?: OgreMarks | null;
}

/** The drawing's parts as ops, each a group the rig moves on its own. Limbs are empty at rest and drawn by the rig (armOps, legOps) elsewhere. */
export interface OgreParts {
  log: OgreOp[];
  legL: OgreOp[];
  legR: OgreOp[];
  body: OgreOp[];
  belly: OgreOp[];
  armL: OgreOp[];
  armR: OgreOp[];
  earL: OgreOp[];
  earR: OgreOp[];
  head: OgreOp[];
  brows: OgreOp[];
  eyeL: OgreOp[];
  eyeR: OgreOp[];
  nose: OgreOp[];
  mouth: OgreOp[];
  extras: OgreOp[];
}

/** The body for a stance: the approved shoulders, or the whole barrel with its belly, belt and limbs at rest. */
function bodyOps(stance: OgreStance, ow: number, marks: OgreMarks | null | undefined): Pick<OgreParts, "log" | "legL" | "legR" | "body" | "belly" | "armL" | "armR"> {
  const A = OGRE_ART;
  if (stance === "rest") {
    return {
      log: [],
      legL: [],
      legR: [],
      body: [
        ...shaded(A.neck, "skin", "skinShade", -1.5, 3.4),
        outline(A.neck, ow),
        ...markOps(marks, stance, "body").filter((op) => op.stroke === "mark"),
        ...shaded(A.body, "tunic", "tunicShade", -3, -1),
        ...clipped([...shaded(A.vestL, "vest", "vestShade", -2, -1), ...shaded(A.vestR, "vest", "vestShade", -2, -1), { d: A.collar, fill: "skin" }], A.body),
        outline(A.seams, ow),
        outline(A.body, ow),
        { ...outline(A.collar.replace("Z", ""), ow), clip: A.body },
        ...markOps(marks, stance, "body").filter((op) => op.stroke !== "mark"),
      ],
      belly: [],
      armL: [],
      armR: [],
    };
  }
  const at = (d: string) => stanceBody(d, stance);
  const torso = at(A.torso);
  const neck = at(A.standNeck);
  const feet = stance === "log" ? LOG_FEET : OGRE_BODY;
  const hands = stance === "log" ? LOG_FEET : OGRE_BODY;
  return {
    log:
      stance === "log"
        ? [...shaded(A.log, "log", "logShade", -2, -2), outline(A.log, ow), { d: A.logEnd, fill: "logEnd", stroke: "line", width: ow }, { d: A.logRing, stroke: "logShade", width: 0.9 }, { d: A.bark, stroke: "logShade", width: 1.4, round: true }]
        : [],
    legL: legOps(-1, feet.footL, ow, { stance }),
    legR: legOps(1, feet.footR, ow, { stance }),
    body: [
      ...shaded(neck, "skin", "skinShade", -1.2, 2.6),
      outline(neck, ow),
      ...markOps(marks, stance, "body").filter((op) => op.stroke === "mark"),
      ...shaded(torso, "vest", "vestShade", -3, -1.6),
      outline(torso, ow),
      ...markOps(marks, stance, "body").filter((op) => op.stroke !== "mark"),
    ],
    belly: [
      ...clipped(shaded(at(A.belly), "tunic", "tunicShade", -2.4, -1.4), torso),
      { ...outline(at(A.belly), ow), clip: torso },
      ...clipped([{ d: at(A.standCollar), fill: "skin" }], torso),
      { ...outline(at(A.standCollar).replace("Z", ""), ow), clip: torso },
      ...clipped([{ d: at(A.belt), fill: "pants" }], torso),
      { ...outline(at(A.belt), ow), clip: torso },
      { d: at(A.buckle), fill: "buckle", stroke: "line", width: ow },
    ],
    armL: armOps(-1, hands.handL, ow, { stance }),
    armR: armOps(1, hands.handR, ow, { stance }),
  };
}

export function ogreParts(input: OgrePartsInput): OgreParts {
  const A = OGRE_ART;
  const stance = input.stance ?? "rest";
  const bust = input.size <= OGRE_BUST_MAX && stance === "rest";
  const ow = ogreOutline(input.size);
  const face = OGRE_FACES[input.expression] ?? OGRE_FACES.neutral;
  const ear = (d: string, inner: string, dx: number, part: "earL" | "earR"): OgreOp[] => [...shaded(d, "skin", "skinShade", dx, -1.4), { d: inner, fill: "earIn" }, ...markOps(input.marks, stance, part), outline(d, ow)];
  return {
    ...bodyOps(stance, ow, input.marks),
    earL: ear(A.earL, A.earInL, 1.5, "earL"),
    earR: ear(A.earR, A.earInR, -1.5, "earR"),
    head: [...shaded(A.head, "skin", "skinShade", -2.6, -3.4), ...markOps(input.marks, stance, "head"), outline(A.head, ow)],
    brows: browOps(face),
    eyeL: eyeOps(face.eyes[0], -1, ow),
    eyeR: eyeOps(face.eyes[1], 1, ow),
    nose: noseOps(ow),
    mouth: mouthOps(input.mouth ?? face.mouth, ow),
    extras: extraOps(face, ow, bust),
  };
}

/** The viewBox for a size: the whole box, or the bust under 48 px. */
export function ogreViewBox(size: number): string {
  return size <= OGRE_BUST_MAX ? `${OGRE_BUST.x} ${OGRE_BUST.y} ${OGRE_BUST.w} ${OGRE_BUST.h}` : "0 0 100 100";
}

/* --------------------------------------------------------------- SVG out */

/** Ops as SVG markup with a palette (tests, the iOS export's checks, the keyframe renders). `uid` keeps clip ids apart. */
export function ogreOpsToSvg(ops: readonly OgreOp[], palette: OgrePalette, uid: string): string {
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

/** The head group's transform for a stance (SVG), empty at rest. */
export function stanceHeadTransform(stance: OgreStance): string {
  const head = STANCE_HEAD[stance];
  const [nx, ny] = OGRE_PIVOTS.neck;
  return head.scale === 1 && !head.x && !head.y ? "" : `translate(${head.x} ${head.y}) translate(${nx} ${ny}) scale(${head.scale}) translate(${-nx} ${-ny})`;
}

/** The whole still drawing as one SVG string, at rest (or in another stance). */
export function ogreStillSvg(options: { color?: string | null; expression?: OgreExpression; size: number; stance?: OgreStance; uid?: string; palette?: OgrePalette; marks?: OgreMarks | null }): string {
  const palette = options.palette ?? ogrePalette(options.color);
  const stance = options.stance ?? "rest";
  const parts = ogreParts({ expression: options.expression ?? "neutral", size: options.size, stance, marks: options.marks });
  const uid = options.uid ?? "ogre";
  const draw = (key: keyof OgreParts) => ogreOpsToSvg(parts[key], palette, `${uid}${key}`);
  const transform = stanceHeadTransform(stance);
  const head = (["earL", "earR", "head", "brows", "eyeL", "eyeR", "nose", "mouth", "extras"] as const).map(draw).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${stance === "rest" ? ogreViewBox(options.size) : "0 0 100 100"}" width="${options.size}" height="${options.size}">` +
    `${draw("log")}${draw("legL")}${draw("legR")}${draw("body")}${draw("belly")}${draw("armL")}${draw("armR")}<g${transform ? ` transform="${transform}"` : ""}>${head}</g></svg>`
  );
}
