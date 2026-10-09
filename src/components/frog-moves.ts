// Frog's moves (FrogMascot.tsx, the desktop mascot): keyframe tracks, pure
// functions of the time since a move started, like the Shiba's (shiba-moves.ts)
// and the Shapes' moves, so the tests, the keyframe renders and the live
// drawing share them. A pose says where the whole frog is (lift, lean, squash
// about the ground, facing), what the head does (nod, tilt), each lid (a blink
// closes one at a time), where the pupils look, the throat sac, the tongue and
// its fly, the hind legs, each hand, the water line and the lily pad, and the
// face and the lips it wears.
//
// A track is a list of keys; between two keys every number eases on the
// curve the later key names. A key sets the whole pose (what it leaves out is
// at rest) unless it is `partial` (it only moves what it names).
//
// FrogRig composes them at any moment: the idle life underneath (a breath
// with the throat, seeded blinks one eye then the other), one held activity
// (hopping along, the leaps, the throat puff while working, sinking while
// waiting, the nap on a lily pad, talking, dangling) blended in and out, and
// one one-shot move on top, each laid over the pose below as a change from
// rest so nothing pops and the idle life goes on under it. Under reduced
// motion the rig never runs: a move only shows its face (`frogReducedFace`).
//
// Units: box units of the 0..100 drawing (frog-art.ts), y down; angles in
// degrees. Nothing shakes faster than 4 Hz.
import { clamp01, easeInOut, lerp } from "./shape-art";
import { blinkOpen, blinkSchedule } from "./shape-engine";
import { FROG_ART, FROG_PIVOTS, type FrogExpression, type FrogMouth, type Point } from "./frog-art";

/* --------------------------------------------------------------- poses */

/** Every number a move can drive. */
export interface FrogNumbers {
  /** The whole frog: shift (+ right), lift (- up), lean, squash about the ground (sx wide, sy tall), facing (1, -1). */
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
  turn: number;
  /** The head about the neck: drop (+ down), tilt. */
  headY: number;
  headRot: number;
  /** Each lid's closing, 0 open..1 shut (left, right). */
  blinkL: number;
  blinkR: number;
  /** Where the pupils look, on top of the face's own gaze. */
  lookX: number;
  lookY: number;
  /** The throat sac, 0 hidden..1 full (a croak goes to 1.3). */
  puff: number;
  /** The tongue's reach toward the fly (0..1); the fly is held by it (1) or free (0); the fly shows (0 gone). */
  tongue: number;
  caught: number;
  fly: number;
  /** The hind legs' stretch, 0 folded..1 out. */
  legs: number;
  /** The water line's height (100 no water, 67 hides the lower third). */
  water: number;
  /** The lily pad, 0 gone..1. */
  pad: number;
  /** Each hand: out to its side (+), lift (- up), and turn about its wrist (+ outward); the arm stretches to follow. */
  handLX: number;
  handLY: number;
  handLRot: number;
  handRX: number;
  handRY: number;
  handRRot: number;
  /** The lips' height (1 rest; talking opens and closes them). */
  mouthOpen: number;
}

export interface FrogPose extends FrogNumbers {
  /** A face of its own over the mood's, and lips over the face's. */
  expression: FrogExpression | null;
  mouth: FrogMouth | null;
}

export const FROG_REST: Readonly<FrogNumbers> = Object.freeze({
  x: 0,
  y: 0,
  rot: 0,
  sx: 1,
  sy: 1,
  turn: 1,
  headY: 0,
  headRot: 0,
  blinkL: 0,
  blinkR: 0,
  lookX: 0,
  lookY: 0,
  puff: 0,
  tongue: 0,
  caught: 0,
  fly: 0,
  legs: 0,
  water: 100,
  pad: 0,
  handLX: 0,
  handLY: 0,
  handLRot: 0,
  handRX: 0,
  handRY: 0,
  handRRot: 0,
  mouthOpen: 1,
});

const NUMBERS = Object.keys(FROG_REST) as (keyof FrogNumbers)[];

export function frogRestPose(): FrogPose {
  return { ...FROG_REST, expression: null, mouth: null };
}

/* -------------------------------------------------------------- tracks */

export type Ease = "linear" | "in" | "out" | "inOut" | "back" | "hold";

const EASES: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  // gravity: a fall speeds up, a rise slows down
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  // a little past, then back: a sac swelling
  back: (t) => {
    const c = 1.70158;
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
  },
  hold: (t) => (t < 1 ? 0 : 1),
};

/** One key: when (0..1 of the move), the values it sets, the curve into it, and the face from it on. */
export interface FrogKey extends Partial<FrogNumbers> {
  at: number;
  ease?: Ease;
  face?: FrogExpression;
  mouth?: FrogMouth | null;
  /** Only the values it names; the others keep their way between the keys around it. */
  partial?: boolean;
}

export interface FrogTrack {
  /** s: the whole of a one-shot, one cycle of a held move. */
  duration: number;
  /** Held (lasts until it changes) or a one-shot. */
  loop: boolean;
  /** Under reduced motion: show the move's face, still, or nothing. */
  reduced: "face" | "none";
  keys: readonly FrogKey[];
  /** A shake over the window [from, to] of the move (0..1): x and lean, at most 4 Hz. */
  shake?: { hz: number; x: number; rot: number; from: number; to: number };
  /** A slow bob while held (afloat, sunk). */
  bob?: { hz: number; y: number; rot: number };
}

