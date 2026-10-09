// Grump's moves (GrumpMascot.tsx, the desktop mascot): pure functions of the
// time since a move started, like the Shiba's (shiba-moves.ts) and the
// Shapes' (shape-moves.ts), so the tests, the keyframe renders and the live
// drawing share them. A move gives a partial pose of the rig (the whole
// body, the torso over the legs, the head, each ear, the tail joint by
// joint, each standing leg by its paw, each sitting front paw, the eyelids,
// the brows, the mouth) and may name the stance (sit, stand, lie, curl),
// the face and the mouth it wears.
//
// GrumpRig composes them at any moment: the idle life underneath (a breath,
// a cat's slow blinks, a lazy tail tip), one held activity (walking,
// stalking, loafing, sleeping curled, talking, listening, working,
// dangling) blended in and out, and one one-shot move on top (a stretch, a
// groom, a pounce, a hiss...), each blended so nothing pops; a change of
// stance lands with a small squash. Under reduced motion the rig never
// runs: a move only shows its face (`grumpReducedFace`).
//
// Units: box units of the 0..100 drawing (grump-art.ts), y down; angles in
// degrees. An ear's angle is outward (+ flattens it to the side, - perks it
// forward); a standing leg's `x` puts its paw ahead of the hip (+ the way it
// faces) and `lift` raises it; a sitting paw moves by `x`, `y` (- up).
import { clamp01, easeInOut, lerp } from "./shape-art";
import { blinkOpen, blinkSchedule } from "./shape-engine";
import {
  GRUMP_HIPS,
  GRUMP_LEGS,
  GRUMP_ORDER,
  GRUMP_PIVOTS,
  GRUMP_STANCE_HEAD,
  GRUMP_TAIL,
  TAIL_JOINTS,
  grumpLegOps,
  grumpOpsToSvg,
  grumpOutline,
  grumpPawOps,
  grumpParts,
  grumpViewBox,
  type GrumpExpression,
  type GrumpLeg,
  type GrumpMouth,
  type GrumpPalette,
  type GrumpStance,
  type Point,
} from "./grump-art";

export interface GrumpLegPose {
  /** The paw ahead of the hip (+ forward), box units. */
  x: number;
  /** The paw above the ground, box units. */
  lift: number;
}

export interface GrumpPaw {
  x: number;
  y: number;
}

export interface GrumpPose {
  /** The whole drawing: offset, lean (about the ground), squash and stretch, and its facing (1, -1, in between mid-turn). */
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
  turn: number;
  /** The torso over the standing legs: a crouch (+ down) and a pitch (+ nose down) about `pivot` (box x of the hips it turns on). */
  bodyY: number;
  bodyRot: number;
  pivot: number;
  headX: number;
  headY: number;
  headRot: number;
  earL: number;
  earR: number;
  /** Each tail joint's bend, root first (degrees, + clockwise). */
  tail: number[];
  legs: Record<GrumpLeg, GrumpLegPose>;
  pawL: GrumpPaw;
  pawR: GrumpPaw;
  /** Eyelids: 0 open, 1 shut (the lids come down over the eye, a cat's slow blink). */
  blink: number;
  /** The brow capsules' rise (- up). */
  brow: number;
  /** The mouth's height (1 rest; talking opens and closes it). */
  mouthOpen: number;
  stance: GrumpStance;
  /** A face of its own over the mood's, and a mouth over the face's. */
  expression: GrumpExpression | null;
  mouth: GrumpMouth | null;
}

/** What a move sets: any part of the pose. */
export type GrumpPosePart = Partial<Omit<GrumpPose, "legs" | "pawL" | "pawR" | "tail">> & {
  legs?: Partial<Record<GrumpLeg, GrumpLegPose>>;
  pawL?: GrumpPaw;
  pawR?: GrumpPaw;
  tail?: readonly number[];
};

const BACK = GRUMP_HIPS.backNear[0];
const FRONT = GRUMP_HIPS.frontNear[0];
const still = (): Record<GrumpLeg, GrumpLegPose> => Object.fromEntries(GRUMP_LEGS.map((leg) => [leg, { x: 0, lift: 0 }])) as Record<GrumpLeg, GrumpLegPose>;
const flat = () => Array.from({ length: TAIL_JOINTS }, () => 0);

export function grumpRestPose(): GrumpPose {
  return {
    x: 0,
    y: 0,
    rot: 0,
    sx: 1,
    sy: 1,
    turn: 1,
    bodyY: 0,
    bodyRot: 0,
    pivot: BACK,
    headX: 0,
    headY: 0,
    headRot: 0,
    earL: 0,
    earR: 0,
    tail: flat(),
    legs: still(),
    pawL: { x: 0, y: 0 },
    pawR: { x: 0, y: 0 },
    blink: 0,
    brow: 0,
    mouthOpen: 1,
    stance: "sit",
    expression: null,
    mouth: null,
  };
}

/* ------------------------------------------------------------ the moves */

/**
 * Every move, in the editor's order: the fourteen moves every character
 * plays (the Shiba's set), ported to a cat, then the cat's own.
 */
export const GRUMP_MOVES = [
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
  "stalk",
  "sitUp",
  "loaf",
  "stretch",
  "groom",
  "tailFlick",
  "earsFlat",
  "slowBlink",
  "knead",
  "pounce",
  "ledge",
  "curl",
  "yawn",
  "hiss",
  "bonk",
  "drag",
] as const;
export type GrumpMove = (typeof GRUMP_MOVES)[number];
export const isGrumpMove = (value: unknown): value is GrumpMove => typeof value === "string" && (GRUMP_MOVES as readonly string[]).includes(value);

