// The mascot's animation clips: for every thing it can do (walk, fly, spin,
// backflip, wave, hide its eyes, hoot, yawn...), where each moving part
// stands at an instant. Pure functions of time, blended by behavior.ts so a
// change of clip never pops. Every renderer (the flat owl, another
// character) maps the parts it has and ignores the rest.
//
// Units: lengths in owl units (the owl is about 2.3 tall), angles in radians.

/** Where every moving part stands at one instant. */
export interface MascotFrame {
  /** Body lift (hops, flight, breathing). */
  y: number;
  /** Turn around the vertical axis (spins; a half turn faces the other way). */
  spin: number;
  /** Lean forward (+) or back (-). */
  lean: number;
  /** Sideways sway. */
  sway: number;
  /** Vertical squash and stretch (1 = rest). */
  squash: number;
  /** Overall size (1 = rest; smaller far away in flight). */
  scale: number;
  headYaw: number;
  headPitch: number;
  headTilt: number;
  /** Near wing spread, 0 folded to 1 wide open. */
  wing: number;
  /** Eyelids, 0 open to 1 shut. */
  lid: number;
  pupilX: number;
  pupilY: number;
  /** Sideways shift of the whole owl (skids, side steps), owl units. */
  x?: number;
  /** Rotation in the owl's own side plane: a backflip is a full turn. */
  flip?: number;
  /** Rotation around the travel axis: a barrel roll in flight. */
  roll?: number;
  /** Far wing spread (defaults to the near wing's). */
  wingFar?: number;
  /** Extra swing of the near wing on top of its spread (+ up and back, - forward over the face). */
  wingSwing?: number;
  /** Feet lifted, 0..1 each (walking, kicking, scratching). */
  footNear?: number;
  footFar?: number;
  /** Beak open, 0..1. */
  beak?: number;
  /** Ear tufts: -1 flat, 0 rest, 1 perked. */
  tufts?: number;
  /** Eye size (1 rest; wide when surprised, small when squinting). */
  eyeScale?: number;
  /** Feathers puffed out (1 rest). */
  puff?: number;
  /** Which way it faces: 1 its natural side, -1 the other (blended in between while it turns). */
  face?: number;
}

export const REST: MascotFrame = {
  y: 0,
  spin: 0,
  lean: 0,
  sway: 0,
  squash: 1,
  scale: 1,
  headYaw: 0,
  headPitch: 0,
  headTilt: 0,
  wing: 0,
  lid: 0,
  pupilX: 0,
  pupilY: 0,
  x: 0,
  flip: 0,
  roll: 0,
  wingFar: 0,
  wingSwing: 0,
  footNear: 0,
  footFar: 0,
  beak: 0,
  tufts: 0,
  eyeScale: 1,
  puff: 1,
  face: 1,
};

/** Every clip by name, with how long a timed one lasts (ms). Movement clips last as long as the move. */
export const CLIP_MS = {
  look: 1800,
  lookBack: 1600,
  headSpin: 2200,
  tilt: 1500,
  turn: 500,
  spin: 1100,
  backflip: 1000,
  hop: 700,
  hopForward: 800,
  wave: 1600,
  dance: 2400,
  jump: 900,
  stretch: 1800,
  wingStretch: 1500,
  preen: 2000,
  scratch: 1600,
  peck: 1200,
  bob: 1400,
  ruffle: 1100,
  shy: 2200,
  confused: 2000,
  think: 2400,
  hoot: 1500,
  wink: 600,
  doubleBlink: 700,
  surprised: 900,
  angry: 1600,
  love: 1800,
  yawn: 1800,
  wake: 1600,
  startled: 700,
  land: 650,
  petted: 1800,
  celebrate: 2000,
  sad: 2600,
} as const;

export type TimedClip = keyof typeof CLIP_MS;
/** Clips that last until something happens. */
export type OpenClip = "idle" | "sleep" | "drag" | "working" | "walk" | "fly" | "flyOut" | "return";
export type ClipName = TimedClip | OpenClip;