/**
 * Every move, in the editor's order: the fourteen moves every character
 * plays, ported to a frog, then the frog's own.
 */
export const FROG_MOVES = [
  "idle",
  "blink",
  "look",
  "nod",
  "shake",
  "bounce",
  "wave",
  "think",
  "celebrate",
  "sleep",
  "alert",
  "talk",
  "listen",
  "work",
  "walk",
  "hop",
  "longJump",
  "puff",
  "tongue",
  "blinkOne",
  "smugNod",
  "sink",
  "lilyNap",
  "legStretch",
  "croak",
  "shiver",
  "sideEye",
  "drag",
] as const;
export type FrogMove = (typeof FROG_MOVES)[number];
export const isFrogMove = (value: unknown): value is FrogMove => typeof value === "string" && (FROG_MOVES as readonly string[]).includes(value);

/** The fourteen moves every character plays. */
export const FROG_GENERIC_MOVES: readonly FrogMove[] = FROG_MOVES.slice(0, 14);

/** The fly's perch, up and to the right of the head. */
export const FLY_AT: Point = [91, 30];

/** A real jump arc: crouch, push with the legs out, rise slowing to the apex, fall speeding up, touch down on reaching feet, squash, overshoot, settle. */
const HOP_KEYS: readonly FrogKey[] = [
  { at: 0 },
  { at: 0.14, ease: "inOut", sy: 0.82, sx: 1.13, headY: 1.6, blinkL: 0.25, blinkR: 0.25 },
  { at: 0.24, ease: "out", y: -7, sy: 1.12, sx: 0.9, legs: 0.45, headY: -0.6, rot: -3 },
  { at: 0.38, ease: "out", y: -24, sy: 1.08, sx: 0.94, legs: 1, rot: -4 },
  { at: 0.5, ease: "out", y: -29, legs: 0.55, rot: -1 },
  { at: 0.62, ease: "in", y: -23, sy: 1.03, sx: 0.98, legs: 0.35, rot: 2 },
  { at: 0.74, ease: "in", y: -1, sy: 1.06, sx: 0.96, legs: 0.15, rot: 2 },
  { at: 0.8, ease: "out", sy: 0.8, sx: 1.16, headY: 2, blinkL: 0.35, blinkR: 0.35 },
  { at: 0.9, ease: "inOut", sy: 1.04, sx: 0.98, headY: -0.4 },
  { at: 1, ease: "inOut" },
];

/** The throat swelling and easing off twice, the chin lifting as it fills. */
const PUFF_KEYS: readonly FrogKey[] = [
  { at: 0, face: "curious" },
  { at: 0.28, ease: "inOut", puff: 1, headY: -1.2, sy: 1.015, headRot: 3 },
  { at: 0.4, ease: "inOut", puff: 0.86, headY: -0.9, headRot: 3 },
  { at: 0.52, ease: "inOut", puff: 1, headY: -1.2, sy: 1.015, headRot: 3 },
  { at: 0.82, ease: "inOut", puff: 0.12 },
  { at: 1, ease: "inOut" },
];