export interface GrumpMoveTiming {
  /** s: one cycle of a held move, the whole of a one-shot. */
  duration: number;
  /** Held (an activity that lasts until it changes) or a one-shot. */
  loop: boolean;
  /** Under reduced motion: show the move's face and stance, still, or nothing at all. */
  reduced: "face" | "none";
}

export const GRUMP_MOVE_TIMING: Readonly<Record<GrumpMove, GrumpMoveTiming>> = {
  idle: { duration: 3.8, loop: true, reduced: "none" },
  blink: { duration: 0.2, loop: false, reduced: "none" },
  look: { duration: 1.8, loop: false, reduced: "none" },
  nod: { duration: 1, loop: false, reduced: "none" },
  shake: { duration: 1, loop: false, reduced: "none" },
  bounce: { duration: 0.8, loop: false, reduced: "none" },
  wave: { duration: 1.6, loop: false, reduced: "face" },
  think: { duration: 2.4, loop: false, reduced: "face" },
  celebrate: { duration: 2, loop: false, reduced: "face" },
  sleep: { duration: 4.4, loop: true, reduced: "face" },
  alert: { duration: 0.9, loop: false, reduced: "face" },
  talk: { duration: 0.42, loop: true, reduced: "face" },
  listen: { duration: 2.4, loop: true, reduced: "face" },
  work: { duration: 0.9, loop: true, reduced: "face" },
  // the walk cycle: eight keyframes of 110 ms, the legs in a cat's lateral sequence
  walk: { duration: 0.88, loop: true, reduced: "none" },
  stalk: { duration: 1.7, loop: true, reduced: "face" },
  sitUp: { duration: 0.7, loop: false, reduced: "none" },
  loaf: { duration: 4.2, loop: true, reduced: "face" },
  stretch: { duration: 2.8, loop: false, reduced: "face" },
  groom: { duration: 3.4, loop: false, reduced: "face" },
  tailFlick: { duration: 1.2, loop: false, reduced: "face" },
  earsFlat: { duration: 1.6, loop: false, reduced: "face" },
  slowBlink: { duration: 1.8, loop: false, reduced: "face" },
  knead: { duration: 2.4, loop: false, reduced: "face" },
  pounce: { duration: 1.7, loop: false, reduced: "face" },
  ledge: { duration: 2.6, loop: false, reduced: "face" },
  curl: { duration: 2.4, loop: false, reduced: "face" },
  yawn: { duration: 1.8, loop: false, reduced: "face" },
  hiss: { duration: 1.4, loop: false, reduced: "face" },
  bonk: { duration: 1.4, loop: false, reduced: "face" },
  drag: { duration: 1.2, loop: true, reduced: "face" },
};

const TAU = Math.PI * 2;
/** 0 at the ends, 1 in the middle (a hop, a burst). */
const bump = (p: number) => (p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p));
/** Eases in over `a` and out over the last `b` of a span of `d`: a held pose. */
const hold = (u: number, d: number, a = 0.2, b = 0.25) => Math.min(easeInOut(clamp01(u / a)), easeInOut(clamp01((d - u) / b)));
/** 0 before `a`, 1 after `b`, eased between. */
const ramp = (u: number, a: number, b: number) => easeInOut(clamp01((u - a) / (b - a)));
/** A window that holds between `a` and `b` and eases over `e` at each end. */
const span = (u: number, a: number, b: number, e = 0.2) => Math.min(ramp(u, a, a + e), 1 - ramp(u, b - e, b));

/**
 * A wave down the tail: each joint swings `amp` degrees (growing toward the
 * tip) at `freq` Hz, the next joint `lag` radians later, plus a base bend.
 */
export function tailWave(t: number, amp: number, freq: number, lag = 0.9, base: readonly number[] = [0, 0, 0, 0]): number[] {
  const grow = [0.45, 0.7, 1, 1.25];
  return Array.from({ length: TAIL_JOINTS }, (_, i) => (base[i] ?? 0) + amp * grow[i] * Math.sin(TAU * freq * t - i * lag));
}

/**
 * The walk cycle of one leg, eight keyframes (phase k/8): where its paw is
 * ahead of the hip and how high it is lifted. The paw touches down ahead
 * (0), slides back under the body while it bears weight (1-4), pushes off
 * (4), lifts and swings forward (5-7). Between keys the cycle is a smooth
 * closed curve (Catmull-Rom), so the paw never jerks.
 */
export const WALK_KEYS: readonly GrumpLegPose[] = [
  { x: 4.2, lift: 0 },
  { x: 2.3, lift: 0 },
  { x: 0.4, lift: 0 },
  { x: -1.5, lift: 0 },
  { x: -3.6, lift: 0 },
  { x: -3.1, lift: 3 },
  { x: 0.5, lift: 4.4 },
  { x: 3.6, lift: 2 },
];
/** Each leg's place in the cycle: a cat's lateral sequence (hind, fore on one side, then the other). */
export const WALK_PHASE: Readonly<Record<GrumpLeg, number>> = { backNear: 0, frontNear: 0.25, backFar: 0.5, frontFar: 0.75 };

/** The cycle at phase p (0..1): the keyframes as a closed Catmull-Rom curve. */
export function walkKey(p: number): GrumpLegPose {
  const n = WALK_KEYS.length;
  const s = (((p % 1) + 1) % 1) * n;
  const i = Math.floor(s);
  const t = s - i;
  const k = (j: number) => WALK_KEYS[(i + j + n) % n];
  const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  return { x: cr(k(-1).x, k(0).x, k(1).x, k(2).x), lift: Math.max(0, cr(k(-1).lift, k(0).lift, k(1).lift, k(2).lift)) };
}

