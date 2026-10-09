// Shiba's moves (ShibaMascot.tsx, the desktop mascot): pure functions of the
// time since a move started, like the Shapes moves (shape-moves.ts), so the
// tests, the keyframe renders and the live drawing share them. A move gives
// a partial pose of the rig (the whole body, the head, each ear, the tail,
// each leg, each front paw, the eyelids, the brows, the mouth) and may name
// the stance (sitting, standing, lying), the face and the mouth it wears.
//
// ShibaRig composes them at any moment: the idle life underneath (a breath,
// seeded blinks, a lazy tail), one held activity (walking, sleeping, talking,
// listening, working, dangling) blended in and out, and one one-shot move on
// top (a bark, a spin, a stretch...), each blended so nothing pops; a change
// of stance lands with a small squash. Under reduced motion the rig never
// runs: a move only shows its face (`reducedFace`).
//
// Units: box units of the 0..100 drawing (shiba-art.ts), y down; angles in
// degrees. An ear's angle is outward (+ droops it to the side, - perks it
// up); a leg's is forward (+ reaches toward the way it faces); a paw's `y`
// lifts it (- up).
import { clamp01, easeInOut, lerp } from "./shape-art";
import { blinkOpen, blinkSchedule } from "./shape-engine";
import { SHIBA_HIPS, SHIBA_LEGS, SHIBA_PIVOTS, type MouthKind, type ShibaExpression, type ShibaLeg, type ShibaStance } from "./shiba-art";

export interface LegPose {
  angle: number;
  lift: number;
}

export interface ShibaPose {
  /** The whole drawing: offset, lean (about the ground), squash and stretch, and its facing (1, -1, in between mid-turn). */
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
  turn: number;
  headX: number;
  headY: number;
  headRot: number;
  earL: number;
  earR: number;
  tail: number;
  legs: Record<ShibaLeg, LegPose>;
  pawL: { y: number; rot: number };
  pawR: { y: number; rot: number };
  /** Eyelids: 0 open, 1 shut. */
  blink: number;
  /** The brow spots' rise (- up). */
  brow: number;
  /** The mouth's height (1 rest; talking opens and closes it). */
  mouthOpen: number;
  stance: ShibaStance;
  /** A face of its own over the mood's, and a mouth over the face's. */
  expression: ShibaExpression | null;
  mouth: MouthKind | null;
}

/** What a move sets: any part of the pose. */
export type ShibaPosePart = Partial<Omit<ShibaPose, "legs" | "pawL" | "pawR">> & {
  legs?: Partial<Record<ShibaLeg, LegPose>>;
  pawL?: { y: number; rot: number };
  pawR?: { y: number; rot: number };
};

const still = (): Record<ShibaLeg, LegPose> => Object.fromEntries(SHIBA_LEGS.map((leg) => [leg, { angle: 0, lift: 0 }])) as Record<ShibaLeg, LegPose>;

