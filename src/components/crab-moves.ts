// Crab's moves (CrabMascot.tsx, the desktop mascot): keyframe tracks, pure
// functions of time. A pose says where the whole crab is, where the eyes
// look, how shut they are, each arm's turn and each leg's lift, rotate and
// stretch (Codrops lean: scaleY from the hip, ground clip in the drawing).
// CrabRig layers the idle life, one held activity and one one-shot. Reduced
// motion never runs it: a move only shows its face (closed eyes for sleep).
import { clamp01, easeInOut } from "./shape-art";
import { blinkOpen, blinkSchedule } from "./shape-engine";
import { CRAB_PIVOTS, CRAB_PX } from "./crab-art";

export interface CrabNumbers {
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
  lookX: number;
  lookY: number;
  blink: number;
  armLRot: number;
  armRRot: number;
  clawL: number;
  clawR: number;
  spark: number;
  leg0: number;
  leg1: number;
  leg2: number;
  leg3: number;
  legRot0: number;
  legRot1: number;
  legRot2: number;
  legRot3: number;
  legSy0: number;
  legSy1: number;
  legSy2: number;
  legSy3: number;
}

export interface CrabPose extends CrabNumbers {
  expression: string | null;
}

export const CRAB_REST: Readonly<CrabNumbers> = Object.freeze({
  x: 0,
  y: 0,
  rot: 0,
  sx: 1,
  sy: 1,
  lookX: 0,
  lookY: 0,
  blink: 0,
  armLRot: 0,
  armRRot: 0,
  clawL: 0,
  clawR: 0,
  spark: 0,
  leg0: 0,
  leg1: 0,
  leg2: 0,
  leg3: 0,
  legRot0: 0,
  legRot1: 0,
  legRot2: 0,
  legRot3: 0,
  legSy0: 1,
  legSy1: 1,
  legSy2: 1,
  legSy3: 1,
});

const NUMBERS = Object.keys(CRAB_REST) as (keyof CrabNumbers)[];

export function crabRestPose(): CrabPose {
  return { ...CRAB_REST, expression: null };
}

export type Ease = "linear" | "in" | "out" | "inOut" | "hold";

const EASES: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  hold: (t) => (t < 1 ? 0 : 1),
};

export interface CrabKey extends Partial<CrabNumbers> {
  at: number;
  ease?: Ease;
  face?: string;
  partial?: boolean;
}

export interface CrabTrack {
  duration: number;
  loop: boolean;
  reduced: "face" | "none";
  keys: readonly CrabKey[];
}

export const CRAB_MOVES = ["idle", "blink", "look", "wave", "walk", "scuttle", "hop", "celebrate", "sleep", "talk", "listen", "work", "alert", "drag"] as const;
export type CrabMove = (typeof CRAB_MOVES)[number];
export const isCrabMove = (value: unknown): value is CrabMove => typeof value === "string" && (CRAB_MOVES as readonly string[]).includes(value);

const LIFT = -10;

