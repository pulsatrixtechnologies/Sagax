// A floating mascot's own little life, kept pure so it can be tested without
// a DOM or a GPU: what it is doing now (one of the clips in clips.ts: idle
// actions picked by scheduler.ts, reactions to clicks, strokes, drags and
// the pointer, flights while its bot works), and, frame by frame, how that
// moves its body, blended from the previous clip so nothing ever pops.
// The floating window (FloatingBotView.tsx) feeds it ticks, clicks, strokes,
// drags, the pointer, the room around it and the task state the brain sends;
// it answers with a new state and a few effects (fly the window away, bring
// it home, walk or fly along the desk, show hearts). Nothing here punishes
// neglect: a lonely mascot only naps.
//
// Calm by construction: no motion above about 4 Hz, every change of clip is
// blended, reactions have cooldowns, and a clip started by the person or the
// pointer stays at least MIN_DWELL_MS before another one may replace it.
import { blendFrames, CLIP_MS, clipPose, easeInOut, isTimed, REST, TAKEOFF_MS, type ClipName, type MascotFrame, type TimedClip } from "./clips";
import {
  chooseDirection,
  idleGapMs,
  moveDistance,
  moveDuration,
  newSchedulerMemory,
  pickIdleAction,
  sleepAfterMs,
  type Liveliness,
  type SchedulerMemory,
} from "./scheduler";

export type { MascotFrame } from "./clips";
export type { Liveliness } from "./scheduler";

/** What the bot's work looks like from the window: the brain sends it in every snapshot. */
export type MascotTask = "idle" | "working" | "waiting" | "error";

export type MascotActivity = ClipName;

interface ClipRun {
  activity: MascotActivity;
  since: number;
  facing: 1 | -1;
  variant: number;
  moveMs: number;
}

export interface MascotState extends ClipRun {
  /** When a timed clip ends by itself; null while it lasts until something happens. */
  until: number | null;
  /** What follows a timed clip (null: back to resting). */
  after: MascotActivity | null;
  /** The clip this one blends from. */
  prev: ClipRun | null;
  /** The last click, stroke or drag: sleep waits for a long quiet. */
  lastInteraction: number;
  /** When an idle mascot picks its next small action. */
  nextIdle: number;
  task: MascotTask;
  /** The window is away (flying out, parked at the screen edge, or flying back). */
  away: boolean;
  /** How the mascot lands when it comes back. */
  returnAs: "celebrate" | "sad" | null;
  memory: SchedulerMemory;
  /** Free px to the left and right of the window on its screen; null where unknown. */
  room: { left: number; right: number } | null;
  /** Recent clicks and strokes (for "too many clicks: angry", "many strokes: love"). */
  plays: number[];
  pets: number[];
  lastEmote: TimedClip | null;
  lastStartle: number;
  lastGreet: number;
  /** Since when the pointer rests near the owl; null when it is away or moving. */
  stillSince: number | null;
}

export interface MascotOptions {
  reduced: boolean;
  /** The "Fly away during tasks" setting. */
  flyAway: boolean;
  /** The window can be moved by the mascot (a desktop window; not the in-app overlay). */
  canMove: boolean;
  random: () => number;
  /** The "Activity level" setting; normal when absent. */
  liveliness?: Liveliness;
  /** The mood, 0..1 (mood.ts); content when absent. */
  mood?: number;
}

export type MascotInput =
  | { type: "tick"; now: number }
  | { type: "play"; now: number }
  | { type: "pet"; now: number }
  | { type: "drag"; now: number; on: boolean }
  | { type: "task"; now: number; task: MascotTask }
  /** A flight or a move the window was asked for has ended. */
  | { type: "arrived"; now: number }
  /** The pointer: its distance from the owl and its speed (px, px/s); null distance when unknown. */
  | { type: "cursor"; now: number; distance: number | null; speed: number }
  /** Free px around the window on its screen. */
  | { type: "room"; now: number; left: number; right: number };

export type MascotEffect =
  | { type: "flyOut"; delay: number }
  | { type: "flyHome" }
  /** Move along the desk: dx px, over ms, walking or flying (after a take-off of `delay` ms). */
  | { type: "wander"; dx: number; ms: number; style: "walk" | "fly"; delay: number }
  /** Cancel a move in progress (a drag took over). */
  | { type: "halt" }
  | { type: "hearts" }
  | { type: "sparkles" };

