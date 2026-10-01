// Reading the pointer over a floating mascot, kept pure for tests: a stroke
// (petting) is the pointer going back and forth over the owl, as the desktop
// window receives it (forwarded mouse moves while it lets clicks through,
// ordinary ones once it takes the pointer). No button is needed.

export interface StrokeState {
  /** When the current stroke began. */
  since: number;
  /** Pointer travel over the owl in this stroke, in px. */
  travel: number;
  /** Changes of horizontal direction in this stroke. */
  turns: number;
  /** The last horizontal direction moved (-1, 0, 1). */
  dir: -1 | 0 | 1;
  x: number;
  y: number;
  /** When the last pet was counted. */
  last: number;
}

/** A stroke this long at most... */
export const STROKE_WINDOW_MS = 1200;
/** ...with this many back-and-forths, or this much travel, is a pet. */
export const STROKE_TURNS = 2;
export const STROKE_TRAVEL = 220;
/** At most one pet this often. */
export const PET_EVERY_MS = 1800;
/** Moves smaller than this do not change direction (jitter). */
const JITTER = 3;

export const newStroke = (): StrokeState => ({ since: -Infinity, travel: 0, turns: 0, dir: 0, x: Number.NaN, y: Number.NaN, last: -Infinity });

/** One pointer move over the owl; returns the next state and whether it completed a pet. */
export function strokeStep(state: StrokeState, x: number, y: number, now: number): { state: StrokeState; pet: boolean } {
  let next: StrokeState = { ...state };
  if (now - next.since > STROKE_WINDOW_MS) next = { ...next, since: now, travel: 0, turns: 0, dir: 0 };
  if (Number.isFinite(next.x)) {
    const dx = x - next.x;
    next.travel += Math.hypot(dx, y - next.y);
    if (Math.abs(dx) >= JITTER) {
      const dir: -1 | 1 = dx > 0 ? 1 : -1;
      if (next.dir !== 0 && dir !== next.dir) next.turns += 1;
      next.dir = dir;
    }
  }
  next.x = x;
  next.y = y;
  const pet = (next.turns >= STROKE_TURNS || next.travel >= STROKE_TRAVEL) && now - next.last >= PET_EVERY_MS;
  if (pet) next = { ...next, last: now, since: now, travel: 0, turns: 0 };
  return { state: next, pet };
}

/** The pointer left the owl: the stroke is over, the cooldown stays. */
export const strokeLeave = (state: StrokeState): StrokeState => ({ ...newStroke(), last: state.last });

/* ------------------------------------------------------------- clicks */

/** A second click this soon after the first is a double click. */
export const DOUBLE_CLICK_MS = 250;

/** A click on the mascot: single, or the second of a double click. */
export function clickGesture(lastClickAt: number | null, now: number): "single" | "double" {
  return lastClickAt !== null && now - lastClickAt <= DOUBLE_CLICK_MS ? "double" : "single";
}

/**
 * What a click does, without waiting to know whether a second one comes: a
 * click opens (or closes) the chat balloon at once; the second click of a
 * double click puts the balloon away and opens the app on the bot's thread.
 */
export function eventsForClick(gesture: "single" | "double"): ({ type: "click" } | { type: "dismiss" } | { type: "open" })[] {
  return gesture === "single" ? [{ type: "click" }] : [{ type: "dismiss" }, { type: "open" }];
}

