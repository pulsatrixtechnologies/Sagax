// One clock for every animated owl on the page. Each OwlAvatar registers a
// controller that writes CSS transforms straight onto its SVG groups (via
// refs): no React state changes per frame. Static owls (animated=false)
// never register, so a resting sidebar costs nothing.
//
// Working, a wing move, a blink, and the shake of an unread face run on
// requestAnimationFrame. A resting pose (a breath, or an unread face that
// has finished its shake) waits on a short timer instead, so a sidebar of
// unread owls does not repaint the glass bars at the display rate.

import { animationsPaused, resetAnimationPauseForTests, watchAnimationPause } from "../animation-pause";
import {
  OWL_GEOM,
  eyesTransform,
  farWingOpacity,
  farWingTransform,
  owlWingPose,
  gazeToOffset,
  lidTransform,
  owlPose,
  pupilTransform,
  rigTransform,
  wingTransform,
  type OwlState,
  type OwlWingMove,
} from "./owl-art";

export interface OwlRigElements {
  rig: SVGGElement;
  nearWing: SVGGElement;
  eyes: SVGGElement;
  pupil: SVGGElement;
  lids: SVGGElement;
  /** The far wing, behind the body; hidden while the wings are folded. */
  farWing?: SVGGElement | null;
  /** Layers behind the body that follow the near wing (its rim). */
  nearWingBack?: SVGGElement | null;
}

type Offset = { x: number; y: number };

export interface OwlController {
  /** The continuous state the owl returns to (idle/thinking/working/sleepy). */
  setState(state: OwlState): void;
  /**
   * Play a state for a moment. success and alert run once (their own length);
   * the others hold for `durationMs`. Then the continuous state resumes.
   */
  play(state: OwlState, durationMs?: number): void;
  blink(): void;
  /** Open the wings for one move (spread, flap, take off...). Ignored under reduced motion. */
  flourish(move: OwlWingMove): void;
  /** Pointer-driven pupil offset (viewBox units), or null when the pointer left. */
  setPointer(offset: Offset | null): void;
  /** A caller-pinned pupil offset (viewBox units), or null for the state's own. */
  setPinnedGaze(offset: Offset | null): void;
  setHop(hop: number): void;
  /** Force reduced motion on/off; undefined follows the OS setting. */
  setReducedMotion(value: boolean | undefined): void;
  destroy(): void;
}

interface Driven {
  tick(now: number): void;
  /** The last tick needed a display-rate frame (motion that would alias at 12Hz). */
  fullRate: boolean;
}

/** Resting poses do not need a display-rate clock. The gap leaves room for
 * one vsync, so the next paint lands near 12Hz. */
const REST_FRAME_GAP_MS = 70;

const running = new Set<Driven>();
let rafId = 0;
let slowTimer: ReturnType<typeof setTimeout> | 0 = 0;
let reduceMQ: MediaQueryList | null = null;
let pauseUnsub: (() => void) | null = null;

function clearSlow() {
  if (!slowTimer) return;
  clearTimeout(slowTimer);
  slowTimer = 0;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  reduceMQ ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return reduceMQ.matches;
}

function frame(now: number) {
  // A hidden or minimized window must not keep the frame clock.
  if (animationsPaused()) {
    rafId = 0;
    return;
  }
  for (const c of running) c.tick(now / 1000);
  rafId = 0;
  if (!running.size) return;
  let full = false;
  for (const c of running) if (c.fullRate) full = true;
  if (full) kick();
  else scheduleSlow();
}

function scheduleSlow() {
  if (animationsPaused() || rafId || slowTimer || !running.size) return;
  slowTimer = setTimeout(() => {
    slowTimer = 0;
    kick();
  }, REST_FRAME_GAP_MS);
}

function kick() {
  if (animationsPaused() || rafId || !running.size) return;
  clearSlow();
  if (typeof requestAnimationFrame !== "function") return;
  rafId = requestAnimationFrame(frame);
}