/** The four legs at phase p, the reach scaled. */
function gaitLegs(p: number, reach = 1, lift = 1): Record<GrumpLeg, GrumpLegPose> {
  return Object.fromEntries(
    GRUMP_LEGS.map((leg) => {
      const key = walkKey(p + WALK_PHASE[leg]);
      return [leg, { x: key.x * reach, lift: key.lift * lift }];
    }),
  ) as Record<GrumpLeg, GrumpLegPose>;
}

/** The walk at phase p (0..1): the legs, the body riding the steps, the head steady against it, ears and tail trailing behind. */
function walkPose(p: number, t: number): GrumpPosePart {
  const phi = TAU * p;
  return {
    stance: "stand",
    legs: gaitLegs(p),
    // two small rises a cycle, as each pair passes under the body
    bodyY: -0.5 * Math.cos(2 * phi),
    bodyRot: 0.8 * Math.sin(phi),
    pivot: (BACK + FRONT) / 2,
    // the head stays level while the body rides: it moves against it, late
    headY: 0.35 * Math.cos(2 * phi - 0.6),
    headRot: 1.2 * Math.sin(phi - 0.5),
    earL: 2.5 * Math.sin(2 * phi - 1.4),
    earR: 2.5 * Math.sin(2 * phi - 1.7),
    // carried high in a loose hook, the tip swaying with the stride
    tail: tailWave(t, 10, 1 / GRUMP_MOVE_TIMING.walk.duration / 2, 0.8, [8, -4, 6, 10]),
  };
}