export const FROG_TRACKS: Readonly<Record<FrogMove, FrogTrack>> = {
  /* ---- the fourteen every character plays ---- */
  // the throat fluttering with the breath
  idle: { duration: 3.4, loop: true, reduced: "none", keys: [{ at: 0 }, { at: 0.5, puff: 0.22 }, { at: 1 }] },
  blink: { duration: 0.22, loop: false, reduced: "none", keys: [{ at: 0 }, { at: 0.45, blinkL: 1, blinkR: 1 }, { at: 1 }] },
  look: {
    duration: 1.8,
    loop: false,
    reduced: "none",
    keys: [{ at: 0 }, { at: 0.22, lookX: 3.2, headRot: 3 }, { at: 0.42, lookX: 3.2, headRot: 3 }, { at: 0.62, lookX: -3.2, headRot: -3 }, { at: 0.82, lookX: -3.2, headRot: -3 }, { at: 1 }],
  },
  nod: { duration: 1, loop: false, reduced: "none", keys: [{ at: 0 }, { at: 0.25, headY: 2.8, blinkL: 0.2, blinkR: 0.2 }, { at: 0.5 }, { at: 0.75, headY: 2.8, blinkL: 0.2, blinkR: 0.2 }, { at: 1 }] },
  shake: {
    duration: 1,
    loop: false,
    reduced: "none",
    keys: [{ at: 0, face: "bored" }, { at: 0.16, headRot: 6, x: 0.6 }, { at: 0.33, headRot: -6, x: -0.6 }, { at: 0.5, headRot: 4.5, x: 0.4 }, { at: 0.67, headRot: -3, x: -0.2 }, { at: 0.84, headRot: 1.5 }, { at: 1 }],
  },
  // a small hop in place
  bounce: {
    duration: 0.8,
    loop: false,
    reduced: "none",
    keys: [
      { at: 0 },
      { at: 0.14, ease: "inOut", sy: 0.88, sx: 1.08, headY: 1 },
      { at: 0.3, ease: "out", y: -8, sy: 1.06, sx: 0.95, legs: 0.4 },
      { at: 0.46, ease: "out", y: -10, legs: 0.3 },
      { at: 0.66, ease: "in", y: 0, sy: 1.03, legs: 0.1 },
      { at: 0.78, ease: "out", sy: 0.9, sx: 1.07, headY: 1 },
      { at: 1, ease: "inOut" },
    ],
  },
  // the right hand up, waving at the wrist
  wave: {
    duration: 1.6,
    loop: false,
    reduced: "face",
    keys: [
      { at: 0, face: "happy" },
      { at: 0.18, ease: "out", handRX: 22, handRY: -36, handRRot: 24, headRot: -3 },
      { at: 0.32, handRX: 22, handRY: -36, handRRot: -10, headRot: -3 },
      { at: 0.46, handRX: 22, handRY: -36, handRRot: 24, headRot: -3 },
      { at: 0.6, handRX: 22, handRY: -36, handRRot: -10, headRot: -3 },
      { at: 0.76, handRX: 22, handRY: -36, handRRot: 18, headRot: -3 },
      { at: 1, ease: "inOut" },
    ],
  },
  think: { duration: 2.4, loop: false, reduced: "face", keys: PUFF_KEYS.map((key) => (key.at > 0 && key.at < 1 ? { ...key, lookX: -1.4, lookY: -1.2 } : key)) },
  // two hops, the hands up, the grin
  celebrate: {
    duration: 2,
    loop: false,
    reduced: "face",
    keys: [
      { at: 0, face: "excited" },
      { at: 0.08, ease: "inOut", sy: 0.86, sx: 1.08 },
      { at: 0.24, ease: "out", y: -14, sy: 1.08, sx: 0.94, legs: 0.7, handLX: 20, handRX: 20, handLY: -36, handRY: -36, handLRot: 20, handRRot: 20 },
      { at: 0.4, ease: "in", y: 0, sy: 1.02, legs: 0.1, handLX: 16, handRX: 16, handLY: -28, handRY: -28, handLRot: 10, handRRot: 10 },
      { at: 0.46, ease: "out", sy: 0.86, sx: 1.08, handLX: 12, handRX: 12, handLY: -20, handRY: -20 },
      { at: 0.64, ease: "out", y: -14, sy: 1.08, sx: 0.94, legs: 0.7, handLX: 20, handRX: 20, handLY: -36, handRY: -36, handLRot: 20, handRRot: 20, face: "laughing" },
      { at: 0.8, ease: "in", y: 0, sy: 1.02, legs: 0.1, handLX: 12, handRX: 12, handLY: -22, handRY: -22 },
      { at: 0.86, ease: "out", sy: 0.88, sx: 1.07 },
      { at: 1, ease: "inOut", face: "happy" },
    ],
  },
  // asleep sitting: a slow breath, the sac swelling with each snore
  sleep: {
    duration: 4,
    loop: true,
    reduced: "face",
    keys: [
      { at: 0, face: "sleepy", headY: 1.4 },
      { at: 0.5, ease: "inOut", sy: 0.985, puff: 0.32, headY: 1.8 },
      { at: 1, ease: "inOut", headY: 1.4 },
    ],
  },
  alert: {
    duration: 0.9,
    loop: false,
    reduced: "face",
    keys: [{ at: 0, face: "surprised" }, { at: 0.2, ease: "out", y: -3.5, sy: 1.05, sx: 0.97, headY: -1 }, { at: 0.45, ease: "in", sy: 0.97, sx: 1.02 }, { at: 1, ease: "inOut" }],
  },
  // the lips opening and closing, the throat helping
  talk: {
    duration: 0.42,
    loop: true,
    reduced: "face",
    keys: [{ at: 0, mouth: "open", mouthOpen: 0.75 }, { at: 0.5, mouthOpen: 1.15, puff: 0.12, headY: -0.3 }, { at: 1, mouthOpen: 0.75 }],
  },
  listen: {
    duration: 2.4,
    loop: true,
    reduced: "face",
    keys: [
      { at: 0, face: "attentive", headRot: 5, lookX: 1.4 },
      { at: 0.5, headRot: 6.5, lookX: 1.4, headY: -0.4 },
      { at: 1, headRot: 5, lookX: 1.4 },
    ],
  },
  work: {
    duration: 0.9,
    loop: true,
    reduced: "face",
    keys: [{ at: 0, face: "attentive" }, { at: 0.5, headY: 1, puff: 0.18, lookY: 0.8 }, { at: 1 }],
  },

  /* ---- the frog's own ---- */
  // hopping along the desk: one short hop a cycle while the window walks
  walk: {
    duration: 0.7,
    loop: true,
    reduced: "none",
    keys: [
      { at: 0, sy: 0.9, sx: 1.06 },
      { at: 0.16, ease: "out", y: -4, sy: 1.08, sx: 0.94, legs: 0.5, rot: -3 },
      { at: 0.45, ease: "out", y: -11, legs: 0.6, rot: -2 },
      { at: 0.78, ease: "in", y: 0, sy: 1.03, legs: 0.15, rot: 1 },
      { at: 1, ease: "out", sy: 0.9, sx: 1.06 },
    ],
  },
  hop: { duration: 0.95, loop: false, reduced: "none", keys: HOP_KEYS },
  // the long jump: a deeper crouch, a flatter, longer flight with the legs trailing (the window
  // travels meanwhile), the proud landing
  longJump: {
    duration: 1.4,
    loop: false,
    reduced: "face",
    keys: [
      { at: 0 },
      { at: 0.12, ease: "inOut", sy: 0.76, sx: 1.18, headY: 2, rot: 4, face: "attentive" },
      { at: 0.2, ease: "out", y: -9, sy: 1.16, sx: 0.88, legs: 0.55, rot: -10, headY: -1 },
      { at: 0.36, ease: "out", y: -30, sy: 1.12, sx: 0.92, legs: 1.1, rot: -12 },
      { at: 0.5, ease: "out", y: -36, sy: 1.06, sx: 0.96, legs: 1, rot: -4, face: "excited" },
      { at: 0.64, ease: "in", y: -29, sy: 1.04, sx: 0.98, legs: 0.6, rot: 6 },
      { at: 0.78, ease: "in", y: -1, sy: 1.08, sx: 0.94, legs: 0.2, rot: 6 },
      { at: 0.84, ease: "out", sy: 0.76, sx: 1.2, headY: 2.4, face: "proud" },
      { at: 0.93, ease: "inOut", sy: 1.05, sx: 0.97, headY: -0.4 },
      { at: 1, ease: "inOut" },
    ],
  },
  // thinking: the throat sac swells and eases off, over and over
  puff: { duration: 2.6, loop: true, reduced: "face", keys: PUFF_KEYS },
  // a new message: a glance at the fly, the lips part, the tongue shoots out, catches it, reels it in;
  // the gulp pulls both eyes shut (frogs swallow with them), then the smug look
  tongue: {
    duration: 1.3,
    loop: false,
    reduced: "face",
    keys: [
      { at: 0, fly: 1, face: "attentive" },
      { at: 0.16, ease: "inOut", lookX: 3, lookY: -2.4, headRot: 4, fly: 1 },
      { at: 0.24, ease: "out", mouth: "open", fly: 1, sy: 0.97, lookX: 3, lookY: -2.4, headRot: 5 },
      { at: 0.34, ease: "out", tongue: 1, fly: 1, sy: 1.03, lookX: 3, lookY: -2.4, headRot: 6 },
      { at: 0.36, ease: "hold", caught: 1, partial: true },
      { at: 0.52, ease: "in", caught: 1, fly: 1 },
      { at: 0.54, ease: "hold", fly: 0, caught: 0, mouth: null, partial: true },
      { at: 0.66, ease: "inOut", puff: 0.45, blinkL: 1, blinkR: 1, headY: 1.2 },
      { at: 0.8, ease: "inOut", face: "proud" },
      { at: 1, ease: "inOut" },
    ],
  },
  // one lid, then the other: the frog's lazy blink
  blinkOne: {
    duration: 1.1,
    loop: false,
    reduced: "none",
    keys: [{ at: 0 }, { at: 0.14, blinkL: 1 }, { at: 0.3 }, { at: 0.46, blinkR: 1 }, { at: 0.62 }, { at: 1 }],
  },
  // a task went well: a slow, satisfied nod, the lids lowering, the smirk
  smugNod: {
    duration: 1.8,
    loop: false,
    reduced: "face",
    keys: [
      { at: 0, face: "proud" },
      { at: 0.32, ease: "inOut", headY: 3.6, headRot: -3, blinkL: 0.3, blinkR: 0.3, sy: 0.98 },
      { at: 0.55, ease: "inOut", headY: 3.2, headRot: -2, blinkL: 0.3, blinkR: 0.3 },
      { at: 0.82, ease: "inOut", headY: -0.6, headRot: 1, sy: 1.01 },
      { at: 1, ease: "inOut" },
    ],
  },
  // waiting: sunk in the pond up to the lower third, the eyes above the water, bobbing
  sink: {
    duration: 3.2,
    loop: true,
    reduced: "face",
    bob: { hz: 0.45, y: 0.7, rot: 0.8 },
    keys: [
      { at: 0, water: 67, y: 4, face: "bored" },
      { at: 0.5, ease: "inOut", water: 67, y: 4.6, blinkL: 0.2, blinkR: 0.2 },
      { at: 1, ease: "inOut", water: 67, y: 4 },
    ],
  },
  // a nap afloat: the pad under it, a slow rock, eyes shut, snoring with the throat
  lilyNap: {
    duration: 4,
    loop: true,
    reduced: "face",
    bob: { hz: 0.3, y: 0.9, rot: 1.6 },
    keys: [
      { at: 0, pad: 1, y: -3, face: "sleepy" },
      { at: 0.5, ease: "inOut", pad: 1, y: -3, sy: 0.985, puff: 0.3 },
      { at: 1, ease: "inOut", pad: 1, y: -3 },
    ],
  },
  // after a nap: up tall, both hind legs pushed out and shaken loose, a yawn, back down
  legStretch: {
    duration: 1.9,
    loop: false,
    reduced: "face",
    keys: [
      { at: 0, face: "sleepy" },
      { at: 0.18, ease: "inOut", sy: 1.12, sx: 0.94, y: -5, legs: 0.6, mouth: "croak", headY: -1.2, handLY: -3, handRY: -3 },
      { at: 0.4, ease: "out", sy: 1.16, sx: 0.92, y: -8, legs: 1.1, headRot: -3, handLY: -4, handRY: -4 },
      { at: 0.52, ease: "inOut", sy: 1.14, sx: 0.93, y: -7, legs: 0.85, headRot: 2 },
      { at: 0.64, ease: "inOut", sy: 1.12, sx: 0.94, y: -6, legs: 1.1, headRot: -1, mouth: null, face: "bored" },
      { at: 0.82, ease: "in", sy: 0.92, sx: 1.06, headY: 1 },
      { at: 1, ease: "inOut", face: "neutral" },
    ],
  },
  // a nudge: the sac swells past full and the body shakes with the croak, twice
  croak: {
    duration: 1.5,
    loop: false,
    reduced: "face",
    shake: { hz: 4, x: 0.9, rot: 1.6, from: 0.14, to: 0.86 },
    keys: [
      { at: 0, face: "angry" },
      { at: 0.14, ease: "back", puff: 1.3, sy: 1.05, sx: 0.98, headY: -1.6, face: "suspicious" },
      { at: 0.4, ease: "inOut", puff: 0.5, headY: -0.4 },
      { at: 0.56, ease: "back", puff: 1.3, sy: 1.05, headY: -1.6 },
      { at: 0.86, ease: "inOut", face: "neutral" },
      { at: 1 },
    ],
  },
  // a refusal: drawn in, a cold shiver, a sweat drop
  shiver: {
    duration: 1.4,
    loop: false,
    reduced: "face",
    shake: { hz: 4, x: 1.2, rot: 1.2, from: 0.08, to: 0.8 },
    keys: [
      { at: 0, face: "scared" },
      { at: 0.12, ease: "out", sy: 0.93, sx: 1.04, headY: 2.2, handLY: -2, handRY: -2 },
      { at: 0.8, ease: "inOut", sy: 0.95, sx: 1.03, headY: 1.6, handLY: -2, handRY: -2 },
      { at: 1, ease: "inOut", face: "sad" },
    ],
  },
  // an approval request: the slow side-eye toward the chat, held, and back
  sideEye: {
    duration: 2.4,
    loop: false,
    reduced: "face",
    keys: [
      { at: 0, face: "suspicious" },
      { at: 0.18, ease: "inOut", headRot: 5, lookX: 0.8 },
      { at: 0.78, ease: "inOut", headRot: 5, lookX: 0.8 },
      { at: 0.94, ease: "inOut", face: "attentive" },
      { at: 1 },
    ],
  },
  // picked up: the hind legs dangle, the frog sways, eyes wide
  drag: {
    duration: 1.2,
    loop: true,
    reduced: "face",
    keys: [
      { at: 0, face: "surprised", legs: 0.95, sy: 1.08, sx: 0.95, rot: -4, handLY: -2, handRY: -2 },
      { at: 0.5, ease: "inOut", legs: 1.05, sy: 1.08, sx: 0.95, rot: 4, handLY: -2, handRY: -2 },
      { at: 1, ease: "inOut", legs: 0.95, sy: 1.08, sx: 0.95, rot: -4, handLY: -2, handRY: -2 },
    ],
  },
};

