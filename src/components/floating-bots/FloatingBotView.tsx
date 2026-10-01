// What a floating bot looks like: its mascot (a 3D owl in the bot's colour,
// or its picture) standing on the desktop or over the app, with a little life
// of its own (behavior.ts: it breathes, blinks, looks at the pointer, spins,
// hops, wanders, naps, reacts to clicks and strokes, flies off while its bot
// works), a speech balloon with a small input, and a right-click menu. It
// only draws a snapshot and reports what was clicked or typed; the brain
// (FloatingBots.tsx) decides everything else. The same view runs in a
// desktop window (FloatingBotWindow.tsx) and in the in-app overlay.
import "./floating-bots.css";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import { cn } from "@/lib/cn";
import type { OwlState } from "@/lib/owl/owl-art";
import { MAUS_COLORS } from "@/lib/mascot";
import {
  mascotFrameRate,
  mascotMotion,
  newMascotState,
  stepMascot,
  type MascotActivity,
  type MascotEffect,
  type MascotInput,
  type MascotState,
} from "./behavior";
import { clickGesture, eventsForClick, newStroke, strokeLeave, strokeStep } from "./gestures";
import { crossedThreshold, GAUGE_LINGER_MS, GAUGE_SEGMENTS, gaugeFor, gaugeShown, type FloatingContext } from "./gauge";
import type { FloatingPilot } from "./pilot";
import { mascotFor } from "./mascots";
import { Balloon, BALLOON_MAX_W, type BalloonSide } from "./Balloon";
import { completeMascotLook } from "../../../shared/mascot-look";
import { mascotStage } from "./fit";
import { mascotFields, type FloatingEvent, type FloatingPose, type FloatingSnapshot } from "./protocol";

// The Hibou 98 extras (retro balloon stylesheet, Trombi's sparkle) load only
// while that skin is worn, so a device that never found the egg never fetches them.
const RetroDecor = lazy(() => import("./RetroDecor"));

/** How far the pointer must travel before a press becomes a drag. */
const DRAG_SLOP = 4;
/** A press held this long opens the menu where there is no right click (touch). */
const LONG_PRESS_MS = 550;
/** A second click within this long is a double click (the balloon), not a game. */
const TICK_MS = 250;
/** The window follows what is drawn a moment later (FloatingBotWindow resizes it); flights wait for that. */
const RESIZE_SETTLE_MS = 220;
/** A flight to the screen edge or back home (the clips are timed to it). */
const FLIGHT_MS = 1400;
const GAZE_MS = 200;
/** A bot's picture, drawn flat. */
export const CHARACTER_SIZE = 88;
/** The 3D owl's canvas: room above the owl for its hops and spins. */
/** The owl's own box. */
const OWL_SIZE = 120;
/** The stage around it: big enough that no spin, flip, jump or spread wing is ever cut off (fit.ts). */
const STAGE = mascotStage(OWL_SIZE);
export const MASCOT_SIZE = { width: STAGE.width, height: STAGE.height } as const;