/** A move's pose `at` seconds in (a held move cycles). */
export function grumpMoveAt(move: GrumpMove, at: number): GrumpPosePart {
  const { duration: d, loop } = GRUMP_MOVE_TIMING[move];
  const u = loop ? ((at % d) + d) % d : Math.min(Math.max(0, at), d);
  switch (move) {
    case "idle":
      return { tail: tailWave(u, 3, 1 / d, 1.1) };
    case "blink":
      return { blink: bump(u / d) };
    case "look": {
      const k = Math.sin((TAU * u) / d) * hold(u, d, 0.3, 0.3);
      return { headX: 2.2 * k, headRot: -3 * k, earL: -3 * k, earR: 3 * k };
    }
    case "nod":
      return { headY: 2 * bump((u % 0.5) / 0.5), headRot: 1.2 * bump((u % 0.5) / 0.5) };
    case "shake": {
      const k = Math.sin(TAU * 3 * u) * (1 - u / d);
      return { headRot: 7 * k, headX: 1.2 * k, earL: 8 * k, earR: -8 * k };
    }
    case "bounce": {
      const air = bump((u - 0.12) / 0.56);
      return { y: -8 * air, sy: 1 - 0.08 * bump(u / 0.14) - 0.06 * bump((u - 0.66) / 0.14) + 0.04 * air, earL: -8 * air, earR: -8 * air, tail: [12 * air, 8 * air, 4 * air, 0] };
    }
    case "wave": {
      // a reluctant wave: one paw up, a few bats, the face unimpressed
      const up = hold(u, d, 0.25, 0.3);
      return { pawR: { x: (12 + 2.4 * Math.sin(TAU * 2.5 * u)) * up, y: -30 * up }, headRot: -4 * up, headX: -1.2 * up, tail: tailWave(u, 6, 1.5), expression: "bored" };
    }
    case "think": {
      const k = hold(u, d, 0.35, 0.4);
      return { headRot: 8 * k, earL: -6 * k, earR: 4 * k, brow: -1 * k, tail: tailWave(u, 5, 0.8, 1.2, [0, 0, 6 * k, 10 * k]), expression: "curious" };
    }
    case "celebrate": {
      const hop = (p: number) => bump(p / 0.5);
      const air = hop(u - 0.1) + hop(u - 0.8);
      return { y: -8 * air, sy: 1 + 0.04 * air, earL: -8 * air, earR: -8 * air, tail: tailWave(u, 14, 2.4, 0.7, [10, 6, 0, 0]), expression: "excited", mouth: "open" };
    }
    case "sleep": {
      const breath = Math.sin((TAU * u) / d);
      return { stance: "curl", expression: "sleepy", sy: 1 + 0.025 * breath, sx: 1 - 0.01 * breath, headY: 0.5 * Math.sin((TAU * u) / d - 0.6), earL: 6, earR: 6, tail: [0, 0, 2 * breath, 3 * breath] };
    }
    case "alert": {
      const k = bump(u / 0.34);
      return { expression: "surprised", earL: -14, earR: -14, y: -2.5 * k, brow: -1.2, sy: 1 + 0.03 * k, tail: [6, 4, 0, -6] };
    }
    case "talk":
      return { mouth: "open", mouthOpen: 0.7 + 0.4 * (0.5 + 0.5 * Math.sin((TAU * u) / d)), headY: 0.4 * Math.sin((TAU * u) / d), expression: "bored" };
    case "listen":
      return { headRot: 8 + Math.sin((TAU * u) / d), earL: -10, earR: -6, tail: tailWave(u, 4, 1 / d), expression: "attentive" };
    case "work":
      return { headY: 0.8 * bump((u % 0.45) / 0.45), tail: tailWave(u, 3, 1 / d), expression: "attentive" };
    case "walk":
      return walkPose(u / d, at);
    case "stalk": {
      // low and slow: the body sunk over bent legs, the head level and forward, the tail low with its tip twitching
      const p = u / d;
      const legs = gaitLegs(p, 0.7, 0.75);
      return {
        stance: "stand",
        legs,
        bodyY: 3.2 - 0.25 * Math.cos(TAU * 2 * p),
        bodyRot: 2,
        pivot: BACK,
        headX: 2.4,
        headY: 3.4,
        headRot: 0.6 * Math.sin(TAU * p),
        earL: -6,
        earR: -6,
        tail: [-34, 14, 6, 10 + 14 * Math.max(0, Math.sin(TAU * 3 * (at / d)))],
        expression: "suspicious",
      };
    }
    case "sitUp":
      // from the loaf (or a stand) to sitting tall: up through a stretch of the neck, then settle
      return { stance: u < 0.22 ? "lie" : "sit", sy: 1 + 0.05 * bump((u - 0.18) / 0.3) - 0.05 * bump((u - 0.46) / 0.24), headY: -1.4 * bump((u - 0.2) / 0.4), tail: tailWave(u, 10, 1.4) };
    case "loaf": {
      const breath = Math.sin((TAU * u) / d);
      // half lids, then one slow blink each cycle, the tail tip ticking now and then
      return { stance: "lie", expression: "bored", sy: 1 + 0.015 * breath, headY: 0.3 * breath, earL: 4, earR: 4, blink: bump((u - 2.6) / 0.9), tail: [0, 0, 6 * bump((u - 1.2) / 0.5), 12 * bump((u - 1.25) / 0.5)] };
    }
    case "stretch": {
      // the front stretch (chest down, rump up, front legs out), then the back one (chest up, a hind leg out behind)
      const front = span(u, 0, 1.35, 0.4);
      const back = span(u, 1.35, d, 0.38);
      const yawning = u > 0.35 && u < 1.1;
      return {
        stance: "stand",
        bodyRot: 15 * front - 7 * back,
        pivot: lerp(BACK, FRONT, back),
        bodyY: 1.4 * front,
        headX: 2 * front - 0.6 * back,
        headY: 5.4 * front - 1.4 * back,
        headRot: 4 * front - 5 * back,
        earL: 8 * front,
        earR: 8 * front,
        legs: {
          frontNear: { x: 8 * front - 0.6 * back, lift: 0 },
          frontFar: { x: 7 * front - 0.4 * back, lift: 0 },
          backNear: { x: -1 * front - 7.4 * back, lift: 2.6 * back },
          backFar: { x: -1 * front - 1.4 * back, lift: 0 },
        },
        tail: [26 * front - 18 * back, 6 * front, -4 * front + 8 * back, 6 * front + 10 * back],
        expression: back > 0.5 ? "proud" : "happy",
        mouth: yawning ? "yawn" : null,
      };
    }
    case "groom": {
      // lick the paw, then rub it over the face and behind the ear
      const raise = span(u, 0.05, d - 0.05, 0.35);
      const licking = u > 0.4 && u < 1.8;
      const rub = span(u, 1.8, d - 0.35, 0.3);
      const lap = licking ? bump(((u - 0.4) % 0.32) / 0.32) : 0;
      const sweep = rub > 0 ? Math.sin(TAU * 1.4 * (u - 1.8)) : 0;
      return {
        // the paw at the mouth, then circling the cheek up to the ear
        pawR: { x: (-4.5 + rub * (6 + 3 * sweep)) * raise, y: (-27 - 1.6 * lap - rub * (10 + 5 * Math.cos(TAU * 1.4 * (u - 1.8)))) * raise },
        headRot: (-7 * (1 - rub) + 11 * rub) * raise,
        headY: (2.2 + 1.2 * lap) * raise * (1 - rub),
        earR: 26 * rub * Math.max(0, sweep),
        tail: tailWave(u, 3, 0.6),
        expression: "happy",
        mouth: licking ? "lick" : null,
      };
    }
    case "tailFlick": {
      // three whips of the tip, the face annoyed
      const whip = [0.1, 0.45, 0.8].reduce((sum, start) => sum + bump((u - start) / 0.26), 0);
      return { tail: [6 * whip, 10 * whip, 26 * whip, 40 * whip], earR: 10, earL: 4, expression: "suspicious" };
    }
    case "earsFlat": {
      const k = hold(u, d, 0.15, 0.4);
      return { earL: 48 * k, earR: 48 * k, headY: 1.2 * k, sy: 1 - 0.03 * k, tail: [10 * k, 0, 18 * k, 24 * k], expression: "angry" };
    }
    case "slowBlink": {
      // the cat's "I trust you": lids down slowly, a beat shut, up slower
      const shut = u < 0.55 ? easeInOut(u / 0.55) : u < 0.95 ? 1 : 1 - easeInOut((u - 0.95) / 0.85);
      return { blink: shut, headRot: -2 * shut, earL: 4 * shut, earR: 4 * shut, expression: "neutral", brow: 0.6 * shut };
    }
    case "knead": {
      // making biscuits: the front paws press in turn, the eyes half shut with content
      const k = hold(u, d, 0.25, 0.3);
      const press = (offset: number) => Math.max(0, Math.sin(TAU * 1.6 * u + offset));
      return {
        pawL: { x: 0.4 * press(0) * k, y: -3.4 * press(0) * k },
        pawR: { x: -0.4 * press(Math.PI) * k, y: -3.4 * press(Math.PI) * k },
        x: 0.4 * Math.sin(TAU * 1.6 * u) * k,
        headRot: 1.6 * Math.sin(TAU * 1.6 * u) * k,
        earL: 6 * k,
        earR: 6 * k,
        blink: 0.55 * k,
        tail: tailWave(u, 4, 0.8),
        expression: "happy",
      };
    }
    case "pounce": {
      // crouch, wiggle the rump, spring, land, settle
      const crouch = span(u, 0, 0.78, 0.22);
      const wiggle = u > 0.25 && u < 0.72 ? Math.sin(TAU * 6 * u) : 0;
      const air = bump((u - 0.72) / 0.42);
      const fly = clamp01((u - 0.72) / 0.42);
      const land = bump((u - 1.1) / 0.24);
      const back = ramp(u, 1.3, d);
      return {
        stance: "stand",
        bodyY: 3.4 * crouch,
        bodyRot: 2.4 * crouch + 2.2 * wiggle * crouch + (-10 + 20 * fly) * air,
        pivot: lerp(FRONT, BACK, air),
        x: 9 * (fly > 0 ? easeInOut(fly) : 0) * (1 - back),
        y: -15 * air,
        sy: 1 - 0.1 * land + 0.05 * air,
        headY: 2.6 * crouch,
        headX: 1.6 * crouch,
        earL: -10 * crouch,
        earR: -10 * crouch,
        legs: {
          frontNear: { x: 6 * air, lift: 3 * air },
          frontFar: { x: 5 * air, lift: 2.6 * air },
          backNear: { x: -5 * air + 0.6 * wiggle * crouch, lift: 2 * air },
          backFar: { x: -4.4 * air - 0.6 * wiggle * crouch, lift: 1.6 * air },
        },
        tail: [-26 * crouch - 10 * air, 8 * crouch, 4 * crouch, 16 * wiggle * crouch],
        expression: "excited",
      };
    }
    case "ledge": {
      // crouch, spring up onto a ledge, land, sit up there a moment, hop back down
      const crouch = span(u, 0, 0.5, 0.18);
      const up = ramp(u, 0.42, 0.78);
      const land = bump((u - 0.76) / 0.22);
      const down = ramp(u, 2.1, 2.48);
      const height = 14 * (up - down);
      const arc = 9 * bump((u - 0.42) / 0.36) + 5 * bump((u - 2.1) / 0.38);
      const sat = u > 1.05 && u < 2.05;
      return {
        stance: sat ? "sit" : "stand",
        bodyY: 3 * crouch,
        y: -height - arc,
        sy: 1 - 0.1 * land - 0.08 * bump((u - 2.44) / 0.16) + 0.05 * bump((u - 0.42) / 0.36),
        legs: { frontNear: { x: 2.4 * bump((u - 0.42) / 0.36), lift: 3.2 * bump((u - 0.42) / 0.36) }, frontFar: { x: 2, lift: 2.6 * bump((u - 0.42) / 0.36) }, backNear: { x: -3 * bump((u - 0.42) / 0.36), lift: 1.4 * bump((u - 0.42) / 0.36) }, backFar: { x: -2.4 * bump((u - 0.42) / 0.36), lift: 1 * bump((u - 0.42) / 0.36) } },
        headY: 2 * crouch,
        earL: -8 * crouch,
        earR: -8 * crouch,
        tail: sat ? tailWave(u, 5, 1.2) : [10 * bump((u - 0.42) / 0.36), 6, 0, 8],
        expression: sat ? "proud" : "attentive",
      };
    }
    case "curl": {
      // stand, turn once around the spot, sink into a ball with the tail around the front
      const turnP = clamp01((u - 0.35) / 1.05);
      const c = Math.cos(TAU * turnP);
      const walking = u > 0.3 && u < 1.45;
      if (u < 1.5) {
        return {
          stance: u < 0.18 ? "sit" : "stand",
          ...(walking ? { legs: gaitLegs(u / 0.44, 0.6, 0.8) } : {}),
          turn: walking ? Math.sign(c || 1) * (0.3 + 0.7 * Math.abs(c)) : 1,
          x: 4 * Math.sin(TAU * turnP),
          sy: 1 - 0.05 * bump(u / 0.3),
          tail: tailWave(u, 8, 1.2, 0.8, [6, 0, 0, 6]),
          expression: "bored",
        };
      }
      const sink = ramp(u, 1.5, 1.85);
      return { stance: "curl", sy: 1 - 0.08 * bump((u - 1.5) / 0.35) + 0.02 * Math.sin(TAU * 0.3 * u) * sink, headY: 1.2 * (1 - sink), earL: 6 * sink, earR: 6 * sink, expression: u > 1.9 ? "sleepy" : "bored", tail: [0, 0, 4 * (1 - sink), 6 * (1 - sink)] };
    }
    case "yawn": {
      const k = hold(u, d, 0.4, 0.5);
      const shakeOff = u > 1.35 ? Math.sin(TAU * 5 * u) * (1 - (u - 1.35) / 0.45) : 0;
      return { headRot: -5 * k + 3 * shakeOff, headY: -1.6 * k, earL: 14 * k, earR: 14 * k, sy: 1 + 0.03 * k, tail: tailWave(u, 4, 0.8), expression: "happy", mouth: u > 0.25 && u < 1.35 ? "yawn" : null };
    }
    case "hiss": {
      // puffed, ears flat, leaning back, the hiss with a tremble
      const k = hold(u, d, 0.12, 0.35);
      const tremble = Math.sin(TAU * 17 * u) * k;
      return { earL: 52 * k, earR: 52 * k, sx: 1 + 0.07 * k, sy: 1 + 0.04 * k, rot: -3 * k, x: 0.4 * tremble, headY: 1.2 * k, headX: -0.6 * k, tail: [24 * k, 14 * k, 2 * tremble, -14 * k], expression: "angry", mouth: u > 0.08 && u < d - 0.25 ? "hiss" : null };
    }
    case "bonk": {
      // two head bonks toward whoever nudged it, eyes shut, ears back
      const knock = bump((u - 0.15) / 0.38) + bump((u - 0.68) / 0.38);
      const k = hold(u, d, 0.15, 0.3);
      return { headRot: 13 * knock, headX: 4 * knock, headY: -1 * knock, earL: 14 * knock, earR: 10 * knock, rot: 1.6 * knock, tail: [10 * k, 8 * k, 4 * k, 6 * k], expression: "happy", mouth: "cat" };
    }
    case "drag": {
      const k = Math.sin((TAU * u) / d);
      return { rot: 4 * k, sy: 1.06, earL: 30, earR: 30, tail: [20, 10 * k, 6, -6 * k], expression: "angry", pawL: { x: 0, y: 1.6 }, pawR: { x: 0, y: 1.6 } };
    }
  }
}