/** A track's pose at `u` s (a cycling move wraps; a one-shot holds its ends). */
export function trackAt(track: FrogTrack, u: number, cycle = track.loop): FrogPose {
  const d = track.duration;
  const time = cycle ? ((u % d) + d) % d : Math.min(Math.max(0, u), d);
  const t = time / d;
  const pose = frogRestPose();
  for (const name of NUMBERS) {
    let prev = { at: 0, v: FROG_REST[name] };
    let next: { at: number; v: number; ease: Ease } | null = null;
    for (const key of track.keys) {
      const value = key[name];
      if (value === undefined && key.partial) continue;
      const v = value ?? FROG_REST[name];
      if (key.at <= t) prev = { at: key.at, v };
      else {
        next = { at: key.at, v, ease: key.ease ?? "inOut" };
        break;
      }
    }
    pose[name] = !next || next.at <= prev.at ? prev.v : prev.v + (next.v - prev.v) * EASES[next.ease]((t - prev.at) / (next.at - prev.at));
  }
  for (const key of track.keys) {
    if (key.at > t) break;
    if (key.face) pose.expression = key.face;
    if (key.mouth !== undefined) pose.mouth = key.mouth;
  }
  if (track.shake && t >= track.shake.from && t <= track.shake.to) {
    const env = Math.sin(((t - track.shake.from) / (track.shake.to - track.shake.from)) * Math.PI);
    const w = time * Math.PI * 2 * Math.min(4, track.shake.hz);
    pose.x += Math.sin(w) * track.shake.x * env;
    pose.rot += Math.sin(w + 1.2) * track.shake.rot * env;
  }
  if (track.bob) {
    pose.y += Math.sin(u * Math.PI * 2 * track.bob.hz) * track.bob.y;
    pose.rot += Math.sin(u * Math.PI * 2 * track.bob.hz * 0.7 + 0.8) * track.bob.rot;
  }
  return pose;
}