function ensurePauseWatch() {
  if (pauseUnsub || typeof document === "undefined") return;
  pauseUnsub = watchAnimationPause(() => {
    if (animationsPaused()) {
      if (rafId && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      clearSlow();
      return;
    }
    kick();
  });
}

function start(c: Driven) {
  running.add(c);
  ensurePauseWatch();
  kick();
}

function stop(c: Driven) {
  running.delete(c);
  if (running.size) return;
  if (rafId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  clearSlow();
}

/** Drops the pause subscription. Tests call this between cases. */
export function resetOwlLoopForTests(): void {
  pauseUnsub?.();
  pauseUnsub = null;
  resetAnimationPauseForTests();
  reduceMQ = null;
  clearSlow();
  if (rafId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

/** How many owls the shared loop is driving (for tests and diagnostics). */
export function runningOwlCount(): number {
  return running.size;
}

const ONE_SHOTS = new Set<OwlState>(["success", "alert"]);

export function createOwlController(
  el: OwlRigElements,
  opts: { state?: OwlState; hop?: number; pinnedGaze?: Offset | null; reducedMotion?: boolean } = {},
): OwlController {
  let base: OwlState = opts.state ?? "idle";
  let hop = opts.hop ?? 1;
  let forcedReduce = opts.reducedMotion;
  let pinned: Offset | null = opts.pinnedGaze ?? null;
  let pointer: Offset | null = null;

  // the transient beat, if any: a one-shot or a held state with a deadline
  let beat: { state: OwlState; untilMs: number | null } | null = null;
  let beatPending = false;
  let t0: number | null = null;
  let last: number | null = null;
  let nextBlink = 0;
  let blinkStart = -1;
  let blinkPending = false;
  let wingMove: { move: OwlWingMove; start: number | null } | null = null;
  let farShown = false;
  const gaze: Offset = { ...OWL_GEOM.gazeRest };

  const driven: Driven = {
    fullRate: false,
    tick(now) {
      if (t0 === null || beatPending) {
        t0 = now;
        beatPending = false;
      }
      if (!nextBlink) nextBlink = now + 1 + Math.random() * 4;
      if (blinkPending) {
        blinkStart = now;
        blinkPending = false;
      }
      const dt = last === null ? 0 : Math.min(0.1, now - last);
      last = now;

      if (beat?.untilMs != null && (now - t0) * 1000 >= beat.untilMs) {
        beat = null;
        t0 = now;
      }
      const state = beat?.state ?? base;
      const oneShot = beat != null && ONE_SHOTS.has(beat.state);
      const elapsed = now - t0;
      // Unread faces shake for the first part of the alert cycle, then hold.
      // Only the shake needs a display-rate clock.
      const alertPhase = state === "alert" ? (oneShot ? elapsed : elapsed % 1.8) : 1;
      const pose = owlPose(state, elapsed, !oneShot, hop);
      let paintAgain = false;
      if (pose.done) {
        beat = null;
        t0 = now;
        paintAgain = true;
      }
      if (wingMove) {
        wingMove.start ??= now;
        const w = owlWingPose(wingMove.move, now - wingMove.start, hop);
        if (w.done) wingMove = null;
        else {
          pose.open = Math.max(pose.open, w.open);
          pose.wing += w.flap;
          pose.x += w.x;
          pose.y += w.y;
          pose.sy *= w.sy;
        }
      }

      // Blink every 3-6 s (slower when sleepy). Kept under reduced motion.
      if (now >= nextBlink) {
        blinkStart = now;
        nextBlink = now + (state === "sleepy" ? 4 + Math.random() * 3 : 3 + Math.random() * 3);
      }
      const blinkDur = state === "sleepy" ? 0.45 : 0.16;
      const blinkAmt =
        blinkStart >= 0 && now - blinkStart < blinkDur ? Math.sin((Math.PI * (now - blinkStart)) / blinkDur) : 0;
      const lid = Math.max(pose.lid, blinkAmt);

      const reduce = forcedReduce ?? prefersReducedMotion();
      const writeTransform = (style: CSSStyleDeclaration, value: string) => {
        if (style.transform !== value) style.transform = value;
      };
      if (reduce) {
        const g = pinned ?? gazeToOffset(pose.gaze);
        gaze.x = g.x;
        gaze.y = g.y;
        wingMove = null;
        writeTransform(el.rig.style, "");
        writeTransform(el.nearWing.style, "");
        if (el.nearWingBack) writeTransform(el.nearWingBack.style, "");
        if (farShown && el.farWing) {
          if (el.farWing.style.opacity !== "0") el.farWing.style.opacity = "0";
          farShown = false;
        }
        writeTransform(el.eyes.style, state === "alert" ? eyesTransform(1.15) : "");
      } else {
        const target = pointer ?? pinned ?? gazeToOffset(pose.gaze);
        const k = 1 - Math.exp(-dt * (pointer ? 14 : 6));
        gaze.x += (target.x - gaze.x) * k;
        gaze.y += (target.y - gaze.y) * k;
        writeTransform(el.rig.style, rigTransform(pose));
        writeTransform(el.nearWing.style, wingTransform(pose.wing, pose.open));
        if (el.nearWingBack) writeTransform(el.nearWingBack.style, el.nearWing.style.transform);
        if (el.farWing && (pose.open > 0 || farShown)) {
          // only touched while the wings are (or were just) out
          writeTransform(el.farWing.style, farWingTransform(pose.wing, pose.open));
          const opacity = String(farWingOpacity(pose.open));
          if (el.farWing.style.opacity !== opacity) el.farWing.style.opacity = opacity;
          farShown = pose.open > 0;
        }
        writeTransform(el.eyes.style, eyesTransform(pose.eyeScale));
      }
      writeTransform(el.pupil.style, pupilTransform(gaze));
      writeTransform(el.lids.style, lidTransform(lid));
      const blinking = blinkStart >= 0 && now - blinkStart < blinkDur;
      // A 12Hz shake or a 6Hz wing flap aliases if the whole sidebar is paced
      // down. Breathing and a held unread face do not.
      driven.fullRate = !reduce && (
        paintAgain
        || state === "working"
        || state === "success"
        || wingMove !== null
        || blinking
        || (state === "alert" && alertPhase < 0.65)
      );
    },
  };

  // Reduced motion keeps the blink and drops the body. A 60 fps loop that
  // only writes the lids is the same idle cost as the full pose.
  let destroyed = false;
  let blinkTimer: ReturnType<typeof setTimeout> | 0 = 0;
  let blinkRaf = 0;
  const reduced = () => forcedReduce ?? prefersReducedMotion();

  const clearBlinkSchedule = () => {
    if (blinkTimer) {
      clearTimeout(blinkTimer);
      blinkTimer = 0;
    }
    if (blinkRaf && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(blinkRaf);
      blinkRaf = 0;
    }
  };

  const scheduleReducedBlink = (delayMs: number) => {
    if (destroyed || !reduced()) return;
    if (blinkTimer) clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => {
      blinkTimer = 0;
      if (destroyed) return;
      blinkPending = true;
      runReducedBlink();
    }, delayMs);
  };

  const runReducedBlink = () => {
    if (destroyed) return;
    if (!reduced()) {
      clearBlinkSchedule();
      start(driven);
      return;
    }
    if (animationsPaused()) {
      scheduleReducedBlink(1000);
      return;
    }
    if (typeof requestAnimationFrame !== "function") return;
    if (blinkRaf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(blinkRaf);
    let started: number | null = null;
    const dur = (base === "sleepy" ? 0.45 : 0.16) * 1000 + 40;
    const step = (ms: number) => {
      blinkRaf = 0;
      if (destroyed) return;
      if (animationsPaused()) {
        scheduleReducedBlink(1000);
        return;
      }
      if (!reduced()) {
        start(driven);
        return;
      }
      if (started === null) started = ms;
      driven.tick(ms / 1000);
      if (ms - started < dur) blinkRaf = requestAnimationFrame(step);
      else scheduleReducedBlink((base === "sleepy" ? 4 : 3) * 1000 + Math.random() * 3000);
    };
    blinkRaf = requestAnimationFrame(step);
  };

  if (reduced()) scheduleReducedBlink(1000 + Math.random() * 4000);
  else start(driven);

  return {
    setState(state) {
      if (state === base) return;
      base = state;
      if (!beat) beatPending = true;
      // No frame loop under reduced motion, so a state change paints once.
      if (reduced()) driven.tick((typeof performance !== "undefined" ? performance.now() : 0) / 1000);
      else kick();
    },
    play(state, durationMs = 1400) {
      beat = { state, untilMs: ONE_SHOTS.has(state) ? null : durationMs };
      beatPending = true;
      if (reduced()) driven.tick((typeof performance !== "undefined" ? performance.now() : 0) / 1000);
      else kick();
    },
    blink() {
      blinkPending = true;
      if (!reduced()) {
        kick();
        return;
      }
      clearBlinkSchedule();
      runReducedBlink();
    },
    flourish(move) {
      if (reduced()) return;
      wingMove = { move, start: null };
      // A resting owl may be waiting out its slow gap. Start the move now.
      kick();
    },
    setPointer(offset) {
      pointer = offset;
    },
    setPinnedGaze(offset) {
      pinned = offset;
    },
    setHop(value) {
      hop = value;
    },
    setReducedMotion(value) {
      forcedReduce = value;
      if (reduced()) {
        stop(driven);
        clearBlinkSchedule();
        scheduleReducedBlink(1000 + Math.random() * 4000);
      } else {
        clearBlinkSchedule();
        start(driven);
      }
    },
    destroy() {
      destroyed = true;
      clearBlinkSchedule();
      stop(driven);
    },
  };
}