/** A move's face and stance, still: what reduced motion shows while it plays (null shows nothing). */
export function grumpReducedFace(move: GrumpMove): Pick<GrumpPose, "stance" | "expression" | "mouth"> | null {
  const timing = GRUMP_MOVE_TIMING[move];
  if (timing.reduced === "none") return null;
  // the middle of a one-shot, the start of a held move; the hiss and the yawn show their open mouth
  const pose = grumpMoveAt(move, timing.loop ? 0 : timing.duration / 2);
  return { stance: pose.stance ?? "sit", expression: pose.expression ?? null, mouth: pose.mouth ?? null };
}

/* ------------------------------------------------------------- blending */

const NUMERIC = ["x", "y", "rot", "sx", "sy", "turn", "bodyY", "bodyRot", "pivot", "headX", "headY", "headRot", "earL", "earR", "blink", "brow", "mouthOpen"] as const;

/** A pose with a move's part laid over it at weight `w` (0..1); the stance, face and mouth switch at half way. */
export function blendGrumpPose(base: GrumpPose, part: GrumpPosePart, w: number): GrumpPose {
  if (w <= 0) return base;
  const out: GrumpPose = { ...base, tail: [...base.tail], legs: { ...base.legs }, pawL: { ...base.pawL }, pawR: { ...base.pawR } };
  for (const key of NUMERIC) {
    const value = part[key];
    if (typeof value === "number") out[key] = lerp(base[key], value, w);
  }
  if (part.tail) for (let i = 0; i < TAIL_JOINTS; i += 1) out.tail[i] = lerp(base.tail[i], part.tail[i] ?? 0, w);
  if (part.legs)
    for (const leg of GRUMP_LEGS) {
      const target = part.legs[leg];
      if (target) out.legs[leg] = { x: lerp(base.legs[leg].x, target.x, w), lift: lerp(base.legs[leg].lift, target.lift, w) };
    }
  for (const paw of ["pawL", "pawR"] as const) {
    const target = part[paw];
    if (target) out[paw] = { x: lerp(base[paw].x, target.x, w), y: lerp(base[paw].y, target.y, w) };
  }
  if (w >= 0.5) {
    if (part.stance) out.stance = part.stance;
    if (part.expression !== undefined && part.expression !== null) out.expression = part.expression;
    if (part.mouth !== undefined) out.mouth = part.mouth;
  }
  return out;
}