export const MASCOT_MS = {
  /** A flight that never reports its arrival is over after this long anyway. */
  flight: 5000,
  /** Every clip started by the person or the pointer lasts at least this long. */
  dwell: 400,
  /** Two clips cross-fade over this long. */
  blend: 240,
  /** A startle and a greeting are not repeated within these. */
  startleCooldown: 12_000,
  greetCooldown: 45_000,
  /** The pointer resting near the owl this long earns a wave. */
  greetAfter: 1500,
  idleMin: 3500,
} as const;

/** The clips a click picks from; under reduced motion, only the quiet ones. */
export const PLAY_POOL: readonly TimedClip[] = ["spin", "backflip", "wave", "dance", "jump"];
const PLAY_POOL_REDUCED: readonly TimedClip[] = ["wave", "love"];
/** Near enough (px) for the owl to notice the pointer; fast enough (px/s) to startle it. */
const NEAR = 220;
const STARTLE_SPEED = 2200;
const STILL_SPEED = 40;

/** Clips an idle owl is doing on its own: the pointer and the person may interrupt them. */
const IDLE_LIKE = new Set<MascotActivity>(["idle", "look", "lookBack", "tilt", "bob", "preen", "peck", "scratch", "doubleBlink", "wink", "think", "confused", "wingStretch", "hoot"]);

export function newMascotState(now: number, task: MascotTask = "idle"): MascotState {
  return {
    activity: "idle",
    since: now,
    facing: 1,
    variant: 0,
    moveMs: 0,
    until: null,
    after: null,
    prev: null,
    lastInteraction: now,
    nextIdle: now + MASCOT_MS.idleMin,
    task,
    away: false,
    returnAs: null,
    memory: newSchedulerMemory(),
    room: null,
    plays: [],
    pets: [],
    lastEmote: null,
    lastStartle: -Infinity,
    lastGreet: -Infinity,
    stillSince: null,
  };
}

const liveliness = (options: MascotOptions): Liveliness => options.liveliness ?? "normal";
const moodOf = (options: MascotOptions) => options.mood ?? 0.6;

function become(state: MascotState, activity: MascotActivity, now: number, options: MascotOptions, extra: Partial<MascotState> = {}): MascotState {
  const until = isTimed(activity) ? now + CLIP_MS[activity] : null;
  const prev: ClipRun = { activity: state.activity, since: state.since, facing: state.facing, variant: state.variant, moveMs: state.moveMs };
  return { ...state, prev, activity, since: now, until, after: null, variant: options.random(), moveMs: 0, ...extra };
}

function rest(state: MascotState, now: number, options: MascotOptions): MascotState {
  // a bot still working in place keeps its working look
  const activity: MascotActivity = state.task === "working" && !state.away ? "working" : "idle";
  const gap = idleGapMs({ liveliness: liveliness(options), mood: moodOf(options), reduced: options.reduced, random: options.random });
  return become(state, activity, now, options, { nextIdle: now + gap });
}

/** The mascot takes the window away while its bot works; reduced motion keeps it home. */
const flies = (options: MascotOptions) => options.flyAway && !options.reduced;

/** The nearest screen side, which a flight out heads for (the same rule as pilot.ts edgeTarget). */
const nearestSide = (room: MascotState["room"], fallback: 1 | -1): 1 | -1 => (room ? (room.left < room.right ? -1 : 1) : fallback);

type Step = { state: MascotState; effects: MascotEffect[] };
const same = (state: MascotState): Step => ({ state, effects: [] });

function onTask(state: MascotState, task: MascotTask, now: number, options: MascotOptions): Step {
  if (task === state.task) return same(state);
  const next = { ...state, task };
  if (task === "working") {
    if (flies(options) && !state.away) {
      // stretch the wings, crouch, take off toward the nearest edge
      const facing = nearestSide(state.room, state.facing);
      const flight = become(next, "flyOut", now, options, { away: true, facing, moveMs: TAKEOFF_MS + 1400, until: now + MASCOT_MS.flight });
      return { state: flight, effects: [{ type: "flyOut", delay: TAKEOFF_MS }] };
    }
    if (state.away) return same(next);
    return { state: become(next, "working", now, options), effects: state.activity === "walk" || state.activity === "fly" ? [{ type: "halt" }] : [] };
  }
  // the work ended: back home, happy, sad, or simply ready for the approval
  const returnAs = task === "error" ? "sad" : task === "idle" && state.task === "working" ? "celebrate" : null;
  if (state.away) {
    const facing: 1 | -1 = state.facing === 1 ? -1 : 1;
    return {
      state: become(next, "return", now, options, { returnAs, facing, moveMs: 1400, until: now + MASCOT_MS.flight }),
      effects: [{ type: "flyHome" }],
    };
  }
  if (returnAs === "celebrate") return { state: become(next, "celebrate", now, options), effects: [{ type: "sparkles" }] };
  if (returnAs === "sad") return same(become(next, "sad", now, options));
  return same(rest(next, now, options));
}