/** A move's pose `u` s in (`cycle` wraps it, as a held move does). */
export function frogMoveAt(move: FrogMove, u: number, cycle?: boolean): FrogPose {
  return trackAt(FROG_TRACKS[move], u, cycle);
}

/** A move's face, still: what reduced motion shows while it plays (null shows nothing). */
export function frogReducedFace(move: FrogMove): Pick<FrogPose, "expression" | "mouth" | "water" | "pad"> | null {
  const track = FROG_TRACKS[move];
  if (track.reduced === "none") return null;
  const pose = trackAt(track, track.loop ? 0 : track.duration / 2);
  // the pond and the pad stay (they say where the frog is), the motion goes
  return { expression: pose.expression, mouth: pose.mouth, water: pose.water, pad: pose.pad };
}

/* ------------------------------------------------------------- blending */

const SCALED = new Set<keyof FrogNumbers>(["sx", "sy", "mouthOpen"]);
const CLOSING = new Set<keyof FrogNumbers>(["blinkL", "blinkR"]);

/**
 * A move's pose laid over another at weight `w` (0..1), as a change from
 * rest, so the pose below goes on under it (the breath, the blinks): offsets
 * add, squashes multiply, a lid closes as far as either asks, the water rises
 * as high as either asks. The face and the lips switch at half way.
 */
