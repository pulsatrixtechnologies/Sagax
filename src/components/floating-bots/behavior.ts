// A floating mascot's own little life, kept pure so it can be tested without
// a DOM or a GPU: what it is doing now (idling, wandering, spinning, asleep,
// reacting to a click or a stroke, flying off while its bot works, coming
// back), and, frame by frame, how that moves its body. The floating window
// (FloatingBotView.tsx) feeds it ticks, clicks, strokes, drags and the task
// state the brain sends; it answers with a new state and a few effects (move
// the window away, bring it home, wander, show hearts). Nothing here punishes
// neglect: a lonely mascot only naps.

/** What the bot's work looks like from the window: the brain sends it in every snapshot. */
export type MascotTask = "idle" | "working" | "waiting" | "error";

export type MascotActivity =
  | "idle"
  | "look"
  | "wander"
  | "spin"
  | "hop"
  | "sleep"
  | "react"
  | "petted"
  | "drag"
  | "flyOut"
  | "working"
  | "return"
  | "celebrate"
  | "sad";

export interface MascotState {
  activity: MascotActivity;
  /** When the activity began (ms, the caller's clock). */
  since: number;
  /** When a timed activity ends by itself; null while it lasts until something happens. */
  until: number | null;
  /** The last click, stroke or drag: sleep waits for a long quiet. */
  lastInteraction: number;
  /** When an idle mascot picks its next small action. */
  nextIdle: number;
  task: MascotTask;
  /** The window is away (flying out, parked at the screen edge, or flying back). */
  away: boolean;
  /** How the mascot lands when it comes back. */
  returnAs: "celebrate" | "sad" | null;
  /** -1 faces left, 1 faces right (the way it last wandered). */
  facing: 1 | -1;
}

export interface MascotOptions {
  reduced: boolean;
  /** The "Fly away during tasks" setting. */
  flyAway: boolean;
  /** The window can be moved by the mascot (a desktop window; not the in-app overlay). */
  canMove: boolean;
  random: () => number;
}

export type MascotInput =
  | { type: "tick"; now: number }
  | { type: "play"; now: number }
  | { type: "pet"; now: number }
  | { type: "drag"; now: number; on: boolean }
  | { type: "task"; now: number; task: MascotTask }
  /** A flight or a wander the window was asked for has ended. */
  | { type: "arrived"; now: number };

export type MascotEffect =
  | { type: "flyOut" }
  | { type: "flyHome" }
  | { type: "wander"; dx: number }
  /** Cancel a wander in progress (a drag took over). */
  | { type: "halt" }
  | { type: "hearts" }
  | { type: "sparkles" };

export const MASCOT_MS = {
  spin: 1100,
  hop: 700,
  look: 1800,
  react: 1300,
  petted: 1600,
  celebrate: 1900,
  sad: 2600,
  /** A flight that never reports its arrival is over after this long anyway. */
  flight: 4000,
  wander: 5000,
  /** Quiet this long, with nothing to do, and the mascot naps. */
  sleepAfter: 120_000,
  idleMin: 3500,
  idleMax: 9000,
} as const;

const TIMED: Partial<Record<MascotActivity, number>> = {
  spin: MASCOT_MS.spin,
  hop: MASCOT_MS.hop,
  look: MASCOT_MS.look,
  react: MASCOT_MS.react,
  petted: MASCOT_MS.petted,
  celebrate: MASCOT_MS.celebrate,
  sad: MASCOT_MS.sad,
};

export function newMascotState(now: number, task: MascotTask = "idle"): MascotState {
  return {
    activity: "idle",
    since: now,
    until: null,
    lastInteraction: now,
    nextIdle: now + MASCOT_MS.idleMin,
    task,
    away: false,
    returnAs: null,
    facing: 1,
  };
}

const idleGap = (options: MascotOptions) => {
  const span = MASCOT_MS.idleMax - MASCOT_MS.idleMin;
  return (MASCOT_MS.idleMin + options.random() * span) * (options.reduced ? 2 : 1);
};

function become(state: MascotState, activity: MascotActivity, now: number, extra: Partial<MascotState> = {}): MascotState {
  const length = TIMED[activity];
  return { ...state, activity, since: now, until: length === undefined ? null : now + length, ...extra };
}

function rest(state: MascotState, now: number, options: MascotOptions): MascotState {
  // a bot still working in place keeps its working look
  const activity: MascotActivity = state.task === "working" && !state.away ? "working" : "idle";
  return { ...state, activity, since: now, until: null, nextIdle: now + idleGap(options) };
}

