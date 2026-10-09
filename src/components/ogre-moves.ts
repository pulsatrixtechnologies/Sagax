// Ogre's moves: the rig and its timelines, as pure functions of time, so the
// component (OgreMascot.tsx), the desktop mascot, the tests and the keyframe
// renders share them. A move is a frame at `t` seconds (`ogreMoveFrame`): the
// stance, the face, where the body, the belly, the head and the ears are,
// where the hands and the boots go (the limbs are two bones placed by them,
// ogre-art.ts), the ground's shake and the props (a snore bubble, a roar's
// shock lines, stars, crumbs, the message it eats).
//
// The ogre is heavy, so everything here is about weight: the body bobs down
// on each contact and the belly, the head and the ears follow a beat later
// (`lag`), the ground shakes a little under every step and stomp (the desktop
// shakes the window, `shake`), anticipation before a big move, a settle after.
//
// The walk is a loop of eight keyframes per stride pair (contact, down,
// passing, up on each foot) through a periodic Catmull-Rom spline, so the
// lead values are smooth everywhere and the secondary motion is that same
// spline sampled late.
import { LOG_FEET, OGRE_BODY, type OgreStance, type Point } from "./ogre-art";
import { headPoint, restFrame, type OgreFrame, type OgreProp } from "./ogre-rig";

export { ogreFrameLayers, ogreFrameSvg, layersToSvg, restFrame, type OgreFrame, type OgreLayer, type OgreProp } from "./ogre-rig";

/* ------------------------------------------------------------ helpers */

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeInOut = (t: number) => {
  const k = clamp01(t);
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
};
export const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
const TAU = Math.PI * 2;
const lerpPoint = (a: Point, b: Point, t: number): Point => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

/** A value through timed keys (seconds), eased in and out between each pair; held before the first and after the last. */
export function keyed(t: number, keys: readonly (readonly [number, number])[]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      return lerp(v0, v1, easeInOut((t - t0) / (t1 - t0 || 1)));
    }
  }
  return keys[keys.length - 1][1];
}

/** A point through timed keys, the same way. */
export function keyedPoint(t: number, keys: readonly (readonly [number, Point])[]): Point {
  return [keyed(t, keys.map(([k, p]) => [k, p[0]] as const)), keyed(t, keys.map(([k, p]) => [k, p[1]] as const))];
}

/** A periodic Catmull-Rom spline through evenly spaced values, at phase p (0..1, wraps). */
export function loopSpline(values: readonly number[], p: number): number {
  const n = values.length;
  const x = (((p % 1) + 1) % 1) * n;
  const i = Math.floor(x);
  const f = x - i;
  const at = (k: number) => values[(((i + k) % n) + n) % n];
  const p0 = at(-1);
  const p1 = at(0);
  const p2 = at(1);
  const p3 = at(2);
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
}

/** A damped spring's answer to a kick at `since` seconds ago (1 at the kick, then rings down). */
export function ring(since: number, freq: number, decay: number): number {
  if (since < 0) return 0;
  return Math.exp(-decay * since) * Math.cos(TAU * freq * since);
}

/** The idle breath (all stances): the body rises, the belly swells, a beat apart. */
export function breathe(frame: OgreFrame, t: number, period = 3.6, depth = 1): OgreFrame {
  const b = Math.sin((t / period) * TAU);
  const late = Math.sin((t / period) * TAU - 0.9);
  return {
    ...frame,
    bodyY: frame.bodyY - 0.35 * depth * b,
    belly: { ...frame.belly, sx: frame.belly.sx * (1 + 0.012 * depth * late), sy: frame.belly.sy * (1 + 0.02 * depth * late) },
    head: { ...frame.head, y: frame.head.y - 0.25 * depth * late },
  };
}

/* -------------------------------------------------------------- moves */

/**
 * Every move, in the editor's order: the fourteen moves every character
 * plays, ported to an ogre (the think is a head scratch, the sleep a nap on
 * a log, the wave an open hand from the elbow), then the ogre's own: the
 * heavy walk, the belly laugh, arms crossed while an approval waits, a roar
 * for a refusal, a flex for a success, a trumpet wiggle for a nudge, a stomp
 * in a circle for an achievement, a stretch on waking, a chomp when a
 * message arrives, and dangling while dragged.
 */
export const OGRE_GENERIC_MOVES = ["idle", "blink", "look", "nod", "shake", "bounce", "wave", "think", "celebrate", "sleep", "alert", "talk", "listen", "work"] as const;
export const OGRE_OWN_MOVES = ["walk", "laugh", "crossArms", "roar", "flex", "earWiggle", "stomp", "stretch", "chomp", "drag"] as const;
export const OGRE_MOVES = [...OGRE_GENERIC_MOVES, ...OGRE_OWN_MOVES] as const;
export type OgreMove = (typeof OGRE_MOVES)[number];
export const isOgreMove = (value: unknown): value is OgreMove => typeof value === "string" && (OGRE_MOVES as readonly string[]).includes(value);

/** One stride pair (left step, right step), s: a heavy, deliberate pace. */
export const WALK_CYCLE = 1.16;

export interface OgreMoveTiming {
  /** s: one cycle of a held move, the whole of a one-shot. */
  duration: number;
  /** Held (an activity that lasts until it changes) or a one-shot. */
  loop: boolean;
  /** Under reduced motion: show the move's face and stance, still, or nothing at all. */
  reduced: "face" | "none";
}

export const OGRE_MOVE_TIMING: Readonly<Record<OgreMove, OgreMoveTiming>> = {
  idle: { duration: 3.6, loop: true, reduced: "none" },
  blink: { duration: 0.2, loop: false, reduced: "none" },
  look: { duration: 2, loop: false, reduced: "none" },
  nod: { duration: 1.1, loop: false, reduced: "none" },
  shake: { duration: 1.1, loop: false, reduced: "none" },
  bounce: { duration: 1, loop: false, reduced: "none" },
  wave: { duration: 1.8, loop: false, reduced: "face" },
  think: { duration: 2.6, loop: false, reduced: "face" },
  celebrate: { duration: 2.2, loop: false, reduced: "face" },
  sleep: { duration: 3.6, loop: true, reduced: "face" },
  alert: { duration: 1, loop: false, reduced: "face" },
  talk: { duration: 0.44, loop: true, reduced: "face" },
  listen: { duration: 2.6, loop: true, reduced: "face" },
  work: { duration: 0.9, loop: true, reduced: "face" },
  walk: { duration: WALK_CYCLE, loop: true, reduced: "none" },
  laugh: { duration: 2.4, loop: false, reduced: "face" },
  crossArms: { duration: 3.2, loop: true, reduced: "face" },
  roar: { duration: 1.8, loop: false, reduced: "face" },
  flex: { duration: 2, loop: false, reduced: "face" },
  earWiggle: { duration: 1.1, loop: false, reduced: "none" },
  stomp: { duration: 3.2, loop: false, reduced: "face" },
  stretch: { duration: 2.2, loop: false, reduced: "face" },
  chomp: { duration: 2.2, loop: false, reduced: "face" },
  drag: { duration: 1.3, loop: true, reduced: "face" },
};