export function layerPose(base: FrogPose, top: FrogPose, w: number): FrogPose {
  if (w <= 0) return base;
  const out: FrogPose = { ...base };
  for (const name of NUMBERS) {
    const rest = FROG_REST[name];
    const v = top[name];
    if (v === rest) continue;
    if (SCALED.has(name)) out[name] = base[name] * (1 + (v - 1) * w);
    else if (CLOSING.has(name)) out[name] = Math.max(base[name], v * w);
    else if (name === "water") out.water = Math.min(base.water, lerp(100, v, w));
    else if (name === "turn") out.turn = lerp(base.turn, v, w);
    else out[name] = base[name] + (v - rest) * w;
  }
  if (w >= 0.5) {
    if (top.expression) out.expression = top.expression;
    if (top.mouth) out.mouth = top.mouth;
  }
  return out;
}

/** How far a one-shot shows `u` s in: in over 0.12 s, out over 0.18 s after its end. */
export function frogMoveWeight(move: FrogMove, u: number): number {
  const { duration } = FROG_TRACKS[move];
  if (u < 0 || u > duration + 0.18) return 0;
  return Math.min(easeInOut(clamp01(u / 0.12)), u > duration ? 1 - easeInOut(clamp01((u - duration) / 0.18)) : 1);
}

/** The breath's period, s, and the idle blink's lag of the right eye behind the left, s. */
export const FROG_BREATH_S = 3.4;
export const FROG_BLINK_LAG = 0.12;

/** The idle life under everything at `t` s: a breath with the throat, the seeded blinks, the right eye a beat after the left. */
export function frogIdlePose(t: number, blinks: readonly number[]): FrogPose {
  const pose = frogRestPose();
  const breath = Math.sin((Math.PI * 2 * t) / FROG_BREATH_S);
  pose.sx = 1 + 0.008 * breath;
  pose.sy = 1 - 0.008 * breath;
  pose.puff = 0.14 * (0.5 + 0.5 * breath);
  pose.headY = 0.3 * Math.sin((Math.PI * 2 * t) / FROG_BREATH_S - 0.5);
  pose.blinkL = 1 - blinkOpen(t, blinks);
  pose.blinkR = 1 - blinkOpen(t - FROG_BLINK_LAG, blinks);
  return pose;
}

/**
 * One live Frog: the idle life, a held activity and a one-shot move, all on
 * one clock (seconds). `pose(now)` is the frame to draw.
 */
export class FrogRig {
  private readonly start: number;
  private readonly seed: number;
  private blinks: number[] = [];
  private blinkHorizon = 0;
  private held: { move: FrogMove; since: number } | null = null;
  private letGo: { move: FrogMove; since: number; at: number } | null = null;
  private shot: { move: FrogMove; at: number } | null = null;

  constructor(now: number, seed = Math.random() * 1000) {
    this.start = now;
    this.seed = seed;
  }

  /** The activity held until it changes (hopping along, sunk, asleep on the pad...), or none. */
  hold(move: FrogMove | null, now: number): void {
    if ((this.held?.move ?? null) === move) return;
    this.letGo = this.held ? { ...this.held, at: now } : null;
    this.held = move ? { move, since: now } : null;
  }

  /** A one-shot move, from its start. */
  play(move: FrogMove, now: number): void {
    this.shot = { move, at: now };
  }

  /** Whether a one-shot is still showing at `now`. */
  playing(now: number): boolean {
    return this.shot !== null && now - this.shot.at <= FROG_TRACKS[this.shot.move].duration + 0.18;
  }

  /** Whether anything but the idle life is under way. */
  busy(now: number): boolean {
    return this.held !== null || this.playing(now) || (this.letGo !== null && now - this.letGo.at < 0.3);
  }

  /** Seconds into the move showing on top (the fly's loop), or the clock. */
  moveTime(now: number): number {
    if (this.shot) return now - this.shot.at;
    if (this.held) return now - this.held.since;
    return now - this.start;
  }