/** The mascot takes the window away while its bot works; reduced motion keeps it home. */
const flies = (options: MascotOptions) => options.flyAway && !options.reduced;

type Step = { state: MascotState; effects: MascotEffect[] };

function onTask(state: MascotState, task: MascotTask, now: number, options: MascotOptions): Step {
  if (task === state.task) return { state, effects: [] };
  const next = { ...state, task };
  if (task === "working") {
    if (flies(options) && !state.away) {
      return { state: become(next, "flyOut", now, { away: true, until: now + MASCOT_MS.flight }), effects: [{ type: "flyOut" }] };
    }
    if (state.away) return { state: next, effects: [] };
    return { state: become(next, "working", now), effects: state.activity === "wander" ? [{ type: "halt" }] : [] };
  }
  // the work ended: back home, happy, sad, or simply ready for the approval
  const returnAs = task === "error" ? "sad" : task === "idle" && state.task === "working" ? "celebrate" : null;
  if (state.away) {
    return { state: become(next, "return", now, { returnAs, until: now + MASCOT_MS.flight }), effects: [{ type: "flyHome" }] };
  }
  if (returnAs === "celebrate") return { state: become(next, "celebrate", now), effects: [{ type: "sparkles" }] };
  if (returnAs === "sad") return { state: become(next, "sad", now), effects: [] };
  return { state: rest(next, now, options), effects: [] };
}

function land(state: MascotState, now: number, options: MascotOptions): Step {
  if (state.activity === "flyOut") return { state: become(state, "working", now), effects: [] };
  if (state.activity === "return") {
    const home = { ...state, away: false, returnAs: null };
    if (state.returnAs === "celebrate") return { state: become(home, "celebrate", now), effects: [{ type: "sparkles" }] };
    if (state.returnAs === "sad") return { state: become(home, "sad", now), effects: [] };
    return { state: rest(home, now, options), effects: [] };
  }
  if (state.activity === "wander") return { state: rest(state, now, options), effects: [] };
  return { state, effects: [] };
}

/** An idle mascot picks something small to do. */
function pickIdle(state: MascotState, now: number, options: MascotOptions): Step {
  const roll = options.random();
  if (options.reduced) return { state: become(state, "look", now), effects: [] };
  if (roll < 0.35) return { state: become(state, "look", now), effects: [] };
  if (roll < 0.55) return { state: become(state, "spin", now), effects: [] };
  if (roll < 0.8 || !options.canMove) return { state: become(state, "hop", now), effects: [] };
  const sign: 1 | -1 = options.random() < 0.5 ? -1 : 1;
  const dx = Math.round(sign * (60 + options.random() * 120));
  return {
    state: become(state, "wander", now, { facing: sign, until: now + MASCOT_MS.wander }),
    effects: [{ type: "wander", dx }],
  };
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
    case "pet": {
      if (state.away || state.activity === "drag") return { state, effects: [] };
      const activity = input.type === "play" ? "react" : "petted";
      const effects: MascotEffect[] = [{ type: "hearts" }];
      if (state.activity === "wander") effects.unshift({ type: "halt" });
      return { state: become({ ...state, lastInteraction: now }, activity, now), effects };
    }
    case "drag": {
      if (state.away) return { state, effects: [] };
      if (input.on) {
        const effects: MascotEffect[] = state.activity === "wander" ? [{ type: "halt" }] : [];
        return { state: become({ ...state, lastInteraction: now }, "drag", now), effects };
      }
      if (state.activity !== "drag") return { state, effects: [] };
      return { state: become({ ...state, lastInteraction: now }, "hop", now), effects: [] };
    }
    case "tick": {
      if (state.until !== null && now >= state.until) {
        // a flight that never reported back lands anyway
        if (state.activity === "flyOut" || state.activity === "return" || state.activity === "wander") return land(state, now, options);
        return { state: rest(state, now, options), effects: [] };
      }
      if (state.activity !== "idle") return { state, effects: [] };
      if (state.task === "idle" && now - state.lastInteraction >= MASCOT_MS.sleepAfter) {
        return { state: become(state, "sleep", now), effects: [] };
      }
      if (now >= state.nextIdle) return pickIdle(state, now, options);
      return { state, effects: [] };
    }
    default:
      return { state, effects: [] };
  }
}