function land(state: MascotState, now: number, options: MascotOptions): Step {
  if (state.activity === "flyOut") return same(become(state, "working", now, options));
  if (state.activity === "return") {
    // touch down, then celebrate or droop
    const home = { ...state, away: false, returnAs: null };
    const after: MascotActivity | null = state.returnAs === "celebrate" ? "celebrate" : state.returnAs === "sad" ? "sad" : null;
    return same(become(home, "land", now, options, { after, facing: 1 }));
  }
  if (state.activity === "fly") return same(become(state, "land", now, options));
  if (state.activity === "walk") return same(rest(state, now, options));
  return same(state);
}

/** An idle mascot picks something small to do. */
function idleAction(state: MascotState, now: number, options: MascotOptions): Step {
  const pick = pickIdleAction(state.memory, now, {
    liveliness: liveliness(options),
    mood: moodOf(options),
    reduced: options.reduced,
    canMove: options.canMove,
    random: options.random,
  });
  const gap = idleGapMs({ liveliness: liveliness(options), mood: moodOf(options), reduced: options.reduced, random: options.random });
  const remembered = { ...state, memory: pick.memory, nextIdle: now + gap };
  const action = pick.action;
  if (!action) return same(remembered);
  if (action.choice.kind === "clip") return same(become(remembered, action.choice.clip, now, options));
  if (action.choice.kind === "turn") {
    return same(become(remembered, "turn", now, options, { facing: state.facing === 1 ? -1 : 1 }));
  }
  const style = action.choice.style;
  const direction = chooseDirection(state.room, options.random);
  if (direction === 0) return same(become(remembered, "hop", now, options));
  const room = state.room ? (direction === 1 ? state.room.right : state.room.left) : 240;
  const distance = moveDistance(style, room, options.random);
  if (distance < 40) return same(become(remembered, "hop", now, options));
  const delay = style === "fly" ? TAKEOFF_MS : 0;
  const ms = moveDuration(style, distance, delay);
  return {
    state: become(remembered, style, now, options, { facing: direction, moveMs: ms, until: now + ms + MASCOT_MS.flight }),
    effects: [{ type: "wander", dx: direction * distance, ms: ms - delay, style, delay }],
  };
}

/** Too soon after a clip the person or the pointer started: no new one yet. */
const dwelling = (state: MascotState, now: number) => now - state.since < MASCOT_MS.dwell && state.activity !== "idle";
const recent = (times: number[], now: number, window: number) => times.filter((at) => now - at < window);

function onPlay(state: MascotState, now: number, options: MascotOptions): Step {
  if (state.away || state.activity === "drag" || state.activity === "walk" || state.activity === "fly") return same(state);
  const plays = [...recent(state.plays, now, 4000), now];
  const base = { ...state, plays, lastInteraction: now };
  if (state.activity === "sleep" || state.activity === "yawn") return same(become(base, "wake", now, options));
  if (dwelling(state, now)) return same(base);
  // a flurry of clicks makes it cross; otherwise a joyful emote, not the same twice
  if (plays.length >= 4 && !options.reduced) return { state: become({ ...base, plays: [] }, "angry", now, options), effects: [] };
  const pool = (options.reduced ? PLAY_POOL_REDUCED : PLAY_POOL).filter((clip) => clip !== state.lastEmote);
  const emote = pool[Math.min(pool.length - 1, Math.floor(options.random() * pool.length))];
  return { state: become({ ...base, lastEmote: emote }, emote, now, options), effects: [{ type: "hearts" }] };
}