/** How far a stride pair carries the ogre, box units (the desktop turns it into px). */
export const WALK_STRIDE = 22;

/**
 * The walk's eight keys per stride pair: left contact, left down (the weight
 * lands, the body at its lowest), passing (the right boot swings through,
 * the body rising), up (the highest, on the left toes), then the same on the
 * right. Body drop (+ down), sway toward the planted boot (x), lean (roll,
 * degrees), each boot's lift and stride (forward in the travel's direction).
 */
export const WALK_KEYS = {
  //          contactL down   pass   up     contactR down   pass   up
  drop: /**/ [0.6, 2.6, 0.4, -1.2, 0.6, 2.6, 0.4, -1.2],
  // the weight lands: the whole ogre squashes a little on the down, stretches on the up
  squash: /**/ [0.012, 0.04, 0, -0.018, 0.012, 0.04, 0, -0.018],
  sway: /**/ [-0.6, -1.4, -1, -0.3, 0.6, 1.4, 1, 0.3],
  roll: /**/ [-1.2, -2.6, -1.8, -0.6, 1.2, 2.6, 1.8, 0.6],
  liftL: /**/ [0, 0, 0, 0, 0.2, 0.7, 1, 0.6],
  liftR: /**/ [0.2, 0.7, 1, 0.6, 0, 0, 0, 0],
  strideL: /**/ [1, 0.6, 0, -0.6, -1, -0.6, 0, 0.6],
  // the arms swing against the legs
  swingL: /**/ [-1, -0.6, 0, 0.6, 1, 0.6, 0, -0.6],
} as const;

/** The two contacts in a stride pair (phase 0..1): where the ground shakes. */
export const WALK_CONTACTS = [0, 0.5] as const;

/** The walk at `t` s: the stride pair loops; the window moves by WALK_STRIDE per cycle, facing `facing`. */
export function walkFrame(t: number, facing: 1 | -1 = 1): OgreFrame {
  const p = t / WALK_CYCLE;
  const k = (name: keyof typeof WALK_KEYS, lag = 0) => loopSpline(WALK_KEYS[name], p - lag);
  const base = restFrame("stand", "attentive");
  // a heavy foot lifts low and lands flat; the stride shows as a step toward the travel
  const foot = (rest: Point, lift: number, stride: number, side: -1 | 1): Point => [rest[0] + stride * 1.6 * facing + side * lift * 2.4, rest[1] - Math.max(0, lift) * 7];
  const lead = k("drop");
  // the belly, the head and the ears follow the drop a beat late (overlap)
  const belly = k("drop", 0.09);
  const head = k("drop", 0.06);
  const earKick = WALK_CONTACTS.reduce((sum: number, c: number) => sum + ring(((((p - c) % 1) + 1) % 1) * WALK_CYCLE, 4.2, 6), 0);
  const shake = WALK_CONTACTS.reduce((sum: number, c: number) => {
    const since = ((((p - c) % 1) + 1) % 1) * WALK_CYCLE;
    return sum + (since < 0.16 ? (1 - since / 0.16) * 0.9 : 0);
  }, 0);
  const swing = k("swingL");
  return {
    ...base,
    facing,
    x: k("sway") * 1.6,
    // a lean into the travel, plus the waddle's roll over the planted boot
    rot: k("roll") * 0.9 + 1.6,
    sy: 1 - k("squash"),
    sx: 1 + k("squash") * 0.6,
    bodyY: lead,
    bodyRot: k("roll"),
    belly: { sx: 1 - belly * 0.012, sy: 1 + belly * 0.028, y: belly * 0.55 },
    head: { x: k("sway", 0.05) * 0.4 + 1.2, y: head * 0.7, rot: -k("roll", 0.08) * 0.8, scale: 1 },
    look: 0.55,
    ears: { l: earKick * -7 + lead * -1.2, r: earKick * -7 + lead * -1.2, back: 0.1 },
    hands: {
      l: [OGRE_BODY.handL[0] + swing * 2.6 * facing, OGRE_BODY.handL[1] - Math.abs(swing) * 1.4 + lead * 0.5],
      r: [OGRE_BODY.handR[0] - swing * 2.6 * facing, OGRE_BODY.handR[1] - Math.abs(swing) * 1.4 + lead * 0.5],
      openL: false,
      openR: false,
      front: null,
    },
    feet: { l: foot(OGRE_BODY.footL, k("liftL"), k("strideL"), -1), r: foot(OGRE_BODY.footR, k("liftR"), -k("strideL"), 1) },
    shake,
    props: WALK_CONTACTS.flatMap((c, i) => {
      const since = ((((p - c) % 1) + 1) % 1) * WALK_CYCLE;
      if (since > 0.4) return [];
      const fx = (i === 0 ? OGRE_BODY.footL : OGRE_BODY.footR)[0];
      const k2 = since / 0.4;
      return [-1, 1].map((s) => ({ kind: "dust" as const, x: fx + s * (6 + k2 * 6), y: 97 - k2 * 2, r: 1.6 + k2 * 1.6, opacity: 0.5 * (1 - k2) }));
    }),
  };
}

/** The belly laugh: rock back, the belly bounces under the hands, the shoulders shake, then a wheeze and a settle. */
function laughFrame(t: number): OgreFrame {
  const base = restFrame("stand", "laughing");
  const d = OGRE_MOVE_TIMING.laugh.duration;
  const on = keyed(t, [
    [0, 0],
    [0.22, 1],
    [d - 0.45, 1],
    [d, 0],
  ]);
  // the laugh's "ho ho ho": quick bounces that fade near the end
  const ho = Math.sin(t * TAU * 5.2) * on * (t < d - 0.6 ? 1 : clamp01((d - 0.2 - t) / 0.4));
  const lean = keyed(t, [
    [0, 0],
    [0.15, 2.4],
    [0.4, -7],
    [d - 0.5, -6],
    [d - 0.15, 1.4],
    [d, 0],
  ]);
  const bellyBounce = Math.sin(t * TAU * 5.2 - 1) * on;
  return {
    ...base,
    expression: t < 0.12 ? "happy" : "laughing",
    mouth: Math.abs(ho) > 0.35 || t < 0.12 ? "laugh" : "grin",
    y: -Math.max(0, ho) * 0.8,
    sy: 1 - Math.max(0, -ho) * 0.015,
    sx: 1 + Math.max(0, -ho) * 0.01,
    bodyY: Math.abs(ho) * 0.9,
    bodyRot: lean * 0.4 + ho * 0.8,
    belly: { sx: 1 + bellyBounce * 0.03, sy: 1 - bellyBounce * 0.045, y: bellyBounce * 0.9 },
    head: { x: 0, y: -on * 1.6 + Math.abs(ho) * 0.6, rot: lean * 0.35 + ho * 2, scale: 1 },
    // the head thrown back: the face rides up the skull
    lookY: Math.min(0, lean) / 7 * 0.6,
    ears: { l: 6 * on + ho * 5, r: 6 * on - ho * 5, back: 0 },
    hands: {
      // the hands hold the belly, bouncing with it
      l: lerpPoint(OGRE_BODY.handL, [35.2, 66 + bellyBounce * 0.9], on),
      r: lerpPoint(OGRE_BODY.handR, [64.8, 66 + bellyBounce * 0.9], on),
      openL: false,
      openR: false,
      front: null,
    },
    shake: Math.max(0, ho) * 0.2,
    props: on > 0.5 ? [{ kind: "sweat", x: 74, y: 16 - (t % 0.8) * 4, opacity: clamp01(1 - (t % 0.8) / 0.8) * 0.8 }] : [],
  };
}