export const CRAB_TRACKS: Readonly<Record<CrabMove, CrabTrack>> = {
  idle: {
    duration: 2.4,
    loop: true,
    reduced: "none",
    keys: [
      { at: 0, y: 0, sx: 1, sy: 1, clawL: 0.12, clawR: 0.18 },
      { at: 0.5, y: -2.4, sx: 1.03, sy: 0.97, clawL: 0.28, clawR: 0.1 },
      { at: 1, y: 0, sx: 1, sy: 1, clawL: 0.12, clawR: 0.18 },
    ],
  },
  blink: { duration: 0.22, loop: false, reduced: "none", keys: [{ at: 0 }, { at: 0.45, blink: 1 }, { at: 1 }] },
  look: {
    duration: 1.6,
    loop: false,
    reduced: "none",
    keys: [{ at: 0 }, { at: 0.2, lookX: 6, rot: 3 }, { at: 0.45, lookX: 6, rot: 3 }, { at: 0.65, lookX: -6, rot: -3 }, { at: 0.85, lookX: -6, rot: -3 }, { at: 1 }],
  },
  wave: {
    duration: 1.4,
    loop: false,
    reduced: "face",
    keys: [
      { at: 0, face: "happy" },
      { at: 0.16, ease: "out", armRRot: -62, clawR: 1, rot: -4 },
      { at: 0.32, armRRot: -18, clawR: 0.15, rot: -4 },
      { at: 0.48, armRRot: -62, clawR: 1, rot: -4 },
      { at: 0.64, armRRot: -18, clawR: 0.15, rot: -4 },
      { at: 0.8, armRRot: -52, clawR: 0.85, rot: -4 },
      { at: 1, ease: "inOut" },
    ],
  },
  walk: {
    duration: 0.48,
    loop: true,
    reduced: "none",
    keys: [
      { at: 0, leg0: LIFT, leg2: LIFT, armLRot: 12, armRRot: -12, y: -1.2 },
      { at: 0.5, leg1: LIFT, leg3: LIFT, armLRot: -12, armRRot: 12, y: -1.2 },
      { at: 1, leg0: LIFT, leg2: LIFT, armLRot: 12, armRRot: -12, y: -1.2 },
    ],
  },
  // three walk cycles, side to side, then rest (the Moves menu's Scuttle)
  scuttle: {
    duration: 1.44,
    loop: false,
    reduced: "none",
    keys: [
      { at: 0 },
      { at: 0.083, x: 4, leg0: LIFT, leg2: LIFT, armLRot: 12, armRRot: -12, y: -1.2 },
      { at: 0.167, x: 0, leg1: LIFT, leg3: LIFT, armLRot: -12, armRRot: 12, y: -1.2 },
      { at: 0.25, x: -4, leg0: LIFT, leg2: LIFT, armLRot: 12, armRRot: -12, y: -1.2 },
      { at: 0.333, x: 0, leg1: LIFT, leg3: LIFT, armLRot: -12, armRRot: 12, y: -1.2 },
      { at: 0.417, x: 4, leg0: LIFT, leg2: LIFT, armLRot: 12, armRRot: -12, y: -1.2 },
      { at: 0.5, x: 0, leg1: LIFT, leg3: LIFT, armLRot: -12, armRRot: 12, y: -1.2 },
      { at: 0.583, x: -4, leg0: LIFT, leg2: LIFT, armLRot: 12, armRRot: -12, y: -1.2 },
      { at: 0.667, x: 0, leg1: LIFT, leg3: LIFT, armLRot: -12, armRRot: 12, y: -1.2 },
      { at: 0.75, x: 4, leg0: LIFT, leg2: LIFT, armLRot: 12, armRRot: -12, y: -1.2 },
      { at: 0.833, x: 0, leg1: LIFT, leg3: LIFT, armLRot: -12, armRRot: 12, y: -1.2 },
      { at: 0.917, x: 2, y: -0.6 },
      { at: 1, ease: "inOut" },
    ],
  },
  hop: {
    duration: 0.7,
    loop: false,
    reduced: "none",
    keys: [
      { at: 0 },
      { at: 0.16, ease: "inOut", sy: 0.9, sx: 1.08, y: 1.5 },
      { at: 0.38, ease: "out", y: -22, sy: 1.06, sx: 0.95, leg0: LIFT, leg1: LIFT, leg2: LIFT, leg3: LIFT },
      { at: 0.58, ease: "in", y: 0, sy: 0.92, sx: 1.06 },
      { at: 0.78, ease: "out", sy: 1.04, sx: 0.98 },
      { at: 1, ease: "inOut" },
    ],
  },
  // Clawd's clap strip: squash, claws up, sparkles, squint, bounce, rest.
  celebrate: {
    duration: 1.8,
    loop: false,
    reduced: "face",
    keys: [
      { at: 0, face: "excited" },
      { at: 0.08, ease: "inOut", sy: 0.88, sx: 1.12, y: 2 },
      { at: 0.2, ease: "out", y: -14, sy: 1.08, sx: 0.94, armLRot: -72, armRRot: 72, clawL: 0.9, clawR: 0.9, spark: 1, face: "happy" },
      { at: 0.34, y: -3, armLRot: -36, armRRot: 36, spark: 1 },
      { at: 0.48, ease: "out", y: -18, armLRot: -88, armRRot: 88, sy: 1.06, clawL: 1, clawR: 1, spark: 1 },
      { at: 0.62, ease: "in", y: 0, sy: 0.92, sx: 1.08, armLRot: -24, armRRot: 24, spark: 0.35 },
      { at: 0.76, ease: "out", y: -12, armLRot: -80, armRRot: 80, spark: 1, face: "happy" },
      { at: 0.9, y: 0, spark: 0.15 },
      { at: 1, ease: "inOut" },
    ],
  },
  sleep: {
    duration: 3.2,
    loop: true,
    reduced: "face",
    keys: [
      { at: 0, face: "sleepy", blink: 1, y: 1.2, sy: 0.98 },
      { at: 0.5, blink: 1, y: 0.4, sy: 1.01 },
      { at: 1, blink: 1, y: 1.2, sy: 0.98 },
    ],
  },
  talk: {
    duration: 0.42,
    loop: true,
    reduced: "face",
    keys: [{ at: 0, face: "excited", y: 0, sy: 0.98 }, { at: 0.5, y: -2, sy: 1.04 }, { at: 1, y: 0, sy: 0.98 }],
  },
  listen: {
    duration: 2.2,
    loop: true,
    reduced: "face",
    keys: [{ at: 0, face: "attentive", rot: 5, lookX: 4 }, { at: 0.5, rot: 7, lookX: 4 }, { at: 1, rot: 5, lookX: 4 }],
  },
  work: {
    duration: 0.7,
    loop: true,
    reduced: "face",
    keys: [{ at: 0, face: "attentive", lookY: 2 }, { at: 0.5, lookY: 3, y: -1.2, armLRot: 8, armRRot: -8 }, { at: 1, lookY: 2 }],
  },
  alert: {
    duration: 0.7,
    loop: false,
    reduced: "face",
    keys: [{ at: 0, face: "surprised" }, { at: 0.22, ease: "out", y: -4, sy: 1.06, sx: 0.96 }, { at: 1, ease: "inOut" }],
  },
  drag: {
    duration: 1,
    loop: true,
    reduced: "face",
    keys: [
      { at: 0, face: "surprised", rot: -8, sy: 1.06, sx: 0.95, leg0: 4, leg1: 4, leg2: 4, leg3: 4 },
      { at: 0.5, rot: 8, sy: 1.06, sx: 0.95, leg0: 4, leg1: 4, leg2: 4, leg3: 4 },
      { at: 1, rot: -8, sy: 1.06, sx: 0.95, leg0: 4, leg1: 4, leg2: 4, leg3: 4 },
    ],
  },
};