/** A bot colour name or hex, as CSS (the parked badge wears it). */
const owlHex = (color: string) => (MAUS_COLORS as Record<string, string>)[color] ?? (/^#[0-9a-fA-F]{3,8}$/.test(color) ? color : MAUS_COLORS.green);

const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The flat owl's state when the 3D one cannot be drawn: the mascot's activity first, then the brain's pose. */
export function owlStateFor(pose: FloatingPose, activity: MascotActivity): OwlState {
  if (activity === "sleep") return "sleepy";
  if (activity === "spin" || activity === "celebrate" || activity === "petted") return "success";
  if (activity === "sad") return "alert";
  if (activity === "working" || activity === "flyOut" || activity === "return") return "working";
  return owlStateForPose(pose);
}

export function owlStateForPose(pose: FloatingPose): OwlState {
  if (pose === "think") return "thinking";
  if (pose === "speak") return "working";
  if (pose === "celebrate") return "success";
  if (pose === "alert") return "alert";
  if (pose === "sleep") return "sleepy";
  return "idle";
}

export interface FloatingMover {
  /** "screen" in a desktop window that moves under the pointer; "client" in the app. */
  coords: "screen" | "client";
  moveBy(dx: number, dy: number): void;
  moved(): void;
}

export interface FloatingBotViewProps {
  snapshot: FloatingSnapshot;
  onEvent: (event: FloatingEvent) => void;
  mover: FloatingMover;
  /** Desktop: let clicks reach the art and balloon, pass through elsewhere. */
  interactive?: (on: boolean) => void;
  /** Desktop: the window may take the keyboard while the input is used. */
  wantsKeyboard?: (on: boolean) => void;
  rootRef?: Ref<HTMLDivElement>;
  className?: string;
  style?: React.CSSProperties;
  /** The overlay's balloon folds under the bot when it stands near the top. */
  below?: boolean;
  /** Desktop: lets the mascot move its own window (fly off, come back, wander). */
  pilot?: FloatingPilot | null;
  /** Desktop: which way the balloon opened, so the window keeps the mascot's corner in place. */
  onSide?: (side: BalloonSide) => void;
}

interface CharacterProps {
  snapshot: FloatingSnapshot;
  activity: MascotActivity;
  mascot: {
    frame: (at: number) => ReturnType<typeof mascotMotion>;
    fps: () => number;
    onHitTest: (test: ((x: number, y: number) => boolean) | null) => void;
  };
}

function Character({ snapshot, activity, mascot }: CharacterProps) {
  const { avatar } = snapshot;
  // the character the bot wears (mascots.tsx); the owl unless chosen otherwise
  const entry = mascotFor(snapshot.mascot);
  return (
    <>
      {avatar && (
        // the bot's picture rides along as a small medallion; the body is always the owl
        <span className="fb-medallion" aria-hidden="true">
          <img src={avatar.src} alt="" draggable={false} style={{ objectPosition: `${avatar.focusX * 100}% ${avatar.focusY * 100}%` }} />
        </span>
      )}
      <entry.Render
        key={entry.id}
        color={snapshot.color}
        skin={snapshot.skin}
        look={completeMascotLook(snapshot.mascot)}
        size={OWL_SIZE}
        activity={activity}
        pose={snapshot.pose}
        frame={mascot.frame}
        fps={mascot.fps}
        onHitTest={mascot.onHitTest}
        stage={STAGE}
      />
    </>
  );
}

/**
 * Which way the balloon opens and how much room it has: on the desktop from
 * where the window stands on its screen, in the app from the overlay's own
 * placement.
 */
export function balloonSide(where: "desktop" | "overlay", below: boolean, stageHeight: number): { side: BalloonSide; room: { x: number; y: number; w: number; h: number } } {
  if (typeof window === "undefined") return { side: { below, right: false }, room: { x: 0, y: 0, w: BALLOON_MAX_W, h: 420 } };
  const screenH = window.screen?.availHeight ?? window.innerHeight;
  const screenW = window.screen?.availWidth ?? window.innerWidth;
  const top = (window.screen as Screen & { availTop?: number })?.availTop ?? 0;
  const left = (window.screen as Screen & { availLeft?: number })?.availLeft ?? 0;
  const maxH = Math.round(screenH * 0.6);
  if (where === "overlay") return { side: { below, right: false }, room: { x: 0, y: 0, w: Math.min(BALLOON_MAX_W, window.innerWidth - 16), h: Math.min(maxH, window.innerHeight - stageHeight - 24) } };
  const mascotTop = window.screenY + window.innerHeight - stageHeight;
  const mascotRight = window.screenX + window.innerWidth;
  const spaceAbove = mascotTop - top;
  const spaceBelow = top + screenH - (window.screenY + window.innerHeight);
  const spaceLeft = mascotRight - left;
  const spaceRight = left + screenW - window.screenX;
  const openBelow = spaceAbove < 260 && spaceBelow > spaceAbove;
  const openRight = spaceLeft < 320 && spaceRight > spaceLeft;
  const vertical = openBelow ? spaceBelow + stageHeight : spaceAbove;
  const horizontal = openRight ? spaceRight : spaceLeft;
  return {
    side: { below: openBelow, right: openRight },
    room: { x: Math.max(0, horizontal - 300), y: Math.max(0, vertical - 220), w: Math.max(280, horizontal - 16), h: Math.max(160, Math.min(maxH, vertical - 24)) },
  };
}

/** A small sign over the owl for some clips: a question mark, a hoot, a surprise, a temper, confetti. */
export function emoteFor(activity: MascotActivity): "question" | "hoot" | "bang" | "anger" | "confetti" | "thought" | null {
  if (activity === "confused") return "question";
  if (activity === "hoot") return "hoot";
  if (activity === "surprised" || activity === "startled") return "bang";
  if (activity === "angry") return "anger";
  if (activity === "celebrate") return "confetti";
  if (activity === "think") return "thought";
  return null;
}

function Emote({ activity, hoot }: { activity: MascotActivity; hoot?: string }) {
  const kind = emoteFor(activity);
  if (!kind) return null;
  if (kind === "confetti") {
    return (
      <span className="fb-confetti" aria-hidden="true">
        {Array.from({ length: 14 }, (_, index) => <span key={index} style={{ "--i": index } as React.CSSProperties} />)}
      </span>
    );
  }
  if (kind === "thought") return <span className="fb-thought" aria-hidden="true"><span /><span /><span /></span>;
  const text = kind === "question" ? "?" : kind === "bang" ? "!" : kind === "hoot" ? (hoot || "Hoot!") : "";
  return (
    <span className="fb-emote" data-kind={kind} aria-hidden="true">
      {kind === "anger" ? (
        <svg viewBox="0 0 20 20" width="18" height="18"><path d="M3 7 Q7 7 7 3 M13 3 Q13 7 17 7 M17 13 Q13 13 13 17 M7 17 Q7 13 3 13" fill="none" stroke="#e5484d" strokeWidth="2.4" strokeLinecap="round" /></svg>
      ) : text}
    </span>
  );
}

/** The bot's context left, as a game energy bar (gauge.ts): small at rest, bigger on hover. */
function EnergyBar({ context, big, mini, shown = true }: { context?: FloatingContext | null; big?: boolean; mini?: boolean; shown?: boolean }) {
  const gauge = gaugeFor(context);
  if (!context || !gauge) return null;
  return (
    <span
      className="fb-energy"
      data-level={gauge.level}
      data-pulse={gauge.pulse ? "" : undefined}
      data-big={big ? "" : undefined}
      data-shown={shown ? "" : undefined}
      data-mini={mini ? "" : undefined}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={gauge.remaining}
      aria-valuetext={context.detail || context.label}
      aria-label={context.label}
      title={context.detail || context.label}
    >
      <svg className="fb-energy-bolt" viewBox="0 0 12 16" aria-hidden="true"><path d="M7 0 L1 9 H5.5 L4.5 16 L11 6.5 H6.5 Z" fill="currentColor" /></svg>
      <span className="fb-energy-bar" aria-hidden="true">
        <span className="fb-energy-fill" style={{ width: `${gauge.remaining}%` }} />
        {Array.from({ length: GAUGE_SEGMENTS - 1 }, (_, index) => <span key={index} className="fb-energy-tick" style={{ left: `${((index + 1) * 100) / GAUGE_SEGMENTS}%` }} />)}
      </span>
      {big && <span className="fb-energy-label" aria-hidden="true">{context.label}</span>}
    </span>
  );
}

/** Hearts after a game or a stroke, sparkles after a finished task. */
function Burst({ kind, reduced }: { kind: "hearts" | "sparkles"; reduced: boolean }) {
  const glyph = kind === "hearts" ? "\u2665" : "\u2726";
  const count = reduced ? 2 : 6;
  return (
    <span className="fb-burst" data-kind={kind} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} style={{ "--i": index, "--n": count } as React.CSSProperties}>{glyph}</span>
      ))}
    </span>
  );
}