/** Thinking: one hand scratches the top of the head, the other on the hip, the head tilts, the eyes look up. */
function thinkFrame(t: number): OgreFrame {
  const base = restFrame("stand", "curious");
  const d = OGRE_MOVE_TIMING.think.duration;
  const on = keyed(t, [
    [0, 0],
    [0.45, 1],
    [d - 0.45, 1],
    [d, 0],
  ]);
  const scratch = Math.sin(t * TAU * 4.6) * clamp01((t - 0.45) / 0.15) * clamp01((d - 0.5 - t) / 0.15);
  // the head leans into the scratching hand
  const tilt = 8 * on;
  return {
    ...base,
    expression: "curious",
    mouth: "side",
    bodyRot: -1.6 * on,
    head: { x: -0.6 * on, y: 0, rot: tilt + scratch * 0.8, scale: 1 },
    look: -0.3 * on,
    ears: { l: -4 * on, r: 5 * on + scratch * 3, back: 0 },
    hands: {
      // left fist on the hip, elbow out
      l: lerpPoint(OGRE_BODY.handL, [30.4, 70], on),
      // right hand up on the head, scratching
      r: lerpPoint(OGRE_BODY.handR, [64.4 + scratch * 1.6, 22.4 + Math.abs(scratch) * 0.8], easeOut(on)),
      openL: false,
      openR: on > 0.6,
      front: "r",
    },
    props: on > 0.7 ? [0, 1, 2].map((i) => ({ kind: "think" as const, x: 30 - i * 4.4, y: 14 - i * 4.6, r: 1.2 + i * 0.9, opacity: clamp01((t - 0.7 - i * 0.18) / 0.2) * clamp01((d - 0.35 - t) / 0.2) })) : [],
  };
}

/** Waiting for an approval: arms crossed over the chest, a boot taps, the head tilts now and then, one brow up. */
function crossArmsFrame(t: number): OgreFrame {
  const base = restFrame("stand", "suspicious");
  const loop = OGRE_MOVE_TIMING.crossArms.duration;
  const on = clamp01(t / 0.4);
  const p = (t % loop) / loop;
  const tap = Math.max(0, Math.sin(t * TAU * 2.6)) * (p < 0.55 ? 1 : 0);
  const tilt = keyed(p, [
    [0, 0],
    [0.6, 0],
    [0.7, 6],
    [0.92, 6],
    [1, 0],
  ]);
  return {
    ...base,
    expression: p > 0.62 && p < 0.92 ? "bored" : "suspicious",
    mouth: "flat",
    bodyY: 0.3 * tap,
    head: { x: 0, y: 0, rot: tilt * on, scale: 1 },
    look: 0.2,
    hands: {
      // each fist tucked under the other arm
      l: lerpPoint(OGRE_BODY.handL, [55, 59], easeOut(on)),
      r: lerpPoint(OGRE_BODY.handR, [45.5, 62.4], easeOut(on)),
      openL: false,
      openR: false,
      front: "r",
    },
    feet: { l: OGRE_BODY.footL, r: [OGRE_BODY.footR[0] + tap * 0.6, OGRE_BODY.footR[1] - tap * 2.4] },
    shake: tap > 0.95 ? 0.15 : 0,
  };
}

/** The refusal: a crouch to gather, then the roar, the jaw dropped, the ears flat back, the arms out, the air shaking. */
function roarFrame(t: number): OgreFrame {
  const base = restFrame("stand", "angry");
  const d = OGRE_MOVE_TIMING.roar.duration;
  const gather = keyed(t, [
    [0, 0],
    [0.32, 1],
    [0.42, 0],
  ]);
  const roar = keyed(t, [
    [0.32, 0],
    [0.46, 1],
    [d - 0.5, 1],
    [d - 0.1, 0],
  ]);
  const tremble = Math.sin(t * TAU * 17) * roar;
  return {
    ...base,
    expression: "angry",
    mouth: roar > 0.2 ? "roar" : "grit",
    y: 0,
    sy: 1 - gather * 0.06 + roar * 0.02,
    sx: 1 + gather * 0.04,
    bodyY: gather * 2.4 - roar * 1,
    bodyRot: tremble * 0.6,
    belly: { sx: 1 + roar * 0.02, sy: 1 - gather * 0.03, y: gather * 0.5 },
    head: { x: tremble * 0.3, y: gather * 1.8 - roar * 2.2, rot: tremble * 1.2, scale: 1 + roar * 0.08 },
    ears: { l: -18 * roar - 6 * gather, r: -18 * roar - 6 * gather, back: roar },
    hands: {
      l: lerpPoint(lerpPoint(OGRE_BODY.handL, [30, 72], gather), [11.5, 55], roar),
      r: lerpPoint(lerpPoint(OGRE_BODY.handR, [70, 72], gather), [88.5, 55], roar),
      openL: roar > 0.5,
      openR: roar > 0.5,
      front: null,
    },
    feet: { l: [OGRE_BODY.footL[0] - roar * 2, OGRE_BODY.footL[1]], r: [OGRE_BODY.footR[0] + roar * 2, OGRE_BODY.footR[1]] },
    shake: roar * 0.7 * (0.6 + 0.4 * Math.abs(tremble)),
    props: [0, 1, 2].flatMap((i): OgreProp[] => {
      const since = t - 0.46 - i * 0.22;
      if (since < 0 || t > d - 0.2) return [];
      const k = clamp01(since / 0.7);
      return [{ kind: "shock", r: 26 + k * 22, opacity: (1 - k) * 0.8 }];
    }),
  };
}

/** A success: both arms come up into a double biceps flex, the chest puffs, a proud smirk, the biceps swell, a sparkle. */
function flexFrame(t: number): OgreFrame {
  const base = restFrame("stand", "proud");
  const d = OGRE_MOVE_TIMING.flex.duration;
  const up = keyed(t, [
    [0, 0],
    [0.38, 1],
    [d - 0.38, 1],
    [d, 0],
  ]);
  const pump = up > 0.95 ? Math.sin((t - 0.38) * TAU * 2.2) * 0.5 + 0.5 : 0;
  // the biceps swell once the fists are up
  const bulge = clamp01((up - 0.6) / 0.4) * (0.55 + 0.45 * pump);
  return {
    ...base,
    expression: t > 0.3 && t < d - 0.3 ? "proud" : "happy",
    mouth: "smirk",
    sy: 1 + up * 0.03,
    bodyY: -up * 1.4 + pump * 0.3,
    belly: { sx: 1 - up * 0.02, sy: 1 + up * 0.01, y: -up * 0.6 },
    head: { x: 0, y: -up * 0.8, rot: -3 * up, scale: 1 },
    ears: { l: 8 * up, r: 8 * up, back: 0 },
    hands: {
      l: lerpPoint(OGRE_BODY.handL, [17.6, 37.4 + pump * 0.8], easeOut(up)),
      r: lerpPoint(OGRE_BODY.handR, [82.4, 37.4 + pump * 0.8], easeOut(up)),
      openL: false,
      openR: false,
      front: null,
    },
    bulge,
    props:
      up > 0.9
        ? [
            { kind: "star", x: 9, y: 30, size: 3 + pump * 1.6, rot: t * 90, opacity: 0.9 },
            { kind: "star", x: 91, y: 30, size: 3 + (1 - pump) * 1.6, rot: -t * 90, opacity: 0.9 },
          ]
        : [],
  };
}