export function crabTrackAt(track: CrabTrack, u: number, cycle = track.loop): CrabPose {
  const d = track.duration;
  const time = cycle ? ((u % d) + d) % d : Math.min(Math.max(0, u), d);
  const t = time / d;
  const pose = crabRestPose();
  for (const name of NUMBERS) {
    let prev = { at: 0, v: CRAB_REST[name] };
    let next: { at: number; v: number; ease: Ease } | null = null;
    for (const key of track.keys) {
      const value = key[name];
      if (value === undefined && key.partial) continue;
      const v = value ?? CRAB_REST[name];
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
  }
  return pose;
}

export function crabMoveAt(move: CrabMove, u: number, cycle?: boolean): CrabPose {
  return crabTrackAt(CRAB_TRACKS[move], u, cycle);
}

export function crabReducedFace(move: CrabMove): Pick<CrabPose, "expression" | "blink"> | null {
  const track = CRAB_TRACKS[move];
  if (track.reduced === "none") return null;
  const pose = crabTrackAt(track, track.loop ? 0 : track.duration / 2);
  return { expression: pose.expression, blink: pose.blink };
}

const SCALED = new Set<keyof CrabNumbers>(["sx", "sy", "legSy0", "legSy1", "legSy2", "legSy3"]);
const CLOSING = new Set<keyof CrabNumbers>(["blink", "spark"]);

export function layerPose(base: CrabPose, top: CrabPose, w: number): CrabPose {
  if (w <= 0) return base;
  const out: CrabPose = { ...base };
  for (const name of NUMBERS) {
    const rest = CRAB_REST[name];
    const v = top[name];
    if (v === rest) continue;
    if (SCALED.has(name)) out[name] = base[name] * (1 + (v - 1) * w);
    else if (CLOSING.has(name)) out[name] = Math.max(base[name], v * w);
    else out[name] = base[name] + (v - rest) * w;
  }
  if (w >= 0.5 && top.expression) out.expression = top.expression;
  return out;
}

export function crabMoveWeight(move: CrabMove, u: number): number {
  const { duration } = CRAB_TRACKS[move];
  if (u < 0 || u > duration + 0.18) return 0;
  return Math.min(easeInOut(clamp01(u / 0.12)), u > duration ? 1 - easeInOut(clamp01((u - duration) / 0.18)) : 1);
}

export const CRAB_BREATH_S = 2.4;

export function crabIdlePose(t: number, blinks: readonly number[]): CrabPose {
  const pose = crabRestPose();
  const lift = 0.5 + 0.5 * Math.sin((Math.PI * 2 * t) / CRAB_BREATH_S);
  pose.y = -2.2 * lift;
  pose.sx = 1 + 0.025 * lift;
  pose.sy = 1 - 0.02 * lift;
  // Codrops walking Claude: eyes, body tilt and per-leg stretch on one beat.
  const lean = Math.sin((Math.PI * 2 * t) / 10.9);
  pose.rot = 1.6 * Math.sin((Math.PI * 2 * t) / 7.3) - 3 * lean;
  pose.lookX = 3.4 * lean + 1.1 * Math.sin((Math.PI * 2 * t) / 3.9);
  pose.lookY = 1.8 * Math.sin((Math.PI * 2 * t) / 8.7 + 0.7);
  pose.blink = 1 - blinkOpen(t, blinks);
  pose.armLRot = 5 * Math.sin((Math.PI * 2 * t) / CRAB_BREATH_S);
  pose.armRRot = -5 * Math.sin((Math.PI * 2 * t) / CRAB_BREATH_S);
  const left = Math.max(0, -lean);
  const right = Math.max(0, lean);
  pose.legRot0 = -8 * lean;
  pose.legRot1 = -7 * lean;
  pose.legRot2 = -6 * lean;
  pose.legRot3 = -5 * lean;
  pose.legSy0 = 1 + 0.28 * left + 0.08 * right;
  pose.legSy1 = 1 + 0.22 * left + 0.1 * right;
  pose.legSy2 = 1 + 0.1 * left + 0.22 * right;
  pose.legSy3 = 1 + 0.08 * left + 0.28 * right;
  return pose;
}

export class CrabRig {
  private readonly start: number;
  private readonly seed: number;
  private blinks: number[] = [];
  private blinkHorizon = 0;
  private held: { move: CrabMove; since: number } | null = null;
  private letGo: { move: CrabMove; since: number; at: number } | null = null;
  private shot: { move: CrabMove; at: number } | null = null;

  constructor(now: number, seed = Math.random() * 1000) {
    this.start = now;
    this.seed = seed;
  }

  hold(move: CrabMove | null, now: number): void {
    if ((this.held?.move ?? null) === move) return;
    this.letGo = this.held ? { ...this.held, at: now } : null;
    this.held = move ? { move, since: now } : null;
  }

  play(move: CrabMove, now: number): void {
    this.shot = { move, at: now };
  }

  playing(now: number): boolean {
    return this.shot !== null && now - this.shot.at <= CRAB_TRACKS[this.shot.move].duration + 0.18;
  }

  busy(now: number): boolean {
    return this.held !== null || this.playing(now) || (this.letGo !== null && now - this.letGo.at < 0.3);
  }

  pose(now: number): CrabPose {
    const t = now - this.start;
    if (t + 6 > this.blinkHorizon) {
      this.blinkHorizon = t + 30;
      this.blinks = blinkSchedule(this.seed, this.blinkHorizon);
    }
    let pose = crabIdlePose(t, this.blinks);
    if (this.letGo) {
      const w = 1 - easeInOut(clamp01((now - this.letGo.at) / 0.28));
      if (w > 0) pose = layerPose(pose, crabMoveAt(this.letGo.move, now - this.letGo.since, CRAB_TRACKS[this.letGo.move].loop), w);
      else this.letGo = null;
    }
    if (this.held) pose = layerPose(pose, crabMoveAt(this.held.move, now - this.held.since, true), 1);
    if (this.shot) {
      const u = now - this.shot.at;
      const w = crabMoveWeight(this.shot.move, u);
      if (w > 0) pose = layerPose(pose, crabMoveAt(this.shot.move, u, false), w);
      else this.shot = null;
    }
    return pose;
  }
}

const CLIP_MOVES: Readonly<Record<string, CrabMove>> = {
  hop: "hop",
  jump: "hop",
  wave: "wave",
  dance: "celebrate",
  walk: "walk",
  scuttle: "scuttle",
  sleep: "sleep",
  drag: "drag",
  look: "look",
  blink: "blink",
  alert: "alert",
  celebrate: "celebrate",
};

export function crabMoveFor(clip: string | undefined | null): CrabMove | null {
  if (!clip) return null;
  if (isCrabMove(clip)) return clip;
  return CLIP_MOVES[clip] ?? null;
}

export function crabHeldFor(activity: string, pose: string): CrabMove | null {
  if (activity === "walk") return "walk";
  if (activity === "fly" || activity === "flyOut" || activity === "return") return "hop";
  if (activity === "sleep" || pose === "sleep") return "sleep";
  if (activity === "drag") return "drag";
  if (activity === "working" || pose === "think") return "work";
  if (pose === "speak") return "talk";
  if (pose === "alert") return "listen";
  return null;
}

function origin(point: readonly [number, number]): string {
  return `${point[0]} ${point[1]}`;
}

export const CRAB_GROUPS = ["whole", "armL", "armR", "eyes", "eyeL", "eyeR", "leg0", "leg1", "leg2", "leg3", "sparkles"] as const;
export type CrabGroup = (typeof CRAB_GROUPS)[number];

/** Snap a rig offset to whole sprite cells (crab-art.ts CRAB_PX), so the
 * pixel crab never shows a part between grid cells. */
export const crabSnap = (v: number) => {
  const cells = Math.round(v / CRAB_PX);
  return cells === 0 ? 0 : cells * CRAB_PX;
};

export function crabTransforms(pose: CrabPose): Record<CrabGroup, string> {
  const g = origin(CRAB_PIVOTS.ground);
  // One rigid sprite: the whole group bobs (whole cells) and tilts on its
  // ground point, never stretches. Arms and legs never rotate or scale
  // apart from the body; a leg steps up one cell at most, an arm raises one
  // cell, so nothing detaches (JC, 2026-10-12).
  const whole = `translate(${crabSnap(pose.x)} ${crabSnap(pose.y)}) rotate(${Math.max(-4, Math.min(4, pose.rot)).toFixed(2)} ${g})`;
  const arm = (rot: number) => `translate(0 ${Math.abs(rot) >= 30 ? -CRAB_PX : 0})`;
  const leg = (i: 0 | 1 | 2 | 3) => `translate(0 ${pose[`leg${i}`] <= -CRAB_PX / 2 ? -CRAB_PX : 0})`;
  const blink = Math.max(0.08, 1 - pose.blink);
  const eye = (side: "L" | "R") => {
    const p = CRAB_PIVOTS[`eye${side}`];
    return `translate(${p[0]} ${p[1]}) scale(1 ${blink.toFixed(3)}) translate(${-p[0]} ${-p[1]})`;
  };
  return {
    whole,
    armL: arm(pose.armLRot),
    armR: arm(pose.armRRot),
    eyes: `translate(${pose.lookX.toFixed(2)} ${pose.lookY.toFixed(2)})`,
    eyeL: eye("L"),
    eyeR: eye("R"),
    leg0: leg(0),
    leg1: leg(1),
    leg2: leg(2),
    leg3: leg(3),
    sparkles: `translate(0 ${(-4 * pose.spark).toFixed(2)})`,
  };
}