/** While the bot works away from its spot: a small owl at the screen edge with a turning ring. */
function AwayBadge({ snapshot, onOpen, onMenu, hover }: { snapshot: FloatingSnapshot; onOpen: () => void; onMenu: () => void; hover: (on: boolean) => void }) {
  const label = snapshot.hints.working || snapshot.name;
  return (
    <button
      type="button"
      className="fb-away"
      data-task={snapshot.task}
      aria-label={label}
      title={label}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
      onClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu();
      }}
    >
      <span className="fb-away-ring" aria-hidden="true" />
      <EnergyBar context={snapshot.context} mini />
      <svg className="fb-away-owl" viewBox="0 0 32 32" aria-hidden="true" style={{ color: `var(--fb-owl, currentColor)` }}>
        <path d="M8 6 L11 11 L21 11 L24 6 L25 14 C26 22 22 28 16 28 C10 28 6 22 7 14 Z" fill="currentColor" />
        <circle cx="12.5" cy="15" r="3" fill="#F8CA48" />
        <circle cx="19.5" cy="15" r="3" fill="#F8CA48" />
        <circle cx="12.5" cy="15" r="1.4" fill="#0E0B0E" />
        <circle cx="19.5" cy="15" r="1.4" fill="#0E0B0E" />
        <path d="M15 18 L17 18 L16 20.5 Z" fill="#ACA09C" />
      </svg>
    </button>
  );
}