/** How far a one-shot shows `u` s in: in over 0.14 s, out over 0.22 s after its end. */
export function grumpMoveWeight(move: GrumpMove, u: number): number {
  const { duration } = GRUMP_MOVE_TIMING[move];
  if (u < 0 || u > duration + 0.22) return 0;
  return Math.min(easeInOut(clamp01(u / 0.14)), u > duration ? 1 - easeInOut(clamp01((u - duration) / 0.22)) : 1);
}

/** A cat's blinks: slower than the Shiba's, the lids lingering. */
const SLOW = 2.4;

/** The idle life under everything at `t` s: a breath, the seeded slow blinks, a lazy tail tip. */
export function grumpIdlePose(t: number, blinks: readonly number[]): GrumpPose {
  const pose = grumpRestPose();
  const breath = Math.sin((TAU * t) / 3.8);
  pose.sx = 1 + 0.007 * breath;
  pose.sy = 1 - 0.007 * breath;
  pose.headY = 0.3 * Math.sin((TAU * t) / 3.8 - 0.5);
  pose.tail = tailWave(t, 2.4, 0.22, 1.2);
  pose.blink = 1 - blinkOpen(t / SLOW, blinks);
  return pose;
}

/**
 * One live Grump: the idle life, a held activity and a one-shot move, all on
 * one clock (seconds). `pose(now)` is the frame to draw.
 */
export class GrumpRig {
  private readonly start: number;
  private readonly seed: number;
  private blinks: number[] = [];
  private blinkHorizon = 0;
  private held: { move: GrumpMove; since: number } | null = null;
  private letGo: { move: GrumpMove; since: number; at: number } | null = null;
  private shot: { move: GrumpMove; at: number } | null = null;
  private stance: GrumpStance = "sit";
  private stanceAt = -Infinity;

  constructor(now: number, seed = Math.random() * 1000) {
    this.start = now;
    this.seed = seed;
  }

  /** The activity held until it changes (walk, stalk, loaf, sleep...), or none. */
  hold(move: GrumpMove | null, now: number): void {
    if ((this.held?.move ?? null) === move) return;
    this.letGo = this.held ? { ...this.held, at: now } : null;
    this.held = move ? { move, since: now } : null;
  }

  /** A one-shot move, from its start. */
  play(move: GrumpMove, now: number): void {
    this.shot = { move, at: now };
  }

  /** The held activity now. */
  holding(): GrumpMove | null {
    return this.held?.move ?? null;
  }

  /** Whether a one-shot is still showing at `now`. */
  playing(now: number): boolean {
    return this.shot !== null && now - this.shot.at <= GRUMP_MOVE_TIMING[this.shot.move].duration + 0.22;
  }

  /** Whether anything but the idle life is under way. */
  busy(now: number): boolean {
    return this.held !== null || this.playing(now) || (this.letGo !== null && now - this.letGo.at < 0.3);
  }