export const isTimed = (clip: ClipName): clip is TimedClip => Object.hasOwn(CLIP_MS, clip);

export interface ClipContext {
  /** ms since the clip began. */
  elapsed: number;
  /** The caller's clock (ms), for loops that run across clips (breathing, blinks). */
  now: number;
  /** How long a movement clip lasts (walk, fly, flights), ms. */
  moveMs: number;
  /** A per-clip random number (0..1) for variations: which wing waves, whether a flight rolls. */
  variant: number;
  reduced: boolean;
}

const TAU = Math.PI * 2;
export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const bell = (t: number) => Math.sin(clamp01(t) * Math.PI);
/** 0 → 1 over [a, b] of t, smoothly. */
const ramp = (t: number, a: number, b: number) => {
  const k = clamp01((t - a) / (b - a));
  return k * k * (3 - 2 * k);
};
/** Up over [a, a+r], held, down over [b-r, b]. */
const hold = (t: number, a: number, b: number, r = 0.15) => ramp(t, a, a + r) * (1 - ramp(t, b - r, b));
const wave = (ms: number, hz: number) => Math.sin((ms / 1000) * TAU * hz);
/** A wing beat, 0 up..1 down, `hz` beats a second. */
const beat = (ms: number, hz: number) => 0.5 + 0.5 * Math.sin((ms / 1000) * TAU * hz);