/** A nudge: the trumpets wiggle, left and right in turn, quick then settling; a happy blink. */
function earWiggleFrame(t: number): OgreFrame {
  const base = restFrame("stand", "attentive");
  const w = Math.sin(t * TAU * 5.4) * Math.exp(-2.2 * t) * clamp01(t / 0.08);
  return {
    ...base,
    expression: t > 0.55 ? "happy" : "attentive",
    y: -Math.max(0, w) * 0.6,
    head: { x: 0, y: 0, rot: w * 2, scale: 1 },
    ears: { l: w * 16, r: -w * 16, back: 0 },
    hands: { ...base.hands, l: [OGRE_BODY.handL[0] + 1, OGRE_BODY.handL[1] - Math.abs(w) * 2], r: [OGRE_BODY.handR[0] - 1, OGRE_BODY.handR[1] - Math.abs(w) * 2] },
  };
}

/** An achievement: stomps around a small circle, fists up, each stomp shaking the ground, the face laughing. */
function stompFrame(t: number): OgreFrame {
  const d = OGRE_MOVE_TIMING.stomp.duration;
  const around = keyed(t, [
    [0, 0],
    [d - 0.4, 1],
  ]);
  const a = around * TAU;
  // a circle seen from the front: across and back, a little up and down
  const vx = Math.cos(a);
  const facing: 1 | -1 = vx >= 0 ? 1 : -1;
  const stepT = clamp01(t / (d - 0.4)) * (d - 0.4);
  const walk = t < d - 0.4 ? walkFrame(stepT * 1.25, facing) : restFrame("stand", "happy");
  const settle = clamp01((t - (d - 0.4)) / 0.4);
  const raise = keyed(t, [
    [0, 0],
    [0.3, 1],
    [d - 0.4, 1],
    [d, 0],
  ]);
  return {
    ...walk,
    expression: settle > 0 ? "happy" : "laughing",
    mouth: settle > 0 ? null : "laugh",
    x: walk.x + Math.sin(a) * 16 * (1 - settle),
    y: walk.y - (1 - Math.cos(a)) * 2,
    sx: walk.sx * (1 - (1 - Math.cos(a)) * 0.03),
    sy: walk.sy * (1 - (1 - Math.cos(a)) * 0.03),
    look: walk.look * (1 - settle),
    hands: {
      l: lerpPoint(walk.hands.l, [22 + Math.sin(t * TAU * 1.7) * 1.4, 26], raise),
      r: lerpPoint(walk.hands.r, [78 - Math.sin(t * TAU * 1.7) * 1.4, 26], raise),
      openL: false,
      openR: false,
      front: null,
    },
    shake: walk.shake * 1.6,
    props: [
      ...walk.props,
      ...[0, 1, 2, 3].map((i) => {
        const k = (t * 0.6 + i / 4) % 1;
        return { kind: "star" as const, x: 50 + Math.cos(i * 1.7 + t) * 40, y: 30 - k * 20, size: 2.6, rot: t * 120 + i * 40, opacity: Math.sin(k * Math.PI) * raise };
      }),
    ],
  };
}

/** The nap: sitting on a log, the head nodding down slowly, a big breath, the snore bubble swelling on each breath in and popping. */
function sleepFrame(t: number): OgreFrame {
  const base = restFrame("log", "sleepy");
  const loop = OGRE_MOVE_TIMING.sleep.duration;
  const settle = clamp01(t / 0.6);
  const p = (t % loop) / loop;
  // breathe in for the first 55 %, out after; the bubble grows on the way in and pops at the top
  const breath = p < 0.55 ? easeInOut(p / 0.55) : 1 - easeInOut((p - 0.55) / 0.45);
  const pop = p > 0.55 && p < 0.62;
  const bubbleR = p < 0.55 ? 1.2 + 4.6 * easeOut(p / 0.55) : 0;
  const nod = 2.6 + 1.6 * breath;
  const zs = [0, 1].map((i) => {
    const k = (p + i * 0.5) % 1;
    return { kind: "z" as const, x: 70 + k * 12, y: 16 - k * 12, size: 4 + k * 3, opacity: Math.sin(k * Math.PI) * 0.9 * settle };
  });
  const frame: OgreFrame = {
    ...base,
    expression: "sleepy",
    mouth: breath > 0.6 ? "snore" : "small",
    bodyY: -breath * 0.7 * settle,
    belly: { sx: 1 + breath * 0.025, sy: 1 + breath * 0.04, y: -breath * 0.4 },
    head: { x: 0, y: (nod - breath * 0.6) * settle, rot: (4 + breath * 2) * settle, scale: 1 },
    ears: { l: -10 * settle, r: -10 * settle, back: 0.2 * settle },
    hands: { ...base.hands, l: lerpPoint(LOG_FEET.handL, [42.4, 75.4], settle), r: lerpPoint(LOG_FEET.handR, [57.6, 75.4], settle) },
  };
  // the bubble swells from the left nostril and hangs under it
  const [bx, by] = headPoint(frame, [44, 61.4]);
  const burst = (p - 0.55) / 0.07;
  return {
    ...frame,
    props: [
      ...(bubbleR > 0 ? [{ kind: "bubble" as const, x: bx - bubbleR * 0.5, y: by + bubbleR * 0.8, r: bubbleR, opacity: 0.85 * settle }] : []),
      ...(pop ? [0, 1, 2, 3, 4].map((i) => ({ kind: "crumb" as const, x: bx - 3 + Math.cos(i * 1.26) * 6 * burst, y: by + 3 + Math.sin(i * 1.26) * 6 * burst, r: 0.6, opacity: 0.7 * (1 - burst) })) : []),
      ...zs,
    ],
  };
}