function onPet(state: MascotState, now: number, options: MascotOptions): Step {
  if (state.away || state.activity === "drag" || state.activity === "walk" || state.activity === "fly") return same(state);
  const pets = [...recent(state.pets, now, 6000), now];
  const base = { ...state, pets, lastInteraction: now };
  if (state.activity === "sleep") return { state: become(base, "petted", now, options), effects: [] };
  if (dwelling(state, now) || state.activity === "petted" || state.activity === "love") return same(base);
  if (pets.length >= 3) return { state: become({ ...base, pets: [] }, "love", now, options), effects: [{ type: "hearts" }] };
  return { state: become(base, "petted", now, options), effects: [{ type: "hearts" }] };
}

function onCursor(state: MascotState, input: Extract<MascotInput, { type: "cursor" }>, options: MascotOptions): Step {
  const { now, distance, speed } = input;
  const near = distance !== null && distance < NEAR;
  const still = near && speed < STILL_SPEED;
  const stillSince = still ? (state.stillSince ?? now) : null;
  const next = { ...state, stillSince };
  if (!IDLE_LIKE.has(state.activity) || state.away || dwelling(state, now)) return same(next);
  if (near && speed > STARTLE_SPEED && now - state.lastStartle > MASCOT_MS.startleCooldown && !options.reduced) {
    return same(become({ ...next, lastStartle: now }, "startled", now, options));
  }
  if (stillSince !== null && now - stillSince >= MASCOT_MS.greetAfter && now - state.lastGreet > MASCOT_MS.greetCooldown) {
    return same(become({ ...next, lastGreet: now, stillSince: null }, "wave", now, options));
  }
  return same(next);
}

/** One input in, the next state and what the window should do about it out. */
export function stepMascot(state: MascotState, input: MascotInput, options: MascotOptions): Step {
  const { now } = input;
  switch (input.type) {
    case "task":
      return onTask(state, input.task, now, options);
    case "arrived":
      return land(state, now, options);
    case "play":
      return onPlay(state, now, options);
    case "pet":
      return onPet(state, now, options);
    case "cursor":
      return onCursor(state, input, options);
    case "room":
      return same({ ...state, room: { left: Math.max(0, input.left), right: Math.max(0, input.right) } });
    case "drag": {
      if (state.away) return same(state);
      if (input.on) {
        const effects: MascotEffect[] = state.activity === "walk" || state.activity === "fly" ? [{ type: "halt" }] : [];
        return { state: become({ ...state, lastInteraction: now }, "drag", now, options), effects };
      }
      if (state.activity !== "drag") return same(state);
      return same(become({ ...state, lastInteraction: now }, "land", now, options));
    }
    case "tick": {
      if (state.until !== null && now >= state.until) {
        // a flight or a move that never reported back ends anyway
        if (["flyOut", "return", "walk", "fly"].includes(state.activity)) return land(state, now, options);
        if (state.after) return same(become(state, state.after, now, options));
        if (state.activity === "yawn") return same(become(state, "sleep", now, options));
        return same(rest(state, now, options));
      }
      if (state.activity !== "idle") return same(state);
      if (state.task === "idle" && now - state.lastInteraction >= sleepAfterMs(liveliness(options), moodOf(options))) {
        return same(become(state, "yawn", now, options));
      }
      if (now >= state.nextIdle) return idleAction(state, now, options);
      return same(state);
    }
    default:
      return same(state);
  }
}

/** How fast to draw: smoothly while it moves, slower at rest, slower still asleep. */
export function mascotFrameRate(activity: MascotActivity, hovered: boolean, reduced: boolean): number {
  if (activity === "working" || activity === "sleep") return reduced ? 10 : 12;
  const busy = hovered || activity !== "idle";
  if (reduced) return busy ? 30 : 20;
  return busy ? 60 : 30;
}

/* ----------------------------------------------------------------- motion */

/** The pose the brain asked for (the balloon's state), on top of the mascot's own life. */
export type MascotPose = "idle" | "think" | "speak" | "celebrate" | "alert" | "sleep";

export interface MascotMotionContext {
  now: number;
  pose: MascotPose;
  reduced: boolean;
  /** Where the pointer is, -1..1 each way from the owl's face; null when unknown. */
  gaze: { x: number; y: number } | null;
  /** 0..1: the ear tufts perk up when happy, droop when low. */
  mood?: number;
}