  pose(now: number): GrumpPose {
    const t = now - this.start;
    if (t / SLOW + 6 > this.blinkHorizon) {
      this.blinkHorizon = t / SLOW + 30;
      this.blinks = blinkSchedule(this.seed, this.blinkHorizon);
    }
    let pose = grumpIdlePose(t, this.blinks);
    if (this.letGo) {
      const out = 1 - easeInOut(clamp01((now - this.letGo.at) / 0.3));
      if (out <= 0) this.letGo = null;
      else pose = blendGrumpPose(pose, grumpMoveAt(this.letGo.move, now - this.letGo.since), out);
    }
    if (this.held) pose = blendGrumpPose(pose, grumpMoveAt(this.held.move, now - this.held.since), easeInOut(clamp01((now - this.held.since) / 0.3)));
    if (this.shot) {
      const u = now - this.shot.at;
      const w = grumpMoveWeight(this.shot.move, u);
      if (w <= 0 && u > 0) this.shot = null;
      else pose = blendGrumpPose(pose, grumpMoveAt(this.shot.move, u), w);
    }
    // a new stance lands with a small squash
    if (pose.stance !== this.stance) {
      this.stance = pose.stance;
      this.stanceAt = now;
    }
    const landing = bump((now - this.stanceAt) / 0.22);
    if (landing > 0) {
      pose.sy *= 1 - 0.07 * landing;
      pose.sx *= 1 + 0.04 * landing;
    }
    return pose;
  }
}

/* ------------------------------------------------------- SVG transforms */

const f = (v: number) => String(Math.round(v * 100) / 100);

/** `rotate(a)` about a point, then a move: the transform of one part. */
export const grumpTurnAbout = (angle: number, [x, y]: readonly [number, number], dx = 0, dy = 0) => `translate(${f(dx)} ${f(dy)}) rotate(${f(angle)} ${x} ${y})`;

/** A part scaled about a point (the mouth's talk). */
export const grumpScaleAbout = (sx: number, sy: number, [x, y]: readonly [number, number]) => `translate(${x} ${y}) scale(${f(sx)} ${f(sy)}) translate(${-x} ${-y})`;

/** Where the torso pitches about: the hips at x, at their height. */
const pivotOf = (pose: GrumpPose): Point => [pose.pivot, GRUMP_HIPS.backNear[1]];