/** Waking: up from the log, arms high over the head on the toes, a huge yawn, then a shake out. */
function stretchFrame(t: number): OgreFrame {
  const d = OGRE_MOVE_TIMING.stretch.duration;
  const stand = clamp01(t / 0.35);
  const reach = keyed(t, [
    [0.2, 0],
    [0.8, 1],
    [1.5, 1],
    [1.75, 0],
  ]);
  const shakeOut = t > 1.6 ? Math.sin((t - 1.6) * TAU * 6) * clamp01((d - t) / 0.4) : 0;
  const base = restFrame(t < 0.18 ? "log" : "stand", reach > 0.4 ? "sleepy" : "attentive");
  return {
    ...base,
    mouth: reach > 0.4 ? "roar" : reach > 0.1 ? "o" : null,
    y: -reach * 2.2 + (t < 0.18 ? 0 : (1 - stand) * 3),
    sy: 1 + reach * 0.05,
    sx: 1 - reach * 0.03,
    bodyY: -reach * 1.2,
    bodyRot: shakeOut * 2,
    belly: { sx: 1 - reach * 0.04, sy: 1 + reach * 0.03, y: -reach * 0.8 },
    head: { x: shakeOut * 0.6, y: -reach * 1.4, rot: -6 * reach + shakeOut * 4, scale: 1 },
    ears: { l: 14 * reach + shakeOut * 10, r: 14 * reach - shakeOut * 10, back: 0 },
    hands: {
      l: lerpPoint(base.hands.l, [35, 6.4], easeOut(reach)),
      r: lerpPoint(base.hands.r, [65, 6.4], easeOut(reach)),
      openL: reach > 0.6,
      openR: reach > 0.6,
      front: null,
    },
    feet: { l: base.feet.l, r: base.feet.r },
    props: reach > 0.6 ? [{ kind: "sweat", x: 26, y: 18, opacity: 0 }] : [],
  };
}

/** A message arrives: it flies in, the ogre grabs it, takes three big bites (the cheeks round, crumbs flying), and pats the belly. */
function chompFrame(t: number): OgreFrame {
  const base = restFrame("stand", "excited");
  const d = OGRE_MOVE_TIMING.chomp.duration;
  const grab = keyed(t, [
    [0.25, 0],
    [0.55, 1],
  ]);
  const toMouth = keyed(t, [
    [0.55, 0],
    [0.8, 1],
    [1.75, 1],
    [1.95, 0],
  ]);
  const bites = t > 0.8 && t < 1.75 ? Math.floor((t - 0.8) / 0.32) + 1 : t >= 1.75 ? 3 : 0;
  const biting = t > 0.8 && t < 1.75 && (t - 0.8) % 0.32 < 0.14;
  const pat = t > 1.9 ? Math.sin((t - 1.9) * TAU * 3) : 0;
  // a pat on the belly, then the hand back down
  const patting = keyed(t, [
    [1.8, 0],
    [1.92, 1],
    [2.04, 1],
    [d, 0],
  ]);
  const headAt = { ...base, head: { x: 0, y: biting ? 0.9 : 0, rot: toMouth * 4 + (biting ? -2 : 0), scale: biting ? 1.03 : 1 } };
  const mouthAt = headPoint(headAt, [56, 68]);
  const hand = lerpPoint(lerpPoint(OGRE_BODY.handR, [88, 48], grab), [mouthAt[0] + 4.6, mouthAt[1] + 2], toMouth);
  const letterFly = keyedPoint(t, [
    [0, [104, 20]],
    [0.5, [88, 46]],
  ]);
  const letter: Point = t < 0.55 ? letterFly : [hand[0] - 4.4, hand[1] - 2.6];
  return {
    ...base,
    expression: t < 0.55 ? "excited" : t > 1.85 ? "happy" : "happy",
    mouth: t < 0.8 ? "open" : biting ? "chomp" : t < 1.75 ? "open" : "grin",
    bodyY: biting ? 0.6 : 0,
    belly: { sx: 1 + (t > 1.85 ? 0.03 : 0), sy: 1 + (t > 1.85 ? 0.02 : 0) + pat * 0.015, y: pat * 0.4 },
    head: { x: 0, y: biting ? 0.9 : 0, rot: toMouth * 4 + (biting ? -2 : 0), scale: biting ? 1.03 : 1 },
    look: 0.45 * grab * (1 - toMouth * 0.5),
    ears: { l: biting ? 6 : 2, r: biting ? 6 : 2, back: 0 },
    hands: {
      l: lerpPoint(OGRE_BODY.handL, [44, 70 + pat], patting),
      r: t > 1.75 ? lerpPoint(hand, OGRE_BODY.handR, clamp01((t - 1.75) / 0.3)) : hand,
      openL: false,
      openR: grab > 0.5 && t < 1.75,
      front: "r",
    },
    props: [
      ...(bites < 3 && t < d - 0.4 ? [{ kind: "letter" as const, x: letter[0], y: letter[1], rot: t < 0.55 ? -20 + t * 30 : 8, scale: 1, bite: bites }] : []),
      ...(biting
        ? [0, 1, 2].map((i) => {
            const k = ((t - 0.8) % 0.32) / 0.14;
            return { kind: "crumb" as const, x: 58 + i * 3 + k * 6, y: 70 + i * 1.5 + k * k * 8, r: 0.9, opacity: 1 - k };
          })
        : []),
    ],
  };
}

/** A wave: the right arm up, the open hand swinging from the elbow, the head tilted toward it, a happy face. */
function waveFrame(t: number): OgreFrame {
  const base = restFrame("stand", "happy");
  const d = OGRE_MOVE_TIMING.wave.duration;
  const up = keyed(t, [
    [0, 0],
    [0.3, 1],
    [d - 0.3, 1],
    [d, 0],
  ]);
  const swing = Math.sin((t - 0.3) * TAU * 2.4) * clamp01((t - 0.25) / 0.1) * clamp01((d - 0.3 - t) / 0.1);
  return {
    ...base,
    expression: up > 0.3 ? "happy" : "attentive",
    mouth: "grin",
    bodyRot: 2 * up,
    head: { x: 0, y: 0, rot: 5 * up + swing * 1.2, scale: 1 },
    ears: { l: 4 * up, r: 4 * up + swing * 6, back: 0 },
    hands: { l: OGRE_BODY.handL, r: lerpPoint(OGRE_BODY.handR, [84 + swing * 5, 27 - Math.abs(swing) * 1.2], easeOut(up)), openL: false, openR: up > 0.5, front: null },
  };
}

/** 0 at the ends, 1 in the middle (a hop, a burst). */
const bump = (p: number) => (p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p));
/** Eases in over `a` and out over the last `b` of a span of `d`: a held pose. */
const hold = (u: number, d: number, a = 0.2, b = 0.25) => Math.min(easeInOut(clamp01(u / a)), easeInOut(clamp01((d - u) / b)));

/** Standing at ease: the heavy breath, the weight shifting from one boot to the other, the arms swaying a little. */
function idleFrame(t: number): OgreFrame {
  const d = OGRE_MOVE_TIMING.idle.duration;
  const shift = Math.sin((TAU * t) / (d * 2));
  const base = breathe(restFrame("stand", "neutral"), t, d);
  return {
    ...base,
    x: shift * 0.5,
    bodyRot: shift * 0.8,
    head: { ...base.head, rot: -shift * 0.6 },
    hands: { ...base.hands, l: [OGRE_BODY.handL[0] + shift * 0.4, OGRE_BODY.handL[1] + Math.sin((TAU * t) / d) * 0.3], r: [OGRE_BODY.handR[0] + shift * 0.4, OGRE_BODY.handR[1] + Math.sin((TAU * t) / d) * 0.3] },
    ears: { l: Math.sin((TAU * t) / 5.1) * 2, r: Math.sin((TAU * t) / 4.3 + 1) * 2, back: 0 },
  };
}