/** Whether the mascot is busy moving (draw at full speed) or resting (draw slowly). */
export function mascotFrameRate(activity: MascotActivity, hovered: boolean, reduced: boolean): number {
  if (activity === "working" || activity === "sleep") return reduced ? 10 : 12;
  const busy = hovered || !["idle", "look"].includes(activity);
  if (reduced) return busy ? 30 : 20;
  return busy ? 60 : 30;
}

/* ----------------------------------------------------------------- motion */

/** The pose the brain asked for (the balloon's state), on top of the mascot's own life. */
export type MascotPose = "idle" | "think" | "speak" | "celebrate" | "alert" | "sleep";

/** Where every moving part of the 3D owl stands at one instant. Angles in radians, lengths in owl units. */
export interface MascotFrame {
  /** Body lift (hops, flight, breathing). */
  y: number;
  /** Turn of the whole owl around its vertical axis. */
  spin: number;
  /** Lean forward (+) or back (-). */
  lean: number;
  /** Sideways sway. */
  sway: number;
  /** Vertical squash and stretch (1 = rest). */
  squash: number;
  /** Overall size (1 = rest; smaller as it flies off). */
  scale: number;
  headYaw: number;
  headPitch: number;
  headTilt: number;
  /** Wing lift, 0 folded to 1 raised. */
  wing: number;
  /** Eyelids, 0 open to 1 shut. */
  lid: number;
  pupilX: number;
  pupilY: number;
}

export interface MascotMotionContext {
  now: number;
  pose: MascotPose;
  reduced: boolean;
  /** Where the pointer is, -1..1 each way from the owl's face; null when unknown. */
  gaze: { x: number; y: number } | null;
}

const TAU = Math.PI * 2;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** A natural blink: a quick close every few seconds, sometimes twice. */
export function blinkAt(now: number): number {
  const period = 4300;
  const t = now % period;
  const once = t < 150 ? Math.sin((t / 150) * Math.PI) : 0;
  const twice = Math.floor(now / period) % 3 === 0 && t > 260 && t < 410 ? Math.sin(((t - 260) / 150) * Math.PI) : 0;
  return Math.max(once, twice);
}