/** A point carried by the torso (a hip, the tail's root): pitched about the pivot, then lowered by the crouch. */
export function torsoPoint(pose: GrumpPose, [x, y]: Point): Point {
  if (pose.stance !== "stand") return [x, y];
  const [px, py] = pivotOf(pose);
  const a = (pose.bodyRot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [px + (x - px) * c - (y - py) * s, py + (x - px) * s + (y - py) * c + pose.bodyY];
}

/** The whole drawing's transform: move, lean about the ground, then squash and the facing about it. */
export function grumpWholeTransform(pose: GrumpPose): string {
  const [gx, gy] = GRUMP_PIVOTS.ground;
  // a flat turn never reaches zero width: it passes its edge as a sliver
  const turn = Math.sign(pose.turn || 1) * Math.max(0.06, Math.abs(pose.turn));
  return `translate(${f(pose.x * Math.sign(pose.turn || 1))} ${f(pose.y)}) translate(${gx} ${gy}) rotate(${f(pose.rot)}) scale(${f(turn * pose.sx)} ${f(pose.sy)}) translate(${-gx} ${-gy})`;
}

/** Every moving group's transform for a pose (the live loop writes them; a still render passes them). */
export type GrumpTransforms = Record<"whole" | "torso" | "head" | "earL" | "earR" | "brows" | "mouth", string>;

export function grumpTransforms(pose: GrumpPose): GrumpTransforms {
  const P = GRUMP_PIVOTS;
  const [px, py] = pivotOf(pose);
  return {
    whole: grumpWholeTransform(pose),
    torso: pose.stance === "stand" ? `translate(0 ${f(pose.bodyY)}) rotate(${f(pose.bodyRot)} ${f(px)} ${py})` : "",
    head: grumpTurnAbout(pose.headRot, P.neck, pose.headX, pose.headY),
    // the left ear flattens counterclockwise (out to the left), the right one clockwise
    earL: grumpTurnAbout(-pose.earL, P.earL),
    earR: grumpTurnAbout(pose.earR, P.earR),
    brows: `translate(0 ${f(pose.brow)})`,
    mouth: grumpScaleAbout(1, pose.mouthOpen, P.mouth),
  };
}

/** Where each standing hip is under the torso now (the legs reach the ground from there). */
export function grumpHipsAt(pose: GrumpPose): Record<GrumpLeg, Point> {
  return Object.fromEntries(GRUMP_LEGS.map((leg) => [leg, torsoPoint(pose, GRUMP_HIPS[leg])])) as Record<GrumpLeg, Point>;
}

/** The head's placement for a stance (about the neck), before the rig's own turn. */
export function grumpHeadPlace(stance: GrumpStance): string {
  const head = GRUMP_STANCE_HEAD[stance];
  if (head.scale === 1 && !head.x && !head.y && !head.rot) return "";
  const [nx, ny] = GRUMP_PIVOTS.neck;
  return `translate(${head.x} ${head.y}) rotate(${head.rot} ${nx} ${ny}) translate(${nx} ${ny}) scale(${head.scale}) translate(${-nx} ${-ny})`;
}

/** The rest of each stance's tail (for a stance's own tail). */
export const GRUMP_TAIL_REST = GRUMP_TAIL;

/* ------------------------------------------------------------ SVG frame */

/**
 * One frame of a pose as an SVG string (the keyframe renders, the tests):
 * the same parts, order and transforms the live drawing uses.
 */
export function grumpPoseSvg(pose: GrumpPose, options: { palette: GrumpPalette; size: number; expression?: GrumpExpression; uid?: string }): string {
  const { palette, size } = options;
  const uid = options.uid ?? "gp";
  const ow = grumpOutline(size);
  const parts = grumpParts({ expression: pose.expression ?? options.expression ?? "neutral", mouth: pose.mouth, stance: pose.stance, size, tailBend: pose.tail, blink: pose.blink });
  const tf = grumpTransforms(pose);
  const draw = (ops: Parameters<typeof grumpOpsToSvg>[0], key: string) => grumpOpsToSvg(ops, palette, `${uid}${key}`);
  const hips = grumpHipsAt(pose);
  const legs = (side: "Far" | "Near") => GRUMP_LEGS.filter((leg) => leg.endsWith(side)).map((leg) => draw(grumpLegOps(leg, pose.legs[leg].x, pose.legs[leg].lift, ow, hips[leg]), leg)).join("");
  const face = `<g transform="${tf.brows}">${draw(parts.brows, "br")}</g>${draw(parts.eyeL, "yl")}${draw(parts.eyeR, "yr")}${draw(parts.nose, "n")}<g transform="${tf.mouth}">${draw(parts.mouth, "m")}</g>${draw(parts.extras, "x")}`;
  const head = `<g transform="${grumpHeadPlace(pose.stance)}"><g transform="${tf.head}"><g transform="${tf.earL}">${draw(parts.earL, "el")}</g><g transform="${tf.earR}">${draw(parts.earR, "er")}</g>${draw(parts.head, "h")}${face}</g></g>`;
  const paws = pose.stance === "sit" ? draw([...grumpPawOps("l", pose.pawL.x, pose.pawL.y, ow), ...grumpPawOps("r", pose.pawR.x, pose.pawR.y, ow)], "p") : draw(parts.paws, "p");
  const torso = (inner: string) => (tf.torso ? `<g transform="${tf.torso}">${inner}</g>` : inner);
  const group = { tail: () => torso(draw(parts.tail, "t")), body: () => torso(draw(parts.body, "b")), paws: () => torso(paws), legsFar: () => legs("Far"), legsNear: () => legs("Near"), head: () => torso(head) };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${grumpViewBox(size)}" width="${size}" height="${size}" style="overflow:visible"><g transform="${tf.whole}">${GRUMP_ORDER[pose.stance].map((key) => group[key]()).join("")}</g></svg>`;
}

/** A move's pose `at` s in, over the rest (no idle life): the keyframe renders and the tests. */
export function grumpMovePose(move: GrumpMove, at: number): GrumpPose {
  return blendGrumpPose(grumpRestPose(), grumpMoveAt(move, at), 1);
}

/* ------------------------------------------------------ desktop clips */

/** The moves a desktop clip (floating-bots/clips.ts) plays on Grump; a clip it has no move for keeps the idle life. */
export const GRUMP_CLIP_MOVES: Readonly<Record<string, GrumpMove>> = {
  look: "look",
  lookBack: "look",
  headSpin: "shake",
  tilt: "think",
  spin: "curl",
  backflip: "pounce",
  hop: "bounce",
  hopForward: "pounce",
  wave: "wave",
  dance: "knead",
  jump: "ledge",
  stretch: "stretch",
  wingStretch: "stretch",
  preen: "groom",
  scratch: "groom",
  peck: "tailFlick",
  bob: "nod",
  ruffle: "groom",
  shy: "slowBlink",
  confused: "tailFlick",
  think: "think",
  hoot: "alert",
  doubleBlink: "slowBlink",
  wink: "slowBlink",
  surprised: "alert",
  startled: "pounce",
  angry: "hiss",
  love: "knead",
  yawn: "yawn",
  wake: "stretch",
  land: "sitUp",
  petted: "bonk",
  celebrate: "celebrate",
  sad: "earsFlat",
  // the dog's clips (Shiba's), should a cat ever be asked for one
  bark: "tailFlick",
  sniff: "think",
  wag: "tailFlick",
  earTwitch: "look",
  lieDown: "curl",
  turnCircles: "curl",
  excited: "pounce",
  sit: "sitUp",
  // the frog's clips (Frog's), should a cat ever be asked for one
  croak: "hiss",
  tongue: "groom",
  smugNod: "nod",
  legStretch: "stretch",
  shiver: "shake",
  sideEye: "look",
  blinkOne: "slowBlink",
  longJump: "pounce",
  // the cat's own clips
  groom: "groom",
  knead: "knead",
  pounce: "pounce",
  ledge: "ledge",
  curl: "curl",
  hiss: "hiss",
  bonk: "bonk",
  tailFlick: "tailFlick",
  earsFlat: "earsFlat",
  slowBlink: "slowBlink",
  sitUp: "sitUp",
};

/** The held activity a desktop clip that lasts (walk, sleep, a drag) keeps on Grump. */
export const GRUMP_HELD_CLIPS: Readonly<Record<string, GrumpMove>> = {
  walk: "walk",
  fly: "walk",
  flyOut: "walk",
  return: "walk",
  sleep: "sleep",
  drag: "drag",
  working: "work",
  // the cat's own
  stalk: "stalk",
  loaf: "loaf",
};

/** The move a clip or a move id plays, or null. */
export function grumpMoveFor(clip: string | null | undefined): GrumpMove | null {
  if (!clip) return null;
  if (Object.hasOwn(GRUMP_CLIP_MOVES, clip)) return GRUMP_CLIP_MOVES[clip];
  return isGrumpMove(clip) ? clip : null;
}