const TAU = Math.PI * 2;

/** A natural blink: a quick close every few seconds, sometimes twice. */
export function blinkAt(now: number): number {
  const period = 4300;
  const t = ((now % period) + period) % period;
  const once = t < 150 ? Math.sin((t / 150) * Math.PI) : 0;
  const twice = Math.floor(now / period) % 3 === 0 && t > 260 && t < 410 ? Math.sin(((t - 260) / 150) * Math.PI) : 0;
  return Math.max(once, twice);
}

type RunLike = Pick<ClipRun, "activity" | "since" | "facing"> & Partial<Pick<ClipRun, "variant" | "moveMs">>;

/** One clip's whole frame: the breathing, blinking owl, the brain's pose, after the clip on top. */
function runFrame(run: RunLike, context: MascotMotionContext): MascotFrame {
  const { now, pose, reduced, gaze } = context;
  const calm = reduced ? 0.35 : 1;
  const breath = Math.sin((now / 1000) * TAU * 0.28);
  const base: MascotFrame = {
    ...REST,
    y: 0.02 * breath * calm,
    squash: 1 + 0.015 * breath * calm,
    headYaw: gaze ? gaze.x * 0.7 : 0,
    headPitch: gaze ? -gaze.y * 0.3 : 0,
    lid: blinkAt(now),
    pupilX: gaze ? gaze.x : 0,
    pupilY: gaze ? -gaze.y : 0,
    tufts: ((context.mood ?? 0.6) - 0.5) * 1.2,
    face: run.facing,
  };
  // the brain's pose first: the balloon's mood
  if (pose === "think") Object.assign(base, { headTilt: 0.22, headPitch: 0.2, pupilX: 0.5, pupilY: 0.7 });
  else if (pose === "speak") Object.assign(base, { beak: reduced ? 0.3 : 0.25 + 0.25 * Math.sin((now / 1000) * TAU * 3), y: base.y + 0.02 });
  else if (pose === "alert") Object.assign(base, { wing: 0.25, lid: 0, eyeScale: 1.15, tufts: 1 });
  else if (pose === "sleep") base.lid = 1;

  const clip = clipPose(run.activity, { elapsed: Math.max(0, now - run.since), now, moveMs: run.moveMs ?? 0, variant: run.variant ?? 0, reduced });
  const frame = { ...base } as unknown as Record<string, number>;
  for (const [key, value] of Object.entries(clip)) {
    if (typeof value !== "number") continue;
    if (key === "y") frame.y = base.y + value;
    else if (key === "lid") frame.lid = Math.max(base.lid, value);
    else frame[key] = value;
  }
  return frame as unknown as MascotFrame;
}

/** How the owl moves at this instant: the current clip, cross-faded from the previous one. */
export function mascotMotion(state: RunLike & { prev?: ClipRun | null }, context: MascotMotionContext): MascotFrame {
  const current = runFrame(state, context);
  const previous = state.prev;
  if (!previous) return current;
  const w = Math.min(1, Math.max(0, (context.now - state.since) / MASCOT_MS.blend));
  if (w >= 1) return current;
  return blendFrames(runFrame(previous, context), current, easeInOut(w));
}

/* -------------------------------------------------------------- smoothing */

/** Parts that follow the pointer: eased toward their target so a jumpy pointer never shakes the owl. */
const SMOOTHED = ["headYaw", "headPitch", "headTilt", "pupilX", "pupilY", "sway", "x", "face"] as const;
const SMOOTH_MS = 110;
/** No step longer than this, so a frame after a pause never overshoots. */
const MAX_DT = 1000 / 30;

/** A first-order (never overshooting) smoother for a stream of frames, with a clamped step. */
export function createFrameSmoother() {
  let shown: MascotFrame | null = null;
  let last = 0;
  return (target: MascotFrame, now: number): MascotFrame => {
    if (!shown) {
      shown = target;
      last = now;
      return target;
    }
    const dt = Math.min(MAX_DT, Math.max(0, now - last));
    last = now;
    const k = 1 - Math.exp(-dt / SMOOTH_MS);
    const next = { ...target };
    for (const key of SMOOTHED) {
      const from = shown[key] ?? (REST[key] as number);
      const to = target[key] ?? (REST[key] as number);
      next[key] = from + (to - from) * k;
    }
    shown = next;
    return next;
  };
}