/** One slow blink. */
function blinkFrame(t: number): OgreFrame {
  return { ...restFrame("stand", "neutral"), blink: bump(t / OGRE_MOVE_TIMING.blink.duration) };
}

/** A look to one side, then the other, the head and the trumpets following the eyes. */
function lookFrame(t: number): OgreFrame {
  const d = OGRE_MOVE_TIMING.look.duration;
  const k = Math.sin((TAU * t) / d) * hold(t, d, 0.3, 0.3);
  return { ...restFrame("stand", "attentive"), look: k * 0.9, head: { x: k * 1.4, y: 0, rot: k * 3, scale: 1 }, ears: { l: k * 5, r: -k * 5, back: 0 }, bodyRot: k * 0.8 };
}

/** Two heavy nods, the face dipping. */
function nodFrame(t: number): OgreFrame {
  const k = bump((t % 0.55) / 0.55);
  return { ...restFrame("stand", "happy"), head: { x: 0, y: 2.2 * k, rot: 0, scale: 1 }, lookY: 0.5 * k, ears: { l: -3 * k, r: -3 * k, back: 0 } };
}

/** A slow "no": the head swings, the trumpets lagging, a frown. */
function shakeFrame(t: number): OgreFrame {
  const d = OGRE_MOVE_TIMING.shake.duration;
  const k = Math.sin(TAU * 2.6 * t) * (1 - t / d) * clamp01(t / 0.1);
  const lag = Math.sin(TAU * 2.6 * t - 0.9) * (1 - t / d);
  return { ...restFrame("stand", "bored"), mouth: "frown", look: k * 0.7, head: { x: k * 1.4, y: 0, rot: k * 5, scale: 1 }, ears: { l: lag * 9, r: -lag * 9, back: 0 } };
}

/** A heavy hop: a crouch to gather, a short jump, a squashed landing that shakes the ground. */
function bounceFrame(t: number): OgreFrame {
  const crouch = bump(t / 0.24);
  const air = bump((t - 0.2) / 0.46);
  const land = bump((t - 0.64) / 0.26);
  const base = restFrame("stand", air > 0.2 ? "excited" : "attentive");
  return {
    ...base,
    y: -8 * air,
    sy: 1 - 0.08 * crouch - 0.1 * land + 0.05 * air,
    sx: 1 + 0.05 * crouch + 0.07 * land - 0.02 * air,
    bodyY: 1.6 * crouch + 2 * land,
    belly: { sx: 1, sy: 1 - 0.04 * land + 0.03 * air, y: 1.2 * land - 0.6 * air },
    head: { x: 0, y: 1.4 * land - 0.6 * air, rot: 0, scale: 1 },
    ears: { l: 12 * air - 8 * land, r: 12 * air - 8 * land, back: 0 },
    hands: { ...base.hands, l: [OGRE_BODY.handL[0] - 3 * air, OGRE_BODY.handL[1] - 6 * air], r: [OGRE_BODY.handR[0] + 3 * air, OGRE_BODY.handR[1] - 6 * air] },
    feet: { l: [OGRE_BODY.footL[0], OGRE_BODY.footL[1] + 1.5 * air], r: [OGRE_BODY.footR[0], OGRE_BODY.footR[1] + 1.5 * air] },
    shake: land > 0.3 ? land : 0,
    props: land > 0 ? [-1, 1].map((s) => ({ kind: "dust" as const, x: 50 + s * (12 + land * 8), y: 97, r: 2 + land * 1.6, opacity: 0.55 * land })) : [],
  };
}

/** A celebration: two heavy hops, fists pumping in turn, laughing. */
function celebrateFrame(t: number): OgreFrame {
  const d = OGRE_MOVE_TIMING.celebrate.duration;
  const hop = (p: number) => bump(p / 0.62);
  const air = hop(t - 0.15) + hop(t - 1);
  const land = bump((t - 0.72) / 0.22) + bump((t - 1.57) / 0.22);
  const pump = Math.sin(TAU * 2.2 * t);
  const up = hold(t, d, 0.2, 0.3);
  const base = restFrame("stand", "laughing");
  return {
    ...base,
    mouth: "laugh",
    y: -7 * air,
    sy: 1 + 0.04 * air - 0.08 * land,
    sx: 1 - 0.02 * air + 0.06 * land,
    bodyY: 1.6 * land,
    belly: { sx: 1, sy: 1 - 0.04 * land, y: 1 * land },
    ears: { l: 10 * air - 6 * land, r: 10 * air - 6 * land, back: 0 },
    hands: {
      ...base.hands,
      l: lerpPoint(OGRE_BODY.handL, [21, 22 + 6 * Math.max(0, pump)], up),
      r: lerpPoint(OGRE_BODY.handR, [79, 22 + 6 * Math.max(0, -pump)], up),
    },
    shake: land > 0.3 ? land * 0.8 : 0,
    props: [0, 1, 2].map((i) => ({ kind: "star" as const, x: [12, 88, 30][i], y: [22, 22, 4][i] - ((t * 0.8 + i * 0.33) % 1) * 10, size: 2.6, rot: t * 160 + i * 30, opacity: up * bump((t * 0.8 + i * 0.33) % 1) })),
  };
}

/** Startled: a jump back, the eyes wide, the trumpets straight up, the hands up. */
function alertFrame(t: number): OgreFrame {
  const k = bump(t / 0.36);
  const held = hold(t, OGRE_MOVE_TIMING.alert.duration, 0.08, 0.3);
  const base = restFrame("stand", "surprised");
  return {
    ...base,
    y: -3.4 * k,
    sy: 1 + 0.04 * k,
    head: { x: 0, y: -1 * held, rot: 0, scale: 1 },
    ears: { l: 14 * held, r: 14 * held, back: 0 },
    hands: { ...base.hands, openL: held > 0.5, openR: held > 0.5, l: lerpPoint(OGRE_BODY.handL, [24, 52], held), r: lerpPoint(OGRE_BODY.handR, [76, 52], held) },
    props: held > 0.5 ? [{ kind: "sweat", x: 74, y: 16, opacity: held }] : [],
  };
}

/** Talking: the mouth opens and closes, one hand gesturing. */
function talkFrame(t: number): OgreFrame {
  const d = OGRE_MOVE_TIMING.talk.duration;
  const k = 0.5 + 0.5 * Math.sin((TAU * t) / d);
  const g = Math.sin((TAU * t) / (d * 4));
  const base = restFrame("stand", "attentive");
  return { ...base, mouth: "open", mouthOpen: 0.55 + 0.55 * k, head: { x: 0, y: 0.4 * k, rot: g * 1.5, scale: 1 }, hands: { ...base.hands, openR: true, r: [70 + g * 3, 58 - Math.abs(g) * 3] } };
}