  pose(now: number): FrogPose {
    const t = now - this.start;
    if (t + 6 > this.blinkHorizon) {
      this.blinkHorizon = t + 30;
      this.blinks = blinkSchedule(this.seed, this.blinkHorizon);
    }
    let pose = frogIdlePose(t, this.blinks);
    if (this.letGo) {
      const out = 1 - easeInOut(clamp01((now - this.letGo.at) / 0.3));
      if (out <= 0) this.letGo = null;
      else pose = layerPose(pose, frogMoveAt(this.letGo.move, now - this.letGo.since, true), out);
    }
    // a held move cycles, one-shots included (a flight is a run of long jumps)
    if (this.held) pose = layerPose(pose, frogMoveAt(this.held.move, now - this.held.since, true), easeInOut(clamp01((now - this.held.since) / 0.3)));
    if (this.shot) {
      const u = now - this.shot.at;
      const w = frogMoveWeight(this.shot.move, u);
      if (w <= 0 && u > 0) this.shot = null;
      else pose = layerPose(pose, frogMoveAt(this.shot.move, u, false), w);
    }
    return pose;
  }
}

/* ------------------------------------------------------- SVG transforms */

const f = (v: number) => String(Math.round(v * 100) / 100);

/** The groups the rig moves, by name. */
export const FROG_GROUPS = ["whole", "head", "pupilL", "pupilR", "lidL", "lidR", "lowL", "lowR", "mouth", "throat", "handL", "handR", "pad", "fly", "tongue"] as const;
export type FrogGroup = (typeof FROG_GROUPS)[number];
export type FrogTransforms = Record<FrogGroup, string>;

/** Where the fly is `u` s into a move: a lazy loop around its perch while free, on the tongue's tip once caught. */
export function flyAt(pose: Pick<FrogNumbers, "tongue" | "caught">, u: number, tip: Point = FLY_AT): Point {
  const [mx, my] = FROG_ART.mouth;
  if (pose.caught > 0.5) return [mx + (tip[0] - mx) * pose.tongue, my + (tip[1] - my) * pose.tongue];
  return [tip[0] + Math.sin(u * 5.2) * 2.4, tip[1] + Math.cos(u * 4.1) * 1.8];
}

/** An eye's blink lid: its height, and how far the face's own lid already closes the eye. */
export interface FrogLid {
  height: number;
  rest: number;
}

/**
 * The blink lid's slide for a closing (0 open..1 shut), box units: out of
 * sight above the eye until the closing passes the face's own lid, then down
 * over the eye from there.
 */
export function lidSlide(closing: number, lid: FrogLid): { upper: number; lower: number } {
  const hidden = { upper: -lid.height - 4, lower: lid.height + 4 };
  const c = clamp01(closing);
  if (c <= lid.rest + 0.02 || lid.height <= 0) return hidden;
  // the two lids meet a little under the middle (or at the face's own lid, if lower): a closed eye's line
  const meet = Math.max(FROG_LID_MEET, lid.rest);
  const k = (c - lid.rest) / (1 - lid.rest);
  const upper = lid.rest + (meet - lid.rest) * k;
  return { upper: -lid.height * (meet - upper), lower: lid.height * (1 - meet) * (1 - k) };
}

/** An eye's blink lid height at its usual size (frogEyeLayers). */
export const FROG_LID_HEIGHT = 2 * FROG_ART.eye.r + 2;
/** Where a blink's two lids meet, from the eye's top (0..1). */
export const FROG_LID_MEET = 0.6;
const OPEN_LID: FrogLid = { height: FROG_LID_HEIGHT, rest: 0 };

/** The throat sac's top: it grows from under the lips. */
export const THROAT_TOP: Point = [FROG_ART.throat.x, FROG_ART.throat.y - FROG_ART.throat.ry];

/** Every moving group's transform for a pose. `lids` are the eyes' heights (frogEyeLayers), `u` the move's time (the fly). */
export function frogTransforms(pose: FrogPose, options: { lids?: readonly [FrogLid, FrogLid]; u?: number } = {}): FrogTransforms {
  const P = FROG_PIVOTS;
  const [gx, gy] = P.ground;
  const [nx, ny] = P.neck;
  const turn = Math.sign(pose.turn || 1) * Math.max(0.06, Math.abs(pose.turn));
  const [mx, my] = FROG_ART.mouth;
  const [tx, ty] = THROAT_TOP;
  const hand = (pivot: Point, x: number, y: number, rot: number) => `translate(${f(x)} ${f(y)}) rotate(${f(rot)} ${pivot[0]} ${pivot[1]})`;
  const fly = flyAt(pose, options.u ?? 0);
  const look = `translate(${f(pose.lookX)} ${f(pose.lookY)})`;
  const [lidL, lidR] = options.lids ?? [OPEN_LID, OPEN_LID];
  const slideL = lidSlide(pose.blinkL, lidL);
  const slideR = lidSlide(pose.blinkR, lidR);
  return {
    whole: `translate(${f(pose.x)} ${f(pose.y)}) translate(${gx} ${gy}) rotate(${f(pose.rot)}) scale(${f(turn * pose.sx)} ${f(pose.sy)}) translate(${-gx} ${-gy})`,
    head: `translate(0 ${f(pose.headY)}) rotate(${f(pose.headRot)} ${nx} ${ny})`,
    pupilL: look,
    pupilR: look,
    lidL: `translate(0 ${f(slideL.upper)})`,
    lidR: `translate(0 ${f(slideR.upper)})`,
    lowL: `translate(0 ${f(slideL.lower)})`,
    lowR: `translate(0 ${f(slideR.lower)})`,
    mouth: `translate(${mx} ${my}) scale(1 ${f(pose.mouthOpen)}) translate(${-mx} ${-my})`,
    throat: `translate(${tx} ${ty}) scale(${f(Math.max(0, pose.puff))}) translate(${-tx} ${-ty})`,
    // the left hand turns outward to the left, the right one to the right
    handL: hand(P.handL, -pose.handLX, pose.handLY, -pose.handLRot),
    handR: hand(P.handR, pose.handRX, pose.handRY, pose.handRRot),
    pad: `translate(${f(pose.x)} ${f(pose.y * 0.6)}) translate(${gx} ${gy}) scale(${f(clamp01(pose.pad))}) translate(${-gx} ${-gy})`,
    fly: `translate(${f(fly[0])} ${f(fly[1])}) scale(${f(clamp01(pose.fly))}) translate(${-FLY_AT[0]} ${-FLY_AT[1]})`,
    // the tongue is drawn reaching all the way to the perch; it grows from the mouth along its line
    tongue: `translate(${mx} ${my}) scale(${f(Math.max(0.001, clamp01(pose.tongue)))}) translate(${-mx} ${-my})`,
  };
}