/** How the owl moves for an activity, `now - state.since` into it. */
export function mascotMotion(state: Pick<MascotState, "activity" | "since" | "facing">, context: MascotMotionContext): MascotFrame {
  const { now, pose, reduced, gaze } = context;
  const elapsed = Math.max(0, now - state.since);
  const calm = reduced ? 0.35 : 1;
  const breath = Math.sin((now / 1000) * TAU * 0.28);
  const frame: MascotFrame = {
    y: 0.02 * breath * calm,
    spin: 0,
    lean: 0,
    sway: 0,
    squash: 1 + 0.015 * breath * calm,
    scale: 1,
    headYaw: gaze ? gaze.x * 0.7 : 0,
    headPitch: gaze ? -gaze.y * 0.3 : 0,
    headTilt: 0,
    wing: 0,
    lid: blinkAt(now),
    pupilX: gaze ? gaze.x : 0,
    pupilY: gaze ? -gaze.y : 0,
  };

  // the brain's pose first: the balloon's mood
  if (pose === "think") {
    frame.headTilt = 0.22;
    frame.headPitch = 0.2;
    frame.pupilX = 0.5;
    frame.pupilY = 0.7;
  } else if (pose === "speak") {
    frame.y += reduced ? 0 : 0.03 * Math.abs(Math.sin((now / 1000) * TAU * 2.2));
    frame.headPitch += 0.06 * Math.sin((now / 1000) * TAU * 2.2) * calm;
  } else if (pose === "alert") {
    frame.wing = 0.25;
    frame.lid = 0;
    frame.squash = 1.04;
    frame.headTilt = 0.1 * Math.sin((now / 1000) * TAU * 1.5) * calm;
  } else if (pose === "celebrate" && state.activity === "idle" && !reduced) {
    frame.y += 0.18 * Math.abs(Math.sin((now / 1000) * TAU * 1.4));
    frame.wing = 0.6 + 0.4 * Math.sin((now / 1000) * TAU * 6);
  } else if (pose === "sleep") {
    frame.lid = 1;
  }

  const t = (length: number) => clamp01(elapsed / length);
  const flap = (speed: number) => 0.5 + 0.5 * Math.sin((now / 1000) * TAU * speed);
  switch (state.activity) {
    case "look": {
      // a slow look around: one side, the other, back
      const p = t(MASCOT_MS.look);
      frame.headYaw = Math.sin(p * TAU) * 0.9 * calm;
      frame.headTilt = Math.sin(p * Math.PI) * 0.18 * calm;
      frame.pupilX = Math.sin(p * TAU);
      break;
    }
    case "spin": {
      const p = easeInOut(t(MASCOT_MS.spin));
      frame.spin = p * TAU;
      frame.y += Math.sin(p * Math.PI) * 0.25;
      frame.wing = Math.sin(p * Math.PI) * 0.7;
      frame.lid = Math.max(frame.lid, Math.sin(p * Math.PI) * 0.6);
      break;
    }
    case "hop": {
      const p = t(MASCOT_MS.hop);
      const arc = Math.sin(p * Math.PI);
      frame.y += arc * 0.3 * calm;
      frame.squash = p < 0.12 || p > 0.88 ? 0.9 : 1 + arc * 0.06;
      frame.wing = arc * 0.35;
      break;
    }
    case "wander": {
      frame.spin = state.facing * 0.9;
      frame.y += Math.abs(Math.sin((elapsed / 600) * Math.PI)) * 0.22;
      frame.wing = 0.2 + 0.3 * flap(3);
      frame.lean = 0.12;
      break;
    }
    case "react": {
      // a happy spin with a jump and wings up
      const p = t(MASCOT_MS.react);
      frame.spin = reduced ? 0 : easeInOut(clamp01(p / 0.75)) * TAU;
      frame.y += Math.sin(p * Math.PI) * 0.35 * calm;
      frame.wing = Math.sin(p * Math.PI);
      frame.lid = 0.55;
      frame.pupilY = 0;
      break;
    }
    case "petted": {
      // leans into the stroke, eyes half shut, a purring shiver
      const p = t(MASCOT_MS.petted);
      const into = Math.sin(p * Math.PI);
      frame.headTilt = 0.35 * into;
      frame.sway = 0.1 * into;
      frame.lid = 0.75 * into;
      frame.squash = 1 - 0.04 * into + (reduced ? 0 : 0.012 * Math.sin((now / 1000) * TAU * 14));
      break;
    }
    case "drag": {
      frame.wing = 0.4 + 0.6 * flap(5);
      frame.y += 0.05;
      frame.squash = 1.08;
      frame.lid = 0;
      frame.headPitch = -0.15;
      break;
    }
    case "sleep": {
      frame.lid = 1;
      frame.headTilt = 0.28;
      frame.headPitch = 0.25;
      frame.headYaw = 0;
      frame.y = 0.025 * Math.sin((now / 1000) * TAU * 0.18);
      frame.squash = 0.97 + 0.025 * Math.sin((now / 1000) * TAU * 0.18);
      break;
    }
    case "working": {
      // the in-place working look (no flight): pondering, an ear to the task
      frame.headTilt = 0.2;
      frame.pupilY = 0.6;
      frame.pupilX = Math.sin((now / 1000) * 0.8) * 0.6;
      break;
    }
    case "flyOut": {
      // wings beat hard, it rises and grows small
      const p = t(900);
      frame.wing = 0.4 + 0.6 * flap(6);
      frame.y += easeInOut(p) * (reduced ? 0 : 1.1);
      frame.scale = 1 - easeInOut(p) * 0.45;
      frame.lean = 0.25;
      frame.lid = 0;
      break;
    }
    case "return": {
      // drops back in, wings wide, then brakes
      const p = t(1000);
      frame.wing = 0.4 + 0.6 * flap(5);
      frame.y += (1 - easeInOut(p)) * 1.1;
      frame.scale = 0.55 + easeInOut(p) * 0.45;
      frame.lean = -0.15;
      frame.lid = 0;
      break;
    }
    case "celebrate": {
      const p = t(MASCOT_MS.celebrate);
      frame.y += Math.abs(Math.sin(p * Math.PI * 3)) * 0.28 * calm;
      frame.wing = 0.6 + 0.4 * flap(6) * calm;
      frame.spin = reduced ? 0 : easeInOut(clamp01((p - 0.35) / 0.4)) * TAU;
      frame.lid = 0.5;
      break;
    }
    case "sad": {
      frame.headPitch = 0.45;
      frame.headYaw = 0;
      frame.lid = 0.55;
      frame.pupilY = 1;
      frame.squash = 0.95;
      frame.wing = 0;
      frame.y = 0;
      break;
    }
    default:
      break;
  }
  return frame;
}