export function restPose(): ShibaPose {
  return {
    x: 0,
    y: 0,
    rot: 0,
    sx: 1,
    sy: 1,
    turn: 1,
    headX: 0,
    headY: 0,
    headRot: 0,
    earL: 0,
    earR: 0,
    tail: 0,
    legs: still(),
    pawL: { y: 0, rot: 0 },
    pawR: { y: 0, rot: 0 },
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
 * plays, ported to a dog, then the dog's own.
 */
export const SHIBA_MOVES = [
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
  "run",
  "sniff",
  "turnCircles",
  "bark",
  "sit",
  "lieDown",
  "wag",
  "earTwitch",
  "stretch",
  "headTilt",
  "excited",
  "sad",
  "shakeOff",
  "drag",
] as const;
export type ShibaMove = (typeof SHIBA_MOVES)[number];
export const isShibaMove = (value: unknown): value is ShibaMove => typeof value === "string" && (SHIBA_MOVES as readonly string[]).includes(value);

export interface ShibaMoveTiming {
  /** s: one cycle of a held move, the whole of a one-shot. */
  duration: number;
  /** Held (an activity that lasts until it changes) or a one-shot. */
  loop: boolean;
  /** Under reduced motion: show the move's face and stance, still, or nothing at all. */
  reduced: "face" | "none";
}

export const SHIBA_MOVE_TIMING: Readonly<Record<ShibaMove, ShibaMoveTiming>> = {
  idle: { duration: 3.4, loop: true, reduced: "none" },
  blink: { duration: 0.18, loop: false, reduced: "none" },
  look: { duration: 1.8, loop: false, reduced: "none" },
  nod: { duration: 1, loop: false, reduced: "none" },
  shake: { duration: 1, loop: false, reduced: "none" },
  bounce: { duration: 0.8, loop: false, reduced: "none" },
  wave: { duration: 1.6, loop: false, reduced: "face" },
  think: { duration: 2.4, loop: false, reduced: "face" },
  celebrate: { duration: 2, loop: false, reduced: "face" },
  sleep: { duration: 4, loop: true, reduced: "face" },
  alert: { duration: 0.9, loop: false, reduced: "face" },
  talk: { duration: 0.42, loop: true, reduced: "face" },
  listen: { duration: 2.4, loop: true, reduced: "face" },
  work: { duration: 0.9, loop: true, reduced: "face" },
  // the walk cycle: eight keyframes of 80 ms, the diagonal legs together
  walk: { duration: 0.64, loop: true, reduced: "none" },
  run: { duration: 0.4, loop: true, reduced: "none" },
  sniff: { duration: 1.2, loop: false, reduced: "face" },
  turnCircles: { duration: 2.6, loop: false, reduced: "face" },
  bark: { duration: 1.2, loop: false, reduced: "face" },
  sit: { duration: 0.6, loop: false, reduced: "none" },
  lieDown: { duration: 3.2, loop: false, reduced: "face" },
  wag: { duration: 1.6, loop: false, reduced: "face" },
  earTwitch: { duration: 0.5, loop: false, reduced: "none" },
  stretch: { duration: 1.8, loop: false, reduced: "face" },
  headTilt: { duration: 1.5, loop: false, reduced: "face" },
  excited: { duration: 1.4, loop: false, reduced: "face" },
  sad: { duration: 2.6, loop: false, reduced: "face" },
  shakeOff: { duration: 1.1, loop: false, reduced: "none" },
  drag: { duration: 1.2, loop: true, reduced: "face" },
};

/** When each bark of the bark move starts, s (the sound hook rings then). */
export const SHIBA_BARKS = [0.08, 0.46, 0.84] as const;
const BARK_LENGTH = 0.24;
/** The spins of the turn in circles, and when it sits after them, s. */
export const SHIBA_SPINS = { count: 2, each: 1, sitAt: 2 } as const;

const TAU = Math.PI * 2;
/** 0 at the ends, 1 in the middle (a hop, a burst). */
const bump = (p: number) => (p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p));
/** Eases in over `a` and out over the last `b` of a span of `d`: a held pose. */
const hold = (u: number, d: number, a = 0.2, b = 0.25) => Math.min(easeInOut(clamp01(u / a)), easeInOut(clamp01((d - u) / b)));

/** The walk cycle at phase `phi` (radians): legs in diagonal pairs, the body bobbing twice a cycle, ears and tail trailing behind. */
function gait(phi: number, reach: number, bob: number): ShibaPosePart {
  const leg = (offset: number): LegPose => ({ angle: reach * Math.sin(phi + offset), lift: Math.max(0, Math.cos(phi + offset)) });
  return {
    stance: "stand",
    legs: { frontNear: leg(0), backFar: leg(0), frontFar: leg(Math.PI), backNear: leg(Math.PI) },
    // highest when the legs pass under the body
    y: -bob * (0.5 + 0.5 * Math.cos(2 * phi)),
    sy: 1 + 0.015 * Math.cos(2 * phi),
    headY: 0.7 * Math.sin(2 * phi - 0.9),
    headRot: 1.5 * Math.sin(phi),
    earL: -2 + 5 * Math.sin(2 * phi - 1.4),
    earR: -2 + 5 * Math.sin(2 * phi - 1.6),
    tail: 16 * Math.sin(2 * phi + 0.6),
    mouth: "pant",
  };
}

/** A move's pose `u` seconds in (a held move cycles). */
export function shibaMoveAt(move: ShibaMove, at: number): ShibaPosePart {
  const { duration: d, loop } = SHIBA_MOVE_TIMING[move];
  const u = loop ? ((at % d) + d) % d : Math.min(Math.max(0, at), d);
  switch (move) {
    case "idle":
      return { tail: 5 * Math.sin((TAU * u) / d) };
    case "blink":
      return { blink: bump(u / d) };
    case "look": {
      const k = Math.sin((TAU * u) / d) * hold(u, d, 0.3, 0.3);
      return { headX: 2.4 * k, headRot: -3 * k, earL: -3 * k, earR: 3 * k };
    }
    case "nod":
      return { headY: 2.4 * bump((u % 0.5) / 0.5), headRot: 1.5 * bump((u % 0.5) / 0.5) };
    case "shake": {
      const k = Math.sin(TAU * 3 * u) * (1 - u / d);
      return { headRot: 7 * k, headX: 1.4 * k, earL: 6 * k, earR: -6 * k };
    }
    case "bounce": {
      const air = bump((u - 0.12) / 0.56);
      return { y: -9 * air, sy: 1 - 0.08 * bump(u / 0.14) - 0.06 * bump((u - 0.66) / 0.14) + 0.04 * air, earL: 12 * air, earR: 12 * air, tail: -10 * air };
    }
    case "wave": {
      const up = hold(u, d, 0.25, 0.3);
      return { pawR: { y: -11 * up, rot: -18 * up + 16 * Math.sin(TAU * 2.5 * u) * up }, headRot: -4 * up, tail: 14 * Math.sin(TAU * 2 * u), expression: "happy" };
    }
    case "think": {
      const k = hold(u, d, 0.35, 0.4);
      return { headRot: 9 * k, earL: -6 * k, earR: 2 * k, brow: -1 * k, tail: 4 * Math.sin(TAU * 0.6 * u), expression: "curious" };
    }
    case "celebrate": {
      const hop = (p: number) => bump(p / 0.5);
      const air = hop(u - 0.1) + hop(u - 0.75);
      return { y: -8 * air, sy: 1 + 0.04 * air, earL: 10 * air, earR: 10 * air, tail: 24 * Math.sin(TAU * 3.2 * u), expression: "excited", mouth: "open" };
    }
    case "sleep":
      return { stance: "lie", expression: "sleepy", sy: 1 + 0.02 * Math.sin((TAU * u) / d), headY: 0.6 * Math.sin((TAU * u) / d - 0.6), earL: 10, earR: 10, tail: 0 };
    case "alert": {
      const k = bump(u / 0.34);
      return { expression: "surprised", earL: -14, earR: -14, y: -2.5 * k, brow: -1.2, sy: 1 + 0.03 * k };
    }
    case "talk":
      return { mouth: "open", mouthOpen: 0.7 + 0.4 * (0.5 + 0.5 * Math.sin((TAU * u) / d)), headY: 0.4 * Math.sin((TAU * u) / d) };
    case "listen":
      return { headRot: 10 + Math.sin((TAU * u) / d), earL: -8, earR: -8, tail: 6 * Math.sin((TAU * u) / d), expression: "attentive" };
    case "work":
      return { headY: 0.8 * bump((u % 0.45) / 0.45), tail: 3 * Math.sin((TAU * u) / d), expression: "attentive" };
    case "walk":
      return gait((TAU * u) / d, 26, 1.1);
    case "run":
      return { ...gait((TAU * u) / d, 34, 1.8), earL: 8, earR: 8 };
    case "sniff": {
      const down = hold(u, d, 0.25, 0.3);
      return {
        stance: "stand",
        headX: 4 * down,
        headY: (11 + 0.6 * Math.sin(TAU * 7 * u)) * down,
        headRot: 4 * down,
        earL: -6 * down,
        earR: -6 * down,
        tail: 10 * Math.sin(TAU * 1.5 * u),
        legs: { frontNear: { angle: 8 * down, lift: 0 }, frontFar: { angle: 8 * down, lift: 0 }, backNear: { angle: 0, lift: 0 }, backFar: { angle: 0, lift: 0 } },
        expression: "curious",
      };
    }
    case "turnCircles": {
      const { each, sitAt } = SHIBA_SPINS;
      if (u < sitAt) {
        const s = u / each;
        const legs = gait((TAU * u) / 0.32, 30, 1.2);
        // a flat dog turning: its width passes through its edge, it walks a small circle, smaller while it is away
        const away = 0.5 - 0.5 * Math.cos(TAU * s);
        const c = Math.cos(TAU * s);
        // never edge-on for long: past a third of its width it flips, like a cartoon turning
        return { ...legs, turn: Math.sign(c || 1) * (0.3 + 0.7 * Math.abs(c)), x: 7 * Math.sin(TAU * s), sx: 1 - 0.05 * away, sy: 1 - 0.05 * away, tail: 20 * Math.sin(TAU * 4 * u), expression: "excited" };
      }
      const p = (u - sitAt) / (d - sitAt);
      return { stance: "sit", y: -3 * bump(p / 0.5), sy: 1 - 0.07 * bump((p - 0.4) / 0.4), tail: 14 * Math.sin(TAU * 3 * u), expression: "happy" };
    }
    case "bark": {
      let open = 0;
      for (const start of SHIBA_BARKS) open = Math.max(open, bump((u - start) / BARK_LENGTH));
      const barking = SHIBA_BARKS.some((start) => u >= start && u <= start + BARK_LENGTH);
      return {
        headY: -1.6 * open,
        headRot: -3 * open,
        y: -1.8 * open,
        sy: 1 + 0.04 * open,
        earL: -12,
        earR: -12,
        tail: 12 * Math.sin(TAU * 3 * u),
        expression: "attentive",
        mouth: barking ? "bark" : null,
      };
    }
    case "sit":
      return { stance: u < 0.25 ? "stand" : "sit", sy: 1 - 0.08 * bump((u - 0.15) / 0.3) };
    case "lieDown": {
      if (u < 0.35) return { stance: "sit", sy: 1 - 0.1 * (u / 0.35), headY: 2 * (u / 0.35) };
      if (u > d - 0.35) return { stance: "sit", y: -2 * bump((u - (d - 0.35)) / 0.35) };
      return { stance: "lie", expression: "sleepy", sy: 1 + 0.015 * Math.sin(TAU * 0.4 * u), tail: 6 * Math.sin(TAU * 0.8 * u), earL: 8, earR: 8 };
    }
    case "wag": {
      const k = hold(u, d, 0.15, 0.25);
      const w = Math.sin(TAU * 3.2 * u);
      return { tail: 24 * w * k, x: -0.8 * w * k, rot: 1.2 * w * k, earL: 6 * k, earR: 6 * k, expression: "happy" };
    }
    case "earTwitch":
      return { earR: 16 * Math.sin((TAU * u) / 0.25) * (1 - u / d) };
    case "stretch": {
      // a play bow and a yawn, then a little shake
      const bow = hold(u, 0.9, 0.3, 0.3);
      const shake = u > 0.9 ? Math.sin(TAU * 6 * u) * (1 - (u - 0.9) / 0.9) : 0;
      const yawning = u > 0.2 && u < 0.8;
      return {
        stance: "stand",
        rot: 9 * bow,
        headY: 5 * bow,
        headX: 2 * bow,
        x: 1.2 * shake,
        legs: { frontNear: { angle: 28 * bow, lift: 0 }, frontFar: { angle: 28 * bow, lift: 0 }, backNear: { angle: -6 * bow, lift: 0 }, backFar: { angle: -6 * bow, lift: 0 } },
        tail: -18 * bow + 10 * Math.sin(TAU * 2 * u),
        earL: 8 * shake,
        earR: -8 * shake,
        expression: "happy",
        mouth: yawning ? "o" : null,
      };
    }
    case "headTilt": {
      const k = hold(u, d, 0.25, 0.3);
      return { headRot: 14 * k, earL: -4 * k, earR: 8 * k, expression: "curious" };
    }
    case "excited": {
      const period = d / 3;
      const air = bump((u % period) / period);
      return { y: -6 * air, sy: 1 + 0.05 * air - 0.05 * bump(((u + period * 0.1) % period) / (period * 0.2)), tail: 26 * Math.sin(TAU * 4 * u), earL: 10, earR: 10, expression: "excited", mouth: "pant" };
    }
    case "sad": {
      const k = hold(u, d, 0.5, 0.5);
      return { earL: 30 * k, earR: 30 * k, headY: 3 * k, headRot: -5 * k, tail: 30 * k, sy: 1 - 0.03 * k, expression: "sad" };
    }
    case "shakeOff": {
      const k = (1 - u / d) * Math.min(1, u / 0.1);
      const w = TAU * 7 * u;
      return { x: 2 * Math.sin(w) * k, rot: 5 * Math.sin(w + 0.5) * k, earL: 18 * Math.sin(w + 1.2) * k, earR: -18 * Math.sin(w + 1.2) * k, tail: 20 * Math.sin(w + 2) * k, expression: "happy", mouth: "w" };
    }
    case "drag": {
      const k = Math.sin((TAU * u) / d);
      return { rot: 4 * k, sy: 1.05, earL: -10, earR: -10, tail: 20, expression: "surprised", pawL: { y: 2, rot: 6 * k }, pawR: { y: 2, rot: -6 * k } };
    }
  }
}

/** A move's face and stance, still: what reduced motion shows while it plays (null shows nothing). */
export function reducedFace(move: ShibaMove): Pick<ShibaPose, "stance" | "expression" | "mouth"> | null {
  const timing = SHIBA_MOVE_TIMING[move];
  if (timing.reduced === "none") return null;
  // the middle of a one-shot, the start of a held move; the bark shows its open mouth
  const pose = shibaMoveAt(move, move === "bark" ? SHIBA_BARKS[0] + BARK_LENGTH / 2 : timing.loop ? 0 : timing.duration / 2);
  return { stance: pose.stance ?? "sit", expression: pose.expression ?? null, mouth: pose.mouth ?? null };
}

/* ------------------------------------------------------------- blending */

const NUMERIC = ["x", "y", "rot", "sx", "sy", "turn", "headX", "headY", "headRot", "earL", "earR", "tail", "blink", "brow", "mouthOpen"] as const;

/** A pose with a move's part laid over it at weight `w` (0..1); the stance, face and mouth switch at half way. */
export function blendPose(base: ShibaPose, part: ShibaPosePart, w: number): ShibaPose {
  if (w <= 0) return base;
  const out: ShibaPose = { ...base, legs: { ...base.legs }, pawL: { ...base.pawL }, pawR: { ...base.pawR } };
  for (const key of NUMERIC) {
    const value = part[key];
    if (typeof value === "number") out[key] = lerp(base[key], value, w);
  }
  if (part.legs) for (const leg of SHIBA_LEGS) {
    const target = part.legs[leg];
    if (target) out.legs[leg] = { angle: lerp(base.legs[leg].angle, target.angle, w), lift: lerp(base.legs[leg].lift, target.lift, w) };
  }
  for (const paw of ["pawL", "pawR"] as const) {
    const target = part[paw];
    if (target) out[paw] = { y: lerp(base[paw].y, target.y, w), rot: lerp(base[paw].rot, target.rot, w) };
  }
  if (w >= 0.5) {
    if (part.stance) out.stance = part.stance;
    if (part.expression !== undefined && part.expression !== null) out.expression = part.expression;
    if (part.mouth !== undefined) out.mouth = part.mouth;
  }
  return out;
}

/** How far a one-shot shows `u` s in: in over 0.12 s, out over 0.18 s after its end. */
export function shibaMoveWeight(move: ShibaMove, u: number): number {
  const { duration } = SHIBA_MOVE_TIMING[move];
  if (u < 0 || u > duration + 0.18) return 0;
  return Math.min(easeInOut(clamp01(u / 0.12)), u > duration ? 1 - easeInOut(clamp01((u - duration) / 0.18)) : 1);
}

/** The idle life under everything at `t` s: a breath, the seeded blinks, a lazy tail. */
export function idlePose(t: number, blinks: readonly number[]): ShibaPose {
  const pose = restPose();
  const breath = Math.sin((TAU * t) / 3.4);
  pose.sx = 1 + 0.008 * breath;
  pose.sy = 1 - 0.008 * breath;
  pose.headY = 0.35 * Math.sin((TAU * t) / 3.4 - 0.5);
  pose.tail = 5 * Math.sin((TAU * t) / 2.8);
  pose.blink = 1 - blinkOpen(t, blinks);
  return pose;
}

/**
 * One live Shiba: the idle life, a held activity and a one-shot move, all on
 * one clock (seconds). `pose(now)` is the frame to draw.
 */
export class ShibaRig {
  private readonly start: number;
  private readonly seed: number;
  private blinks: number[] = [];
  private blinkHorizon = 0;
  private held: { move: ShibaMove; since: number } | null = null;
  private letGo: { move: ShibaMove; since: number; at: number } | null = null;
  private shot: { move: ShibaMove; at: number } | null = null;
  private stance: ShibaStance = "sit";
  private stanceAt = -Infinity;

  constructor(now: number, seed = Math.random() * 1000) {
    this.start = now;
    this.seed = seed;
  }

  /** The activity held until it changes (walk, sleep, talk...), or none. */
  hold(move: ShibaMove | null, now: number): void {
    if ((this.held?.move ?? null) === move) return;
    this.letGo = this.held ? { ...this.held, at: now } : null;
    this.held = move ? { move, since: now } : null;
  }

  /** A one-shot move, from its start. */
  play(move: ShibaMove, now: number): void {
    this.shot = { move, at: now };
  }

  /** Whether a one-shot is still showing at `now`. */
  playing(now: number): boolean {
    return this.shot !== null && now - this.shot.at <= SHIBA_MOVE_TIMING[this.shot.move].duration + 0.18;
  }

  /** Whether anything but the idle life is under way (the drawing may rest its loop otherwise). */
  busy(now: number): boolean {
    return this.held !== null || this.playing(now) || (this.letGo !== null && now - this.letGo.at < 0.25);
  }

  pose(now: number): ShibaPose {
    const t = now - this.start;
    if (t + 6 > this.blinkHorizon) {
      this.blinkHorizon = t + 30;
      this.blinks = blinkSchedule(this.seed, this.blinkHorizon);
    }
    let pose = idlePose(t, this.blinks);
    if (this.letGo) {
      const out = 1 - easeInOut(clamp01((now - this.letGo.at) / 0.25));
      if (out <= 0) this.letGo = null;
      else pose = blendPose(pose, shibaMoveAt(this.letGo.move, now - this.letGo.since), out);
    }
    if (this.held) pose = blendPose(pose, shibaMoveAt(this.held.move, now - this.held.since), easeInOut(clamp01((now - this.held.since) / 0.25)));
    if (this.shot) {
      const u = now - this.shot.at;
      const w = shibaMoveWeight(this.shot.move, u);
      if (w <= 0 && u > 0) this.shot = null;
      else pose = blendPose(pose, shibaMoveAt(this.shot.move, u), w);
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
export const turnAbout = (angle: number, [x, y]: readonly [number, number], dx = 0, dy = 0) => `translate(${f(dx)} ${f(dy)}) rotate(${f(angle)} ${x} ${y})`;

/** The whole drawing's transform: move, lean about the ground, then squash and the facing about it. */
export function wholeTransform(pose: ShibaPose, ground: readonly [number, number]): string {
  const [gx, gy] = ground;
  // a flat turn never reaches zero width: it passes its edge as a sliver
  const turn = Math.sign(pose.turn || 1) * Math.max(0.06, Math.abs(pose.turn));
  return `translate(${f(pose.x)} ${f(pose.y)}) translate(${gx} ${gy}) rotate(${f(pose.rot)}) scale(${f(turn * pose.sx)} ${f(pose.sy)}) translate(${-gx} ${-gy})`;
}

/** A part scaled about a point (the eyes' blink, the mouth's talk). */
export const scaleAbout = (sx: number, sy: number, [x, y]: readonly [number, number]) => `translate(${x} ${y}) scale(${f(sx)} ${f(sy)}) translate(${-x} ${-y})`;

/** Every moving group's transform for a pose (the live loop writes them; a still render passes them). */
export type ShibaTransforms = Record<"whole" | "tail" | "head" | "earL" | "earR" | "brows" | "eyeL" | "eyeR" | "mouth" | "pawL" | "pawR" | ShibaLeg, string>;

export function shibaTransforms(pose: ShibaPose): ShibaTransforms {
  const P = SHIBA_PIVOTS;
  const tailPivot = pose.stance === "stand" ? P.standTail : pose.stance === "lie" ? P.lieTail : P.tail;
  const eye = 1 - 0.9 * clamp01(pose.blink);
  const legs = Object.fromEntries(
    SHIBA_LEGS.map((leg) => {
      const { angle, lift } = pose.legs[leg];
      // the drawing's rotation is clockwise: a forward reach turns the leg the other way
      return [leg, turnAbout(-angle, SHIBA_HIPS[leg], 0, -lift * 2.2)];
    }),
  ) as Record<ShibaLeg, string>;
  return {
    whole: wholeTransform(pose, P.ground),
    tail: turnAbout(pose.tail, tailPivot),
    head: turnAbout(pose.headRot, P.neck, pose.headX, pose.headY),
    earL: turnAbout(-pose.earL, P.earL),
    earR: turnAbout(pose.earR, P.earR),
    brows: `translate(0 ${f(pose.brow)})`,
    eyeL: scaleAbout(1, eye, P.eyeL),
    eyeR: scaleAbout(1, eye, P.eyeR),
    mouth: scaleAbout(1, pose.mouthOpen, P.mouth),
    pawL: turnAbout(pose.pawL.rot, P.pawL, 0, pose.pawL.y),
    pawR: turnAbout(pose.pawR.rot, P.pawR, 0, pose.pawR.y),
    ...legs,
  };
}

/** The moves a desktop clip (floating-bots/clips.ts) plays on Shiba; a clip it has no move for keeps the idle life. */
export const SHIBA_CLIP_MOVES: Readonly<Record<string, ShibaMove>> = {
  look: "look",
  lookBack: "look",
  headSpin: "shake",
  tilt: "headTilt",
  spin: "turnCircles",
  backflip: "turnCircles",
  hop: "bounce",
  hopForward: "bounce",
  wave: "wave",
  dance: "wag",
  jump: "bounce",
  stretch: "stretch",
  wingStretch: "stretch",
  preen: "earTwitch",
  scratch: "earTwitch",
  peck: "sniff",
  bob: "nod",
  ruffle: "shakeOff",
  shy: "headTilt",
  confused: "headTilt",
  think: "think",
  hoot: "bark",
  doubleBlink: "blink",
  wink: "blink",
  surprised: "alert",
  startled: "alert",
  angry: "bark",
  love: "wag",
  yawn: "lieDown",
  wake: "stretch",
  land: "sit",
  petted: "wag",
  celebrate: "turnCircles",
  sad: "sad",
  // the dog's own clips
  bark: "bark",
  sniff: "sniff",
  wag: "wag",
  earTwitch: "earTwitch",
  lieDown: "lieDown",
  turnCircles: "turnCircles",
  excited: "excited",
  sit: "sit",
};

/** The move a clip or a move id plays, or null. */
export function shibaMoveFor(clip: string | null | undefined): ShibaMove | null {
  if (!clip) return null;
  if (Object.hasOwn(SHIBA_CLIP_MOVES, clip)) return SHIBA_CLIP_MOVES[clip];
  return isShibaMove(clip) ? clip : null;
}