/** Listening: a hand cupped behind the right trumpet, the head tilted to it, the trumpet up. */
function listenFrame(t: number): OgreFrame {
  const d = OGRE_MOVE_TIMING.listen.duration;
  const on = clamp01(t / 0.35);
  const sway = Math.sin((TAU * t) / d);
  const base = restFrame("stand", "attentive");
  const frame: OgreFrame = { ...base, head: { x: 0.4 * on, y: 0, rot: (7 + sway) * on, scale: 1 }, look: -0.25 * on, ears: { l: 2 * on, r: 12 * on + sway * 2, back: 0 } };
  const ear = headPoint(frame, [88, 40]);
  return { ...frame, hands: { ...base.hands, openR: on > 0.5, r: lerpPoint(OGRE_BODY.handR, [ear[0] + 1.5, ear[1] + 3], easeOut(on)) } };
}

/** Working: the right fist pounds into the left palm, steady, the head nodding with it. */
function workFrame(t: number): OgreFrame {
  const d = OGRE_MOVE_TIMING.work.duration;
  const p = (t % d) / d;
  const hit = p < 0.35 ? easeInOut(p / 0.35) : 1 - easeInOut((p - 0.35) / 0.65);
  const on = clamp01(t / 0.3);
  const base = restFrame("stand", "attentive");
  return {
    ...base,
    mouth: "side",
    bodyY: 0.5 * hit,
    head: { x: 0, y: 0.8 * hit, rot: 0, scale: 1 },
    hands: { ...base.hands, openL: true, l: lerpPoint(OGRE_BODY.handL, [42, 66], on), r: lerpPoint(OGRE_BODY.handR, [55, 50 + 12 * hit], on), front: "r" },
    shake: p > 0.32 && p < 0.42 ? 0.15 : 0,
  };
}

/** Dangling from the pointer: the arms up, the boots kicking slowly, the trumpets flat. */
function dragFrame(t: number): OgreFrame {
  const d = OGRE_MOVE_TIMING.drag.duration;
  const k = Math.sin((TAU * t) / d);
  const base = restFrame("stand", "scared");
  return {
    ...base,
    rot: 4 * k,
    sy: 1.04,
    ears: { l: -12, r: -12, back: 0.3 },
    hands: { ...base.hands, openL: true, openR: true, l: [26 + k, 30], r: [74 + k, 30] },
    feet: { l: [OGRE_BODY.footL[0] - 1 + k * 2, OGRE_BODY.footL[1] + 1 - Math.max(0, k) * 3], r: [OGRE_BODY.footR[0] + 1 + k * 2, OGRE_BODY.footR[1] + 1 - Math.max(0, -k) * 3] },
  };
}

/**
 * The clips (the desktop's behavior, floating-bots/clips.ts) Ogre plays as
 * one of its moves; a clip it has no move for keeps the idle life.
 */
export const OGRE_CLIP_MOVES: Readonly<Record<string, OgreMove>> = {
  look: "look",
  lookBack: "look",
  headSpin: "shake",
  tilt: "listen",
  spin: "stomp",
  backflip: "stomp",
  hop: "bounce",
  hopForward: "bounce",
  wave: "wave",
  dance: "stomp",
  jump: "bounce",
  stretch: "stretch",
  wingStretch: "flex",
  preen: "earWiggle",
  scratch: "think",
  peck: "chomp",
  bob: "nod",
  ruffle: "earWiggle",
  shy: "earWiggle",
  confused: "think",
  think: "think",
  hoot: "roar",
  doubleBlink: "blink",
  wink: "blink",
  surprised: "alert",
  startled: "alert",
  angry: "roar",
  love: "laugh",
  yawn: "sleep",
  wake: "stretch",
  land: "bounce",
  petted: "earWiggle",
  // a task done: a flex; a task failed or refused: a roar
  celebrate: "flex",
  sad: "roar",
};

/**
 * What Ogre holds on the desktop for the clip playing and the brain's pose
 * (floating-bots/behavior.ts, brain.ts): the heavy walk while the window
 * travels, the nap on the log, dangling while dragged, pounding while the
 * bot works, arms crossed while an approval (or an error) waits on the
 * person, talking while a reply streams, scratching its head while it
 * thinks. Null: the idle life.
 */
export function ogreDesktopAction(activity: string, pose: string): OgreMove | null {
  if (activity === "walk" || activity === "fly" || activity === "flyOut" || activity === "return") return "walk";
  if (activity === "sleep") return "sleep";
  if (activity === "drag") return "drag";
  if (activity === "working") return "work";
  if (pose === "alert") return "crossArms";
  if (pose === "speak") return "talk";
  if (pose === "think") return "think";
  return null;
}

/**
 * The one-shot Ogre plays on the desktop when the clip changes: its own move
 * for the clip. The desktop's cues come as clips too (mascots.tsx
 * cueClipFor): a reply that lands is a peck, so the ogre eats the message.
 */
export function ogreDesktopShot(activity: string, previous: { activity: string }): OgreMove | null {
  if (activity === previous.activity) return null;
  // the clips held as an activity (walk, sleep, drag, work) are not one-shots
  if (ogreDesktopAction(activity, "idle") !== null) return null;
  return ogreMoveFor(activity);
}

/** The moves the avatar popover and the desktop's Moves menu offer for Ogre: clips it plays as its own moves, in that order. */
export const OGRE_MENU_CLIPS = ["wave", "love", "angry", "wingStretch", "dance", "peck", "petted", "think", "stretch", "hop"] as const;

/** The move a clip or a move id plays, or null. */
export function ogreMoveFor(clip: string | null | undefined): OgreMove | null {
  if (!clip) return null;
  if (Object.hasOwn(OGRE_CLIP_MOVES, clip)) return OGRE_CLIP_MOVES[clip];
  return isOgreMove(clip) ? clip : null;
}

/** A move's frame `t` seconds in (a held move cycles); `facing` for the walk and the stomp. */
export function ogreMoveFrame(move: OgreMove, at: number, facing: 1 | -1 = 1): OgreFrame {
  const { duration: d, loop } = OGRE_MOVE_TIMING[move];
  const t = loop ? at : Math.min(Math.max(0, at), d);
  switch (move) {
    case "idle":
      return idleFrame(t);
    case "blink":
      return blinkFrame(t);
    case "look":
      return lookFrame(t);
    case "nod":
      return nodFrame(t);
    case "shake":
      return shakeFrame(t);
    case "bounce":
      return bounceFrame(t);
    case "wave":
      return waveFrame(t);
    case "think":
      return thinkFrame(t);
    case "celebrate":
      return celebrateFrame(t);
    case "sleep":
      return sleepFrame(t);
    case "alert":
      return alertFrame(t);
    case "talk":
      return talkFrame(t);
    case "listen":
      return listenFrame(t);
    case "work":
      return workFrame(t);
    case "walk":
      return walkFrame(t, facing);
    case "laugh":
      return laughFrame(t);
    case "crossArms":
      return crossArmsFrame(t);
    case "roar":
      return roarFrame(t);
    case "flex":
      return flexFrame(t);
    case "earWiggle":
      return earWiggleFrame(t);
    case "stomp":
      return stompFrame(t);
    case "stretch":
      return stretchFrame(t);
    case "chomp":
      return chompFrame(t);
    case "drag":
      return dragFrame(t);
  }
}

/** How long a move shows, s (a held move: one cycle). */
export const ogreMoveLength = (move: OgreMove) => OGRE_MOVE_TIMING[move].duration;

