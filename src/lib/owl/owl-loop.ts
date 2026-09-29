// One requestAnimationFrame loop for every animated owl on the page. Each
// OwlAvatar registers a controller that writes CSS transforms straight onto
// its SVG groups (via refs): no React state changes per frame. Static owls
// (animated=false) never register, so a long sidebar costs nothing.

import {
  OWL_GEOM,
  eyesTransform,
  gazeToOffset,
  lidTransform,
  owlPose,
  pupilTransform,
  rigTransform,
  wingTransform,
  type OwlState,
} from "./owl-art";

export interface OwlRigElements {
  rig: SVGGElement;
  nearWing: SVGGElement;
  eyes: SVGGElement;
  pupil: SVGGElement;
  lids: SVGGElement;
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
}

const running = new Set<Driven>();
let rafId = 0;
let reduceMQ: MediaQueryList | null = null;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  reduceMQ ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return reduceMQ.matches;
}

function frame(now: number) {
  for (const c of running) c.tick(now / 1000);
  rafId = running.size ? requestAnimationFrame(frame) : 0;
}

function start(c: Driven) {
  running.add(c);
  if (!rafId && typeof requestAnimationFrame === "function") rafId = requestAnimationFrame(frame);
}

function stop(c: Driven) {
  running.delete(c);
  if (!running.size && rafId && typeof cancelAnimationFrame === "function") {
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
  const gaze: Offset = { ...OWL_GEOM.gazeRest };

  const driven: Driven = {
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
      const pose = owlPose(state, now - t0, !oneShot, hop);
      if (pose.done) {
        beat = null;
        t0 = now;
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
      if (reduce) {
        const g = pinned ?? gazeToOffset(pose.gaze);
        gaze.x = g.x;
        gaze.y = g.y;
        el.rig.style.transform = "";
        el.nearWing.style.transform = "";
        el.eyes.style.transform = state === "alert" ? eyesTransform(1.15) : "";
      } else {
        const target = pointer ?? pinned ?? gazeToOffset(pose.gaze);
        const k = 1 - Math.exp(-dt * (pointer ? 14 : 6));
        gaze.x += (target.x - gaze.x) * k;
        gaze.y += (target.y - gaze.y) * k;
        el.rig.style.transform = rigTransform(pose);
        el.nearWing.style.transform = wingTransform(pose.wing);
        el.eyes.style.transform = eyesTransform(pose.eyeScale);
      }
      el.pupil.style.transform = pupilTransform(gaze);
      el.lids.style.transform = lidTransform(lid);
    },
  };

  start(driven);

  return {
    setState(state) {
      if (state === base) return;
      base = state;
      if (!beat) beatPending = true;
    },
    play(state, durationMs = 1400) {
      beat = { state, untilMs: ONE_SHOTS.has(state) ? null : durationMs };
      beatPending = true;
    },
    blink() {
      blinkPending = true;
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
    },
    destroy() {
      stop(driven);
    },
  };
}