/* ------------------------------------------------- the desktop mapping */

/** The moves a desktop clip (floating-bots/clips.ts) plays on Frog; a clip it has no move for keeps the idle life. */
export const FROG_CLIP_MOVES: Readonly<Record<string, FrogMove>> = {
  look: "look",
  lookBack: "look",
  headSpin: "shake",
  tilt: "sideEye",
  spin: "hop",
  backflip: "longJump",
  hop: "hop",
  hopForward: "hop",
  wave: "wave",
  dance: "celebrate",
  jump: "longJump",
  stretch: "legStretch",
  wingStretch: "legStretch",
  preen: "blinkOne",
  scratch: "blinkOne",
  peck: "tongue",
  bob: "nod",
  ruffle: "shake",
  shy: "sideEye",
  confused: "sideEye",
  think: "think",
  hoot: "croak",
  doubleBlink: "blinkOne",
  wink: "blinkOne",
  surprised: "alert",
  startled: "alert",
  angry: "croak",
  love: "celebrate",
  yawn: "sleep",
  wake: "legStretch",
  land: "bounce",
  petted: "smugNod",
  celebrate: "smugNod",
  sad: "shiver",
  // the frog's own clips
  croak: "croak",
  tongue: "tongue",
  smugNod: "smugNod",
  legStretch: "legStretch",
  shiver: "shiver",
  sideEye: "sideEye",
  blinkOne: "blinkOne",
  longJump: "longJump",
};

/** The move a clip or a move id plays, or null. */
export function frogMoveFor(clip: string | null | undefined): FrogMove | null {
  if (!clip) return null;
  if (Object.hasOwn(FROG_CLIP_MOVES, clip)) return FROG_CLIP_MOVES[clip];
  return isFrogMove(clip) ? clip : null;
}

/** What the desktop tells the frog: the clip playing, the brain's pose and the bot's task. */
export interface FrogDesktopState {
  activity: string;
  pose: "idle" | "think" | "speak" | "celebrate" | "alert" | "sleep";
  task?: "idle" | "working" | "waiting" | "error";
}

const waitingIn = (state: FrogDesktopState | null) => !!state && (state.task === "waiting" || (state.task === undefined && state.pose === "alert"));
const asleepIn = (state: FrogDesktopState | null) => !!state && (state.activity === "sleep" || state.pose === "sleep");

/**
 * What Frog keeps doing for the desktop's state: dangling while dragged,
 * hopping along while the window walks, a run of long jumps while it flies,
 * asleep on a lily pad, sunk in the pond while its bot waits for an
 * approval, puffing its throat while it works, talking while the reply
 * streams, else its idle life.
 */
export function frogHeldFor(state: FrogDesktopState): FrogMove | null {
  const { activity, pose } = state;
  if (activity === "drag") return "drag";
  if (activity === "walk") return "walk";
  if (activity === "fly" || activity === "flyOut" || activity === "return") return "longJump";
  if (asleepIn(state)) return "lilyNap";
  if (waitingIn(state)) return "sink";
  if (activity === "working" || pose === "think") return "puff";
  if (pose === "speak") return "talk";
  return null;
}

/**
 * The one-shot a change of the desktop's state plays on top: the side-eye
 * when an approval request arrives (then it sinks), the shiver when a request
 * is refused or fails, the smug nod when a task goes well, the leg stretch
 * after a nap.
 */
export function frogCueFor(prev: FrogDesktopState | null, next: FrogDesktopState): FrogMove | null {
  if (waitingIn(next) && !waitingIn(prev)) return "sideEye";
  if (next.task === "error" && prev?.task !== "error") return "shiver";
  if (next.pose === "celebrate" && prev?.pose !== "celebrate") return "smugNod";
  if (asleepIn(prev) && !asleepIn(next)) return "legStretch";
  return null;
}