export function FloatingBotView({ snapshot: given, onEvent, mover, interactive, wantsKeyboard, rootRef, className, style, below, pilot = null, onSide }: FloatingBotViewProps) {
  // an older brain may not send the mascot's fields yet
  const snapshot: FloatingSnapshot = given.hints ? given : { ...given, ...mascotFields(given) };
  const [menuOpen, setMenuOpen] = useState(false);
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number; timer?: ReturnType<typeof setTimeout>; menu?: boolean } | null>(null);
  const hovering = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const reduced = snapshot.reduced;
  // Trombi talks in the Hibou 98 look, whatever the skin
  const retro = snapshot.retro || snapshot.mascot?.character === "trombi";

  /* -------------------------------------------------- the mascot's life */

  const mascotRef = useRef<MascotState>(newMascotState(now()));
  const [activity, setActivity] = useState<MascotActivity>("idle");
  const [away, setAway] = useState(false);
  const [owlHover, setOwlHover] = useState(false);
  // the energy bar shows while the person deals with the mascot, then lingers a moment
  const [energyUntil, setEnergyUntil] = useState(0);
  const [, setEnergyTick] = useState(0);
  const owlHoverRef = useRef(false);
  const [burst, setBurst] = useState<{ kind: "hearts" | "sparkles"; key: number } | null>(null);
  const hitTest = useRef<((x: number, y: number) => boolean) | null>(null);
  const gaze = useRef<{ x: number; y: number } | null>(null);
  const pet = useRef(newStroke());
  const lastClick = useRef<number | null>(null);
  const mascotOptions = () => ({
    reduced,
    flyAway: snapshot.flyAway,
    canMove: Boolean(pilot),
    random: Math.random,
    liveliness: snapshot.liveliness ?? "normal",
    mood: snapshot.mood,
    // only the 3D owl has real depth: spins, flips and turns in place are its alone
    depth: (snapshot.mascot?.character ?? "owl") === "owl" && snapshot.mascot?.style === "3d",
  });
  const options = useRef(mascotOptions());
  options.current = mascotOptions();
  const moodRef = useRef(snapshot.mood);
  moodRef.current = snapshot.mood;
  const poseRef = useRef(snapshot.pose);
  poseRef.current = snapshot.pose;
  const pilotRef = useRef(pilot);
  pilotRef.current = pilot;

  const dispatchRef = useRef<(input: MascotInput) => void>(() => undefined);
  const runEffect = useCallback((effect: MascotEffect) => {
    const flight = pilotRef.current;
    const arrived = () => dispatchRef.current({ type: "arrived", now: now() });
    switch (effect.type) {
      case "flyOut":
        // the owl crouches and spreads its wings first; the window leaves with the jump
        if (flight) setTimeout(() => void flight.flyOut(FLIGHT_MS).finally(arrived), effect.delay);
        else setTimeout(arrived, effect.delay + FLIGHT_MS);
        break;
      case "flyHome":
        // let the window grow back to the owl first, then fly it home
        if (flight) setTimeout(() => void flight.flyHome(FLIGHT_MS).finally(arrived), RESIZE_SETTLE_MS);
        else setTimeout(arrived, FLIGHT_MS);
        break;
      case "wander":
        if (flight) setTimeout(() => void flight.wander(effect.dx, effect.ms, effect.style).finally(arrived), effect.delay);
        else arrived();
        break;
      case "halt":
        flight?.halt();
        break;
      case "hearts":
      case "sparkles":
        setBurst({ kind: effect.type, key: now() });
        break;
      default:
        break;
    }
  }, []);
  const dispatch = useCallback((input: MascotInput) => {
    const { state, effects } = stepMascot(mascotRef.current, input, options.current);
    mascotRef.current = state;
    setActivity(state.activity);
    // the badge shows once parked (working), and the owl again as soon as it heads home
    setAway(state.away && state.activity === "working");
    for (const effect of effects) runEffect(effect);
  }, [runEffect]);
  dispatchRef.current = dispatch;

  // the bot's work, from the brain: fly off, come back
  useEffect(() => {
    dispatch({ type: "task", now: now(), task: snapshot.task });
  }, [dispatch, snapshot.task]);

  // the mascot's clock: idle actions, naps, timed reactions ending
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      dispatch({ type: "tick", now: now() });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [dispatch]);

  // once parked at the edge and shrunk to the badge, snap to the edge
  useEffect(() => {
    if (!away) return;
    const later = setTimeout(() => void pilotRef.current?.park(), RESIZE_SETTLE_MS);
    return () => clearTimeout(later);
  }, [away]);

  useEffect(() => {
    if (!burst) return;
    const done = setTimeout(() => setBurst(null), 1400);
    return () => clearTimeout(done);
  }, [burst]);


  // the head follows the pointer: on the desktop it is asked of main (the
  // pointer is mostly outside this small window); over the app it is the page's own
  useEffect(() => {
    if (reduced) {
      gaze.current = null;
      return;
    }
    // the pointer: where the eyes look, and how near and fast it is (startle, greeting)
    let previous: { x: number; y: number; at: number } | null = null;
    const notice = (offset: { x: number; y: number } | null) => {
      const at = now();
      gaze.current = offset ? { x: clamp(offset.x / 420, -1, 1), y: clamp(offset.y / 320, -1, 1) } : null;
      const speed = offset && previous ? Math.hypot(offset.x - previous.x, offset.y - previous.y) / Math.max(0.016, (at - previous.at) / 1000) : 0;
      previous = offset ? { ...offset, at } : null;
      dispatchRef.current({ type: "cursor", now: at, distance: offset ? Math.hypot(offset.x, offset.y) : null, speed });
    };
    if (pilot) {
      let alive = true;
      const timer = setInterval(() => {
        if (document.hidden || mascotRef.current.away || mascotRef.current.activity === "sleep") return;
        void pilot.sense().then(({ cursor, room }) => {
          if (!alive) return;
          notice(cursor);
          if (room) dispatchRef.current({ type: "room", now: now(), left: room.left, right: room.right });
        });
      }, GAZE_MS);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }
    let lastNotice = 0;
    const onMove = (event: PointerEvent) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect || now() - lastNotice < GAZE_MS / 2) return;
      lastNotice = now();
      notice({ x: event.clientX - (rect.left + rect.width / 2), y: event.clientY - (rect.top + rect.height * 0.4) });
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [pilot, reduced]);

  const mascot = useRef({
    frame: (at: number) => mascotMotion(mascotRef.current, { now: at, pose: poseRef.current, reduced: options.current.reduced, gaze: gaze.current, mood: moodRef.current }),
    fps: () => mascotFrameRate(mascotRef.current.activity, owlHoverRef.current, options.current.reduced),
    onHitTest: (test: ((x: number, y: number) => boolean) | null) => {
      hitTest.current = test;
    },
  }).current;

  const balloon = away ? null : snapshot.balloon;
  // Which way the balloon opens, decided when it opens and kept while it is open, so the
  // mascot never jumps: above unless the screen's top is too near, to the left unless its edge is
  const [side, setSide] = useState<BalloonSide>({ below: Boolean(below), right: false });
  const [room, setRoom] = useState({ x: 0, y: 0, w: BALLOON_MAX_W, h: 420 });
  const balloonOpen = Boolean(balloon);
  useLayoutEffect(() => {
    if (!balloonOpen) return;
    const next = balloonSide(pilot ? "desktop" : "overlay", Boolean(below), STAGE.height);
    setSide(next.side);
    setRoom(next.room);
    onSide?.(next.side);
    // decided once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balloonOpen]);
  const interacting = owlHover || activity === "drag" || activity === "petted" || activity === "love" || Boolean(balloon);
  const energyShown = gaugeShown({ interacting, lingerUntil: energyUntil }, now());
  // keep it a moment after the interaction ends; show it a moment when the context crosses 50, 80 or 85 %
  const percent = snapshot.context?.percent;
  const lastPercent = useRef(percent);
  useEffect(() => {
    const crossed = crossedThreshold(lastPercent.current, percent);
    lastPercent.current = percent;
    if (!interacting && !crossed) return;
    setEnergyUntil(now() + GAUGE_LINGER_MS);
  }, [interacting, percent]);
  useEffect(() => {
    if (interacting || energyUntil <= now()) return;
    const later = setTimeout(() => setEnergyTick((n) => n + 1), energyUntil - now() + 20);
    return () => clearTimeout(later);
  }, [interacting, energyUntil]);


  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menuOpen) setMenuOpen(false);
      else if (balloon) onEvent({ type: "dismiss" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, balloon, onEvent]);

  // With no balloon to type in, give the keyboard back to whatever had it (the balloon takes it when it opens).
  const hasInput = Boolean(balloon?.input);
  useEffect(() => {
    if (!hasInput) wantsKeyboard?.(false);
  }, [hasInput, wantsKeyboard]);

  const hover = (on: boolean) => {
    hovering.current = on;
    if (!drag.current) interactive?.(on);
  };
  /** Over the owl itself (its pixels, when drawn in 3D), not the empty corners of its canvas. */
  const overOwl = (event: ReactPointerEvent) => !hitTest.current || hitTest.current(event.clientX, event.clientY);
  const owlHovered = (on: boolean) => {
    if (!on) pet.current = strokeLeave(pet.current);
    if (owlHoverRef.current === on) return;
    owlHoverRef.current = on;
    setOwlHover(on);
    hover(on);
  };
  const stroke = (event: ReactPointerEvent) => {
    if (event.pointerType === "touch") return;
    const at = now();
    const step = strokeStep(pet.current, event.clientX, event.clientY, at);
    pet.current = step.state;
    if (step.pet) {
      dispatch({ type: "pet", now: at });
      onEvent({ type: "pet" });
    }
  };

  const point = (event: ReactPointerEvent) => (mover.coords === "screen" ? { x: event.screenX, y: event.screenY } : { x: event.clientX, y: event.clientY });

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !overOwl(event)) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const start = { ...point(event), moved: false, id: event.pointerId } as NonNullable<typeof drag.current>;
    if (event.pointerType === "touch") {
      start.timer = setTimeout(() => {
        start.menu = true;
        setMenuOpen(true);
      }, LONG_PRESS_MS);
    }
    drag.current = start;
    interactive?.(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) {
      // no button down: hovering, maybe stroking
      const over = overOwl(event);
      owlHovered(over);
      if (over) stroke(event);
      return;
    }
    const here = point(event);
    const dx = here.x - start.x;
    const dy = here.y - start.y;
    if (!start.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    if (!start.moved) {
      clearTimeout(start.timer);
      dispatch({ type: "drag", now: now(), on: true });
    }
    start.moved = true;
    start.x = here.x;
    start.y = here.y;
    mover.moveBy(dx, dy);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start || start.id !== event.pointerId) return;
    clearTimeout(start.timer);
    if (start.moved) {
      mover.moved();
      dispatch({ type: "drag", now: now(), on: false });
    } else if (!start.menu) {
      setMenuOpen(false);
      // a click opens the chat at once; a second click soon after opens the app instead
      const gesture = clickGesture(lastClick.current, now());
      lastClick.current = gesture === "double" ? null : now();
      for (const event of eventsForClick(gesture)) onEvent(event);
    }
    if (!hovering.current) interactive?.(false);
  };



  return (
    <div
      ref={rootRef}
      className={cn("fb-root", retro && "r98-root", (balloon ? side.below : below) && "fb-below", balloon && side.right && "fb-left", className)}
      style={{ ...style, ...(balloon && side.right ? { alignItems: "flex-start" } : {}), "--fb-tail": `${Math.round(STAGE.width / 2) - 7}px` } as React.CSSProperties}
      data-reduced={snapshot.reduced ? "" : undefined}
      data-retro={retro ? "" : undefined}
      lang={snapshot.locale}
    >
      {balloon && (
        <Balloon
          botId={snapshot.id ?? snapshot.name}
          name={snapshot.name}
          balloon={balloon}
          retro={retro}
          side={side}
          room={room}
          onEvent={onEvent}
          hover={hover}
          wantsKeyboard={wantsKeyboard}
          pinLabel={snapshot.hints.pin ?? ""}
        />
      )}
      {menuOpen && (
        <div role="menu" aria-label={snapshot.name} className={cn("fb-menu", retro && "r98-menu")} onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)}>
          {snapshot.menu.map((item) => (
            <button
              key={item.id}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={item.checked}
              className={cn("fb-menu-item", retro && "r98-menu-item")}
              onClick={() => {
                setMenuOpen(false);
                onEvent({ type: "menu", id: item.id });
              }}
            >
              <span className="fb-check" aria-hidden="true">{item.checked ? "✓" : ""}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div
        ref={stageRef}
        className="fb-stage"
        data-pose={snapshot.pose}
        data-activity={activity}
        data-3d=""
        data-away={away ? "" : undefined}
        style={{ "--fb-owl": owlHex(snapshot.color), ...(away ? {} : { width: STAGE.width, height: STAGE.height, "--fb-feet": `${STAGE.top + OWL_SIZE - 2}px` }) } as React.CSSProperties}
      >
        {retro && !away && (
          <Suspense fallback={null}>
            <RetroDecor sparkle={snapshot.sparkle} reduced={snapshot.reduced} />
          </Suspense>
        )}
        {away ? (
          <AwayBadge snapshot={snapshot} hover={hover} onOpen={() => onEvent({ type: "open" })} onMenu={() => {
            onEvent({ type: "context" });
            setMenuOpen((open) => !open);
          }} />
        ) : (
        <>
        {/* effects are anchored to the character's head, inside its own box */}
        <span
          className="fb-fx"
          data-character={snapshot.mascot?.character ?? "owl"}
          aria-hidden="true"
          style={{ left: STAGE.left, top: STAGE.top, width: OWL_SIZE, height: OWL_SIZE }}
        >
          {snapshot.pose === "think" && activity !== "flyOut" && activity !== "think" && (
            <span className="fb-thought"><span /><span /><span /></span>
          )}
          {activity === "sleep" && (
            <span className="fb-zzz"><span>z</span><span>z</span><span>Z</span></span>
          )}
          <Emote activity={activity} hoot={snapshot.hints.hoot} />
          {burst && <Burst key={burst.key} kind={burst.kind} reduced={reduced} />}
        </span>
        <button
          type="button"
          className="fb-art"
          aria-label={snapshot.label}
          title={snapshot.label}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onPointerEnter={(event) => owlHovered(overOwl(event))}
          onPointerLeave={() => owlHovered(false)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            clearTimeout(drag.current?.timer);
            if (drag.current?.moved) dispatch({ type: "drag", now: now(), on: false });
            drag.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onEvent({ type: "click" });
            } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              event.preventDefault();
              setMenuOpen((open) => !open);
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            onEvent({ type: "context" });
            setMenuOpen((open) => !open);
          }}
        >
          <span className="fb-body" style={{ position: "absolute", left: STAGE.left, top: STAGE.top, width: OWL_SIZE, height: OWL_SIZE }}>
            <Character snapshot={snapshot} activity={activity} mascot={mascot} />
          </span>
        </button>
        {!["flyOut", "return", "fly"].includes(activity) && <EnergyBar context={snapshot.context} big={owlHover} shown={energyShown} />}
        </>
        )}
      </div>
    </div>
  );
}