/** One clip's contribution: what it sets on top of the resting, breathing owl. */
export function clipPose(clip: ClipName, context: ClipContext): Partial<MascotFrame> {
  const { elapsed: ms, moveMs, variant, reduced } = context;
  const length = isTimed(clip) ? CLIP_MS[clip] : moveMs;
  const t = clamp01(ms / Math.max(1, length));
  const calm = reduced ? 0.35 : 1;
  switch (clip) {
    case "idle":
      return {};
    case "look":
      return { headYaw: Math.sin(t * TAU) * 0.9 * calm, headTilt: bell(t) * 0.18 * calm, pupilX: Math.sin(t * TAU) };
    case "lookBack":
      // looks over its shoulder: a turn most of the way round, a peek, back
      return { spin: hold(t, 0, 1, 0.3) * 0.4 * calm, headTilt: hold(t, 0.2, 0.8) * 0.15, pupilX: -0.6 * hold(t, 0.2, 0.8) };
    case "headSpin":
      // the owl trick: the head turns three quarters round and back
      // the head leads, the body follows a little: a slow look all the way to one side and back
      return { headYaw: Math.sin(t * Math.PI) * 1.2 * calm, spin: Math.sin(t * Math.PI) * 0.3 * calm, squash: 1 + 0.03 * bell(t) };
    case "tilt":
      return { headTilt: hold(t, 0, 1, 0.25) * (variant < 0.5 ? -0.4 : 0.4), eyeScale: 1 + 0.1 * hold(t, 0, 1, 0.25), pupilY: 0.3 * bell(t) };
    case "turn":
      return { squash: 1 - 0.06 * bell(t), y: 0.06 * bell(t) };
    case "spin": {
      const p = easeInOut(t);
      return { spin: p * TAU, y: bell(p) * 0.25, wing: bell(p) * 0.7, lid: bell(p) * 0.5, tufts: 0.6 * bell(p) };
    }
    case "backflip": {
      // crouch, jump, a full turn backwards, land
      const crouch = 1 - ramp(t, 0, 0.18) * (1 - ramp(t, 0.18, 0.28));
      const air = ramp(t, 0.2, 0.85);
      return {
        y: bell((t - 0.2) / 0.65) * 0.9 * calm,
        flip: reduced ? 0 : -easeInOut(air) * TAU,
        squash: t < 0.22 ? 0.85 + 0.15 * crouch : t > 0.86 ? 0.88 + 0.12 * ramp(t, 0.86, 1) : 1.04,
        wing: 0.5 * bell((t - 0.15) / 0.8),
        tufts: 1 * bell(t),
      };
    }
    case "hop": {
      const arc = bell(t);
      return { y: arc * 0.3 * calm, squash: t < 0.12 || t > 0.88 ? 0.9 : 1 + arc * 0.06, wing: arc * 0.35, footNear: arc * 0.4, footFar: arc * 0.4 };
    }
    case "hopForward": {
      const arc = bell(t);
      return { y: arc * 0.35 * calm, x: easeInOut(t) * 0.25 - 0.25 * ramp(t, 0.85, 1), lean: 0.25 * arc, squash: t < 0.12 || t > 0.88 ? 0.9 : 1.05, wing: arc * 0.4 };
    }
    case "wave": {
      // hello: one wing up, waving
      const up = hold(t, 0, 1, 0.2);
      return { wing: up * 0.8, wingSwing: up * 0.35 * Math.sin((ms / 1000) * TAU * 3.2) * calm, headTilt: 0.15 * up, lid: 0.35 * up, beak: 0.4 * bell(t * 3 % 1) * up, tufts: 0.6 * up };
    }
    case "dance": {
      // side to side bounces, wings out on the beat
      const k = hold(t, 0, 1, 0.08) * calm;
      const step = wave(ms, 2);
      return { sway: 0.18 * step * k, x: 0.12 * step * k, y: Math.abs(step) * 0.18 * k, wing: (0.3 + 0.4 * Math.abs(step)) * k, headTilt: -0.3 * step * k, lid: 0.45 * k, footNear: Math.max(0, step) * k, footFar: Math.max(0, -step) * k };
    }
    case "jump": {
      // excited: two quick jumps, wings up
      const p = (t * 2) % 1;
      return { y: bell(p) * 0.45 * calm, wing: 0.4 + 0.6 * bell(p), squash: p < 0.1 || p > 0.9 ? 0.88 : 1.06, eyeScale: 1.12, tufts: 1, beak: 0.5 * bell(p) };
    }
    case "stretch": {
      // both wings wide, standing tall, a little tremble at the tips
      const k = hold(t, 0, 1, 0.25);
      return { wing: k, wingFar: k, wingSwing: 0.05 * wave(ms, 3) * k, squash: 1 + 0.07 * k, headPitch: -0.2 * k, lid: 0.4 * k, tufts: 0.8 * k };
    }
    case "wingStretch": {
      // one wing stretched out and back
      const k = hold(t, 0, 1, 0.3);
      return variant < 0.5 ? { wing: k, wingSwing: -0.25 * k, sway: -0.06 * k, headYaw: 0.4 * k } : { wingFar: k, sway: 0.06 * k, headYaw: -0.4 * k };
    }
    case "preen": {
      // nibbling its feathers: head down to the wing, little pecks
      const k = hold(t, 0, 1, 0.2);
      return { headPitch: 0.5 * k, headYaw: 0.7 * k, headTilt: 0.2 * k, beak: k * beat(ms, 3) * 0.6, wing: 0.15 * k, lid: 0.4 * k, lean: 0.12 * k };
    }
    case "scratch": {
      // scratches its head with a foot, standing on the other
      const k = hold(t, 0, 1, 0.2);
      return { footNear: k * (0.8 + 0.2 * wave(ms, 3.5)), headTilt: 0.35 * k, sway: -0.08 * k, lid: 0.5 * k, headPitch: 0.15 * k };
    }
    case "peck": {
      // two pecks at the ground
      const p = (t * 2) % 1;
      const down = bell(p);
      return { lean: 0.5 * down, headPitch: 0.4 * down, beak: down > 0.8 ? 0.5 : 0, y: -0.02 * down };
    }
    case "bob":
      // the owl's head bob: a little up and down to judge a distance
      return { y: 0.08 * Math.max(0, wave(ms, 2.2)) * bell(t) * calm, headPitch: -0.12 * wave(ms, 2.2) * bell(t) * calm, eyeScale: 1 + 0.05 * bell(t) };
    case "ruffle": {
      // puffs up, a soft damped wiggle of the feathers (not the body), settles
      const k = bell(t);
      const wiggle = Math.exp(-t * 4) * Math.sin(t * TAU * 3);
      return { puff: 1 + 0.1 * k + 0.03 * wiggle * calm, wing: 0.2 * k, wingFar: 0.2 * k, squash: 1 - 0.03 * k, lid: 0.6 * k };
    }
    case "shy": {
      // hides its eyes behind its wings, peeks out, hides again
      const k = hold(t, 0, 1, 0.15);
      const peek = hold(t, 0.45, 0.65, 0.05);
      return { wing: 0, wingSwing: -2.2 * k * (1 - 0.45 * peek), wingFar: 0.35 * k, headPitch: 0.25 * k, lid: 0.8 * k * (1 - peek), squash: 1 - 0.05 * k, tufts: -0.6 * k };
    }
    case "confused":
      return { headTilt: hold(t, 0, 1, 0.2) * 0.45 * (variant < 0.5 ? 1 : -1), pupilX: 0.6 * wave(ms, 0.8), pupilY: 0.5, headYaw: 0.25 * wave(ms, 0.6) * calm, tufts: -0.3 };
    case "think": {
      // looks up and taps its chin with a wing tip
      const k = hold(t, 0, 1, 0.15);
      return { headPitch: -0.25 * k, headTilt: 0.2 * k, pupilX: 0.5 * k, pupilY: 0.8 * k, wing: 0, wingSwing: (-1.7 + 0.15 * Math.max(0, wave(ms, 2.5))) * k };
    }
    case "hoot": {
      // two hoots: chest puffs, beak opens
      const p = (t * 2) % 1;
      const k = bell(p / 0.6);
      return { beak: 0.8 * k, puff: 1 + 0.07 * k, squash: 1 + 0.05 * k, headPitch: -0.15 * k, wing: 0.15 * k, eyeScale: 1 - 0.08 * k };
    }
    case "wink":
      return { lid: bell(t), headTilt: 0.2 * bell(t), beak: 0.2 * bell(t) };
    case "doubleBlink":
      return { lid: Math.max(bell(t / 0.4), bell((t - 0.55) / 0.4)) };
    case "surprised":
      return { eyeScale: 1 + 0.3 * hold(t, 0, 1, 0.1), lid: 0, tufts: 1, squash: 1 + 0.06 * bell(t), beak: 0.6 * hold(t, 0, 1, 0.1), y: 0.05 * bell(t) };
    case "angry": {
      // puffs up, stamps, shakes its head
      const k = hold(t, 0, 1, 0.15);
      return { puff: 1 + 0.15 * k, lid: 0.45 * k, eyeScale: 0.9, tufts: 1 * k, headYaw: 0.2 * wave(ms, 2.5) * k * calm, wing: 0.3 * k, wingFar: 0.3 * k, footNear: Math.max(0, wave(ms, 4)) * k, lean: 0.1 * k };
    }
    case "love":
      return { lid: 0.6 * hold(t, 0, 1, 0.15), sway: 0.08 * wave(ms, 1.2) * calm, headTilt: 0.25 * wave(ms, 1.2) * calm, squash: 1 + 0.03 * bell(t), wing: 0.2 * bell(t), tufts: 0.5 };
    case "yawn": {
      const k = hold(t, 0, 1, 0.3);
      return { beak: k, headPitch: -0.35 * k, lid: 0.85 * k, wing: 0.3 * k, wingFar: 0.3 * k, squash: 1 + 0.06 * k, tufts: -0.5 };
    }
    case "wake": {
      // wakes up: blinks, stretches wings, shakes
      const stretch = hold(t, 0.2, 0.75, 0.2);
      return { lid: 1 - ramp(t, 0, 0.25), wing: stretch, wingFar: stretch, squash: 1 + 0.08 * stretch, headPitch: -0.2 * stretch, puff: 1 + 0.05 * hold(t, 0.75, 1, 0.1) };
    }
    case "startled":
      return { y: bell(t) * 0.4 * calm, eyeScale: 1.3, lid: 0, tufts: 1, wing: 0.6 * bell(t), wingFar: 0.6 * bell(t), squash: t < 0.1 ? 0.85 : 1.08, lean: -0.15 * bell(t) };
    case "land": {
      // touch down: a skid, a squash, a wobble, wings folding
      const wobble = Math.exp(-t * 5) * Math.sin(t * 22);
      return { squash: 1 - 0.14 * bell(t / 0.35) + 0.04 * wobble, x: -0.18 * (1 - easeInOut(clamp01(t / 0.5))), wing: 0.6 * (1 - ramp(t, 0, 0.7)), wingFar: 0.6 * (1 - ramp(t, 0, 0.7)), lean: -0.2 * (1 - ramp(t, 0, 0.5)) + 0.05 * wobble, footNear: 0.3 * (1 - ramp(t, 0, 0.3)) };
    }
    case "petted": {
      // leans into the hand, hugs itself with its wings, eyes happy, purring
      const k = bell(t);
      return { headTilt: 0.35 * k, sway: 0.1 * k, lid: 0.7 * k, wing: 0, wingSwing: -1.0 * k, wingFar: 0.3 * k, squash: 1 - 0.04 * k + (reduced ? 0 : 0.01 * wave(ms, 2)), tufts: 0.5 * k, eyeScale: 1 - 0.1 * k };
    }
    case "celebrate": {
      // a backflip, then happy bounces with wings up
      if (t < 0.5) return { ...clipPose("backflip", { ...context, elapsed: ms }), tufts: 1 };
      const p = (t - 0.5) / 0.5;
      return { y: Math.abs(Math.sin(p * Math.PI * 3)) * 0.25 * calm, wing: 0.6 + 0.4 * beat(ms, 3.5) * calm, wingFar: 0.6, lid: 0.5, tufts: 1, beak: 0.4 * bell(p) };
    }
    case "sad": {
      // droops: head down, wings low, eyes half shut and down
      const k = ramp(t, 0, 0.2);
      return { headPitch: 0.45 * k, lid: 0.55 * k, pupilY: -1 * k, squash: 1 - 0.06 * k, tufts: -1 * k, wing: 0, lean: 0.1 * k, eyeScale: 1 - 0.05 * k };
    }
    case "sleep":
      // head tucked, eyes shut, slow breaths
      return { lid: 1, headTilt: 0.28, headPitch: 0.35, headYaw: 0, y: 0.025 * wave(ms, 0.18), squash: 0.96 + 0.025 * wave(ms, 0.18), puff: 1.05, tufts: -0.6, pupilX: 0, pupilY: 0 };
    case "drag": {
      // carried: flaps hard and kicks its feet
      return { wing: 0.35 + 0.65 * beat(ms, 3.5), wingFar: 0.35 + 0.65 * beat(ms, 3.5), y: 0.05, squash: 1.08, lid: 0, eyeScale: 1.1, headPitch: -0.15, footNear: Math.max(0, wave(ms, 4)), footFar: Math.max(0, -wave(ms, 4)), tufts: 0.8 };
    }
    case "working":
      // works in place (no flight): thinking, tapping a wing
      return { ...clipPose("think", { ...context, elapsed: 1000 }), pupilX: Math.sin((ms / 1000) * 0.8) * 0.6 };
    case "walk": {
      // a waddle: body rocks side to side, feet alternate, a little bounce per step
      const steps = (ms / 1000) * 3.2;
      const rock = Math.sin(steps * Math.PI);
      const k = ramp(t, 0, 0.08) * (1 - ramp(t, 0.92, 1));
      return { sway: 0.12 * rock * k, y: 0.05 * Math.abs(rock) * k, footNear: Math.max(0, rock) * 0.7 * k, footFar: Math.max(0, -rock) * 0.7 * k, lean: 0.08 * k, wing: 0.08 * k, wingFar: 0.08 * k };
    }
    case "fly":
    case "flyOut":
    case "return":
      return flightPose(clip, t, ms, length, variant, reduced);
    default:
      return {};
  }
}