/* ------------------------------------------------------------- blending */

/** A move's face and stance, still: what reduced motion shows while it plays (null shows nothing). */
export function reducedFace(move: OgreMove): Pick<OgreFrame, "stance" | "expression" | "mouth"> | null {
  const timing = OGRE_MOVE_TIMING[move];
  if (timing.reduced === "none") return null;
  // the middle of a one-shot, the start of a held move (past its settle)
  const frame = ogreMoveFrame(move, timing.loop ? 0.6 : timing.duration / 2);
  return { stance: frame.stance, expression: frame.expression, mouth: frame.mouth };
}

const NUMERIC = ["x", "y", "rot", "sx", "sy", "bodyY", "bodyRot", "look", "lookY", "bulge", "blink", "mouthOpen", "shake"] as const;

/** A frame with another laid over it at weight `w` (0..1): numbers and points blend; the stance, the face, the hands' state and the props switch at half way. */
export function blendFrame(base: OgreFrame, over: OgreFrame, w: number): OgreFrame {
  if (w <= 0) return base;
  if (w >= 1) return over;
  const out: OgreFrame = { ...base };
  for (const key of NUMERIC) out[key] = lerp(base[key], over[key], w);
  out.belly = { sx: lerp(base.belly.sx, over.belly.sx, w), sy: lerp(base.belly.sy, over.belly.sy, w), y: lerp(base.belly.y, over.belly.y, w) };
  out.head = { x: lerp(base.head.x, over.head.x, w), y: lerp(base.head.y, over.head.y, w), rot: lerp(base.head.rot, over.head.rot, w), scale: lerp(base.head.scale, over.head.scale, w) };
  out.ears = { l: lerp(base.ears.l, over.ears.l, w), r: lerp(base.ears.r, over.ears.r, w), back: lerp(base.ears.back, over.ears.back, w) };
  // limbs blend only within one stance (a log and a standing body place them differently)
  const same = base.stance === over.stance;
  const top = w >= 0.5 ? over : base;
  out.hands = same ? { l: lerpPoint(base.hands.l, over.hands.l, w), r: lerpPoint(base.hands.r, over.hands.r, w), openL: top.hands.openL, openR: top.hands.openR, front: top.hands.front } : top.hands;
  out.feet = same ? { l: lerpPoint(base.feet.l, over.feet.l, w), r: lerpPoint(base.feet.r, over.feet.r, w) } : top.feet;
  out.stance = top.stance;
  out.expression = top.expression;
  out.mouth = top.mouth;
  out.facing = top.facing;
  out.props = w >= 0.3 ? over.props : base.props;
  return out;
}

/** How far a one-shot shows `u` s in: in over 0.15 s, out over 0.22 s after its end. */
export function ogreMoveWeight(move: OgreMove, u: number): number {
  const { duration } = OGRE_MOVE_TIMING[move];
  if (u < 0 || u > duration + 0.22) return 0;
  return Math.min(easeInOut(clamp01(u / 0.15)), u > duration ? 1 - easeInOut(clamp01((u - duration) / 0.22)) : 1);
}

/**
 * One live Ogre: the idle life (standing at ease, seeded blinks), a held
 * activity and a one-shot move, all on one clock (seconds). `frame(now)` is
 * the frame to draw. A change of stance (onto the log, back up) lands with a
 * squash.
 */
export class OgreRig {
  private readonly start: number;
  private readonly seed: number;
  private blinks: number[] = [];
  private blinkHorizon = 0;
  private held: { move: OgreMove; since: number } | null = null;
  private letGo: { move: OgreMove; since: number; at: number } | null = null;
  private shot: { move: OgreMove; at: number } | null = null;
  private stance: OgreStance = "stand";
  private stanceAt = -Infinity;
  /** Which way a walk faces (the desktop sets it from the travel). */
  facing: 1 | -1 = 1;

  constructor(now: number, seed = Math.random() * 1000) {
    this.start = now;
    this.seed = seed;
  }

  /** The activity held until it changes (walk, sleep, talk, crossArms...), or none. */
  hold(move: OgreMove | null, now: number): void {
    if ((this.held?.move ?? null) === move) return;
    this.letGo = this.held ? { ...this.held, at: now } : null;
    this.held = move ? { move, since: now } : null;
  }

  /** A one-shot move, from its start. */
  play(move: OgreMove, now: number): void {
    this.shot = { move, at: now };
  }

  /** Whether a one-shot is still showing at `now`. */
  playing(now: number): boolean {
    return this.shot !== null && now - this.shot.at <= OGRE_MOVE_TIMING[this.shot.move].duration + 0.22;
  }

  /** Whether anything but the idle life is under way. */
  busy(now: number): boolean {
    return this.held !== null || this.playing(now) || (this.letGo !== null && now - this.letGo.at < 0.3);
  }

  frame(now: number): OgreFrame {
    const t = now - this.start;
    if (t + 6 > this.blinkHorizon) {
      this.blinkHorizon = t + 30;
      this.blinks = blinkTimes(this.seed, this.blinkHorizon);
    }
    let frame = idleFrame(t);
    frame = { ...frame, blink: blinkAt(t, this.blinks) };
    if (this.letGo) {
      const out = 1 - easeInOut(clamp01((now - this.letGo.at) / 0.3));
      if (out <= 0) this.letGo = null;
      else frame = blendFrame(frame, ogreMoveFrame(this.letGo.move, now - this.letGo.since, this.facing), out);
    }
    if (this.held) frame = blendFrame(frame, ogreMoveFrame(this.held.move, now - this.held.since, this.facing), easeInOut(clamp01((now - this.held.since) / 0.3)));
    if (this.shot) {
      const u = now - this.shot.at;
      const w = ogreMoveWeight(this.shot.move, u);
      if (w <= 0 && u > 0) this.shot = null;
      else frame = blendFrame(frame, ogreMoveFrame(this.shot.move, u, this.facing), w);
    }
    if (frame.stance !== this.stance) {
      this.stance = frame.stance;
      this.stanceAt = now;
    }
    const landing = bump((now - this.stanceAt) / 0.24);
    if (landing > 0) frame = { ...frame, sy: frame.sy * (1 - 0.08 * landing), sx: frame.sx * (1 + 0.05 * landing) };
    return frame;
  }
}

/** The blink starts up to `until` s, seeded (an ogre blinks slowly, every 2.4 to 6 s, sometimes twice). */
export function blinkTimes(seed: number, until: number): number[] {
  let s = (Math.floor(seed * 2654435761) ^ 0x9e3779b9) >>> 0 || 1;
  const random = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const times: number[] = [];
  let t = 1.6;
  while (t <= until) {
    times.push(t);
    if (random() < 0.16) times.push(t + 0.3);
    t += 2.4 + random() * 3.6;
  }
  return times;
}

/** How shut the eyes are at `t` given the blink starts (a blink lasts 0.2 s). */
export function blinkAt(t: number, starts: readonly number[]): number {
  let shut = 0;
  for (const start of starts) {
    if (start > t) break;
    shut = Math.max(shut, bump((t - start) / 0.2));
  }
  return shut;
}