/** How long the crouch before a take-off lasts: the window only starts moving after it. */
export const TAKEOFF_MS = 380;

/**
 * A flight from one spot to another: crouch and spread (take-off), beat the
 * wings the whole way with the body pitched forward and bobbing with each
 * beat, glide near the end, brake. The window itself moves along the same
 * time (pilot.ts); the landing is its own clip once it arrives.
 */
function flightPose(clip: "fly" | "flyOut" | "return", t: number, ms: number, length: number, variant: number, reduced: boolean): Partial<MascotFrame> {
  const takeoff = clip === "return" ? 0 : TAKEOFF_MS / Math.max(1, length);
  if (t < takeoff) {
    // crouch, wings spreading
    const k = ramp(t / takeoff, 0, 1);
    return { squash: 1 - 0.14 * k, wing: 0.7 * k, wingFar: 0.7 * k, lean: 0.1 * k, lid: 0, eyeScale: 1.05, tufts: 0.6 };
  }
  const p = clamp01((t - takeoff) / (1 - takeoff));
  const gliding = clip === "flyOut" ? 0 : ramp(p, 0.72, 0.85);
  const hz = clip === "return" ? 3.5 : 4;
  const down = beat(ms, hz);
  const flap = 0.3 + 0.7 * down;
  const open = flap * (1 - gliding) + 0.85 * gliding;
  const frame: Partial<MascotFrame> = {
    wing: open,
    wingFar: open,
    // each downstroke lifts the body a little
    y: 0.35 + 0.08 * (1 - down) * (1 - gliding) + (clip === "flyOut" ? 0.4 * easeInOut(p) : 0) - (clip === "return" ? 0.3 * ramp(p, 0.8, 1) : 0),
    lean: 0.35 * (1 - gliding) + 0.05 * gliding - (clip === "return" ? 0.3 * ramp(p, 0.85, 1) : 0),
    squash: 1.04,
    lid: 0,
    tufts: -0.4,
    footNear: 0.6,
    footFar: 0.6,
  };
  // now and then a barrel roll mid-flight
  if (clip === "fly" && variant > 0.7 && !reduced) frame.roll = easeInOut(ramp(p, 0.35, 0.6)) * TAU;
  if (clip === "flyOut") frame.scale = 1 - 0.25 * easeInOut(p);
  if (clip === "return") frame.scale = 0.75 + 0.25 * easeInOut(p);
  if (reduced) frame.y = 0.1;
  return frame;
}

/* --------------------------------------------------------------- blending */

const ANGLES = new Set<keyof MascotFrame>(["spin", "flip", "roll"]);

/** The shortest signed difference between two angles. */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

/** Mixes two frames, w = 0 is `from`, 1 is `to`; turns take the short way round. */
export function blendFrames(from: MascotFrame, to: MascotFrame, w: number): MascotFrame {
  if (w >= 1) return to;
  const out = { ...to } as Record<string, number>;
  const a = from as unknown as Record<string, number | undefined>;
  const b = to as unknown as Record<string, number | undefined>;
  for (const key of Object.keys(REST) as (keyof MascotFrame)[]) {
    const x = a[key] ?? (REST[key] as number);
    const y = b[key] ?? (REST[key] as number);
    out[key] = ANGLES.has(key) ? x + angleDelta(x, y) * w : x + (y - x) * w;
  }
  return out as unknown as MascotFrame;
}
