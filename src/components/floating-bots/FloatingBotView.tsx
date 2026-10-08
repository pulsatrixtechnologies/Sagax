// What a floating bot looks like: its mascot (the flat owl in the bot's colour,
// or its picture) standing on the desktop or over the app, with a little life
// of its own (behavior.ts: it breathes, blinks, looks at the pointer, spins,
// hops, wanders, naps, reacts to clicks and strokes, flies off while its bot
// works), a speech balloon with a small input, and a right-click menu. It
// only draws a snapshot and reports what was clicked or typed; the brain
// (FloatingBots.tsx) decides everything else. The same view runs in a
// desktop window (FloatingBotWindow.tsx) and in the in-app overlay.
import "./floating-bots.css";
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from "react";
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
import type { FloatingPilot } from "./pilot";
import { mascotFor } from "./mascots";
import { Balloon, BALLOON_MAX_W, readBalloonPlace, splitOffset, type BalloonSide } from "./Balloon";
import { completeMascotLook } from "../../../shared/mascot-look";
import { mascotStage } from "./fit";
import { mascotFields, type FloatingEvent, type FloatingMenuItem, type FloatingPose, type FloatingSnapshot } from "./protocol";
import { characterMoves } from "./moves";
import { CHAT_BALLOON, dockedWindowSize, type Size } from "./window-frame";
import { effectLane, effectSide, type ChatPlacement, type EffectSide } from "./placement";
import { useHeldMenuMotion } from "@/components/MenuMotion";
import { MascotCallCardView, MascotCallPill, type LevelSource, type MascotCallCard } from "./MascotCall";
import type { MascotLook } from "../../../shared/mascot-look";

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
/** The owl's own box. */
const OWL_SIZE = 120;
/** The stage around it: big enough that no spin, flip, jump or spread wing is ever cut off (fit.ts). */
const STAGE = mascotStage(OWL_SIZE);
export const MASCOT_SIZE = { width: STAGE.width, height: STAGE.height } as const;
/** The call card's gap to the character's head, px. */
const CARD_GAP = 6;
/** The character's own box in the stage: the balloon may come right up to it, and main keeps it on screen. */
export const OWL_BOX = { left: STAGE.left, top: STAGE.top, size: OWL_SIZE } as const;
/** The stage around the character (fit.ts). */
export const MASCOT_STAGE = STAGE;

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
  /** Desktop: the room the open balloon may take, so the window is sized once rather than per frame. */
  onReserve?: (reserve: Size | null, exact: boolean) => void;
  /** The voice call's levels as they come (its waveform, the mascot's bounce). */
  onLevels?: LevelSource;
  /** Desktop: the menu opens natively at this point of the page (the pointer); the drawn menu otherwise. */
  menuAt?: (x: number, y: number) => void;
  /** Desktop: a move picked in the native menu's "Moves" (the drawn menu plays its own). */
  onMove?: (listener: (clip: string) => void) => () => void;
  /**
   * Desktop: where the chat goes, from where the character stands on its
   * display (placement.ts). The window holds the chat's room on that side.
   */
  layout?: MascotLayout | null;
}

/** The desktop mascot's layout around its character: the chat's side and room. */
export interface MascotLayout {
  side: BalloonSide;
  chat: ChatPlacement | null;
  /** Where the effects go: beside the character, never over it. */
  fx?: EffectSide;
}

/** The balloon's room from a placement: as big as that side of the display allows, and how far it may be dragged away. */
export function chatRoomFor(chat: ChatPlacement): { x: number; y: number; w: number; h: number } {
  return { x: Math.max(0, chat.room.w - CHAT_BALLOON.w), y: Math.max(0, chat.room.h - CHAT_BALLOON.h), w: chat.room.w, h: chat.room.h };
}

/** The drawn menu's rows: a submenu's items follow its title, indented. */
export function drawnMenuRows(items: readonly FloatingMenuItem[]): { item: FloatingMenuItem; depth: 0 | 1 }[] {
  return items.flatMap((item) => [{ item, depth: 0 as const }, ...(item.items ?? []).map((child) => ({ item: child, depth: 1 as const }))]);
}

interface CharacterProps {
  color: string;
  skin: string;
  /** The bot's picture and its focus: plain values, so a new snapshot with the same picture changes nothing. */
  avatarSrc: string | null;
  avatarX: number;
  avatarY: number;
  /** The look, as JSON: the same look is the same string, whatever object carried it. */
  look: string;
  pose: FloatingPose;
  activity: MascotActivity;
  mascot: {
    frame: (at: number) => ReturnType<typeof mascotMotion>;
    fps: () => number;
    onHitTest: (test: ((x: number, y: number) => boolean) | null) => void;
  };
}

/**
 * The character redraws only when its own looks change: a streaming reply
 * sends a new snapshot many times a second, and none of them concern it.
 */
const Character = memo(function Character({ color, skin, avatarSrc, avatarX, avatarY, look: lookJson, pose, activity, mascot }: CharacterProps) {
  const look = useMemo(() => (lookJson ? (JSON.parse(lookJson) as MascotLook) : undefined), [lookJson]);
  const complete = useMemo(() => completeMascotLook(look), [look]);
  // the character the bot wears (mascots.tsx); the owl unless chosen otherwise
  const entry = mascotFor(look);
  return (
    <>
      {avatarSrc && (
        // the bot's picture rides along as a small medallion; the body is always the owl
        <span className="fb-medallion" aria-hidden="true">
          <img src={avatarSrc} alt="" draggable={false} style={{ objectPosition: `${avatarX * 100}% ${avatarY * 100}%` }} />
        </span>
      )}
      <entry.Render
        key={entry.id}
        color={color}
        skin={skin}
        look={complete}
        size={OWL_SIZE}
        activity={activity}
        pose={pose}
        frame={mascot.frame}
        fps={mascot.fps}
        onHitTest={mascot.onHitTest}
        stage={STAGE}
      />
    </>
  );
});

/**
 * Which way the balloon opens and how much room it has: on the desktop from
 * where the window stands on its screen, in the app from the overlay's own
 * placement.
 */
export function balloonSide(where: "desktop" | "overlay", below: boolean, stageHeight: number): { side: BalloonSide; room: { x: number; y: number; w: number; h: number } } {
  if (typeof window === "undefined") return { side: { below, right: false }, room: { x: 0, y: 0, w: BALLOON_MAX_W, h: 420 } };
  const screenH = window.screen?.availHeight ?? window.innerHeight;
  const top = (window.screen as Screen & { availTop?: number })?.availTop ?? 0;
  const left = (window.screen as Screen & { availLeft?: number })?.availLeft ?? 0;
  const maxH = Math.round(screenH * 0.6);
  if (where === "overlay") return { side: { below, right: false }, room: { x: 0, y: 0, w: Math.min(BALLOON_MAX_W, window.innerWidth - 16), h: Math.min(maxH, window.innerHeight - stageHeight - 24) } };
  // The desktop balloon always opens above and to the left, into the room the
  // window already holds. Flipping it below or to the right moves the window's
  // origin, and the character jumps for a frame. A short screen just scrolls.
  const spaceAbove = window.screenY + window.innerHeight - stageHeight - top;
  const spaceLeft = window.screenX + window.innerWidth - left;
  return {
    side: { below: false, right: false },
    room: {
      x: Math.max(0, spaceLeft - 300),
      y: Math.max(0, spaceAbove - 220),
      w: Math.max(280, spaceLeft - 16),
      h: Math.max(160, Math.min(maxH, spaceAbove - 24)),
    },
  };
}

/**
 * The bot's work as the mascot takes it: while its balloon is open (the
 * person is chatting, the reply streams in it) it stays home rather than fly
 * off to the screen's edge, which would hide the balloon mid-reply; it flies
 * off once the balloon closes if the work goes on.
 */
export function mascotTaskFor(task: FloatingSnapshot["task"], chatOpen: boolean): FloatingSnapshot["task"] {
  return chatOpen && task === "working" ? "idle" : task;
}

/** The mascot's frame rate while its balloon is open: at most 30 fps (it keeps its life, at half the repaints). */
export function chatFrameRate(fps: number, chatting: boolean): number {
  return chatting ? Math.min(fps, 30) : fps;
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
function AwayBadge({ snapshot, onOpen, onMenu, hover }: { snapshot: FloatingSnapshot; onOpen: () => void; onMenu: (x: number, y: number) => void; hover: (on: boolean) => void }) {
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
        onMenu(event.clientX, event.clientY);
      }}
    >
      <span className="fb-away-ring" aria-hidden="true" />
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

export function FloatingBotView({ snapshot: given, onEvent, mover, interactive, wantsKeyboard, rootRef, className, style, below, pilot = null, onSide, onReserve, onLevels, menuAt, onMove, layout = null }: FloatingBotViewProps) {
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
  const [, setOwlHover] = useState(false);
  const owlHoverRef = useRef(false);
  const [burst, setBurst] = useState<{ kind: "hearts" | "sparkles"; key: number } | null>(null);
  const hitTest = useRef<((x: number, y: number) => boolean) | null>(null);
  const gaze = useRef<{ x: number; y: number } | null>(null);
  const pet = useRef(newStroke());
  const lastClick = useRef<number | null>(null);
  // a chat or a call in progress keeps the mascot home: it neither wanders nor flies off with the balloon
  const call = snapshot.call ?? null;
  const chatOpen = Boolean(snapshot.balloon) || Boolean(call);
  const task = mascotTaskFor(snapshot.task, chatOpen);
  const mascotOptions = () => ({
    reduced,
    flyAway: snapshot.flyAway,
    canMove: Boolean(pilot) && !chatOpen,
    random: Math.random,
    liveliness: snapshot.liveliness ?? "normal",
    mood: snapshot.mood,
    // the desktop owl is the flat one; nothing here turns in depth
    depth: false,
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

  // a move picked by name ("Moves"): only one this character has
  const lookKey = snapshot.mascot ? JSON.stringify(snapshot.mascot) : "";
  const playMove = useCallback((clip: string) => {
    const move = characterMoves(lookKey ? (JSON.parse(lookKey) as MascotLook) : undefined).find((candidate) => candidate.clip === clip);
    if (move) dispatchRef.current({ type: "move", now: now(), clip: move.clip });
  }, [lookKey]);
  useEffect(() => onMove?.(playMove), [onMove, playMove]);
  /** A choice in the menu: a move plays here; anything else is the brain's. */
  const chooseMenu = (id: string) => {
    setMenuOpen(false);
    if (id.startsWith("move:")) playMove(id.slice(5));
    else onEvent({ type: "menu", id });
  };

  // the bot's work, from the brain: fly off, come back
  useEffect(() => {
    dispatch({ type: "task", now: now(), task });
  }, [dispatch, task]);

  // a walk under way stops where it is when the balloon opens
  useEffect(() => {
    if (chatOpen) pilotRef.current?.halt();
  }, [chatOpen]);

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

  // While the balloon is open the mascot lives at half rate: the eye is on the chat, and every
  // frame it draws repaints the whole (larger) transparent window
  const chattingRef = useRef(false);
  const mascot = useRef({
    frame: (at: number) => mascotMotion(mascotRef.current, { now: at, pose: poseRef.current, reduced: options.current.reduced, gaze: gaze.current, mood: moodRef.current }),
    fps: () => chatFrameRate(mascotFrameRate(mascotRef.current.activity, owlHoverRef.current, options.current.reduced), chattingRef.current && !drag.current?.moved),
    onHitTest: (test: ((x: number, y: number) => boolean) | null) => {
      hitTest.current = test;
    },
  }).current;

  const balloon = away ? null : snapshot.balloon;
  // the balloon plays its close before it goes (the open pop backwards; at once under reduced motion)
  const shown = useHeldMenuMotion(balloon);
  // Which way the balloon opens, decided when it opens and kept while it is open, so the
  // mascot never jumps: above unless the screen's top is too near, to the left unless its edge is
  const [ownSide, setSide] = useState<BalloonSide>({ below: Boolean(below), right: false });
  const [ownRoom, setRoom] = useState({ x: 0, y: 0, w: BALLOON_MAX_W, h: 420 });
  // on the desktop the window's layout decides (FloatingBotWindow, from where the character stands)
  const desk = pilot && layout ? layout : null;
  const side = desk ? desk.side : ownSide;
  const room = desk?.chat ? chatRoomFor(desk.chat) : ownRoom;
  const shift = desk?.chat?.shift ?? 0;
  const balloonOpen = Boolean(balloon);
  // the call pill's card (settings, transcript) opens where the balloon goes
  const [callCard, setCallCard] = useState<MascotCallCard>(null);
  useEffect(() => {
    if (!call) setCallCard(null);
  }, [call]);
  const callCardShown = Boolean(call && (callCard || call.note || call.notice));
  const panelOpen = balloonOpen || callCardShown;
  chattingRef.current = balloonOpen || Boolean(call);
  useLayoutEffect(() => {
    if (!panelOpen || desk) return;
    const next = balloonSide(pilot ? "desktop" : "overlay", Boolean(below), STAGE.height);
    setSide(next.side);
    setRoom(next.room);
    onSide?.(next.side);
    // decided once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen]);

  // While the mascot is home the desktop window already holds the quick chat,
  // so a click paints the balloon and does not move the character. Away, the
  // window fits the badge. The open balloon reports its own room.
  useLayoutEffect(() => {
    if (!onReserve || !pilot || panelOpen) return;
    if (away) {
      onReserve(null, true);
      return;
    }
    const saved = readBalloonPlace(snapshot.id ?? snapshot.name);
    const held = splitOffset(saved, side).away;
    onReserve(dockedWindowSize(STAGE, { w: saved.w, h: saved.h, dx: held.dx + shift, dy: held.dy }), false);
  }, [onReserve, pilot, panelOpen, away, snapshot.id, snapshot.name, side.below, side.right, shift]);

  // The effects (signs, hearts, the thought dots, the Zzz) go beside the character, never over
  // it: on the desktop the window's layout says which side; over the app, the viewport's room
  const [ownFx, setOwnFx] = useState<EffectSide>("right");
  const fxShown = activity !== "idle" || Boolean(burst) || snapshot.pose === "think";
  useLayoutEffect(() => {
    if (desk || !fxShown || typeof window === "undefined") return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = effectSide({
      body: { x: rect.left + OWL_BOX.left, y: rect.top + OWL_BOX.top, width: OWL_BOX.size, height: OWL_BOX.size },
      workArea: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
      chatSide: balloon ? side : null,
    });
    setOwnFx((current) => (current === next ? current : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk, fxShown, activity, burst]);
  const fxSide: EffectSide = desk?.fx ?? ownFx;
  const lane = effectLane(fxSide, OWL_BOX);

  // On a call the mascot bounces with its bot's voice (the stage's --fb-voice, set
  // straight on the element: no render per level) and leans in while the person talks
  useEffect(() => {
    const stage = stageRef.current;
    if (!call || !onLevels || !stage) return;
    const off = onLevels((levels) => stage.style.setProperty("--fb-voice", String(levels.bot)));
    return () => {
      off();
      stage.style.removeProperty("--fb-voice");
    };
  }, [Boolean(call), onLevels]);


  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menuOpen) setMenuOpen(false);
      else if (callCard) setCallCard(null);
      else if (balloon) onEvent({ type: "dismiss" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, callCard, balloon, onEvent]);

  // With no balloon to type in, give the keyboard back to whatever had it (the balloon takes it when it opens).
  const hasInput = Boolean(balloon?.input);
  useEffect(() => {
    if (!hasInput) wantsKeyboard?.(false);
  }, [hasInput, wantsKeyboard]);

  /** The menu at the pointer: main's native one on the desktop, the drawn one in the app. */
  const openMenu = (x: number, y: number) => {
    if (menuAt) {
      setMenuOpen(false);
      menuAt(x, y);
    } else setMenuOpen((open) => !open);
  };
  const artCenter = () => {
    const rect = stageRef.current?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 };
  };

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
      const at = { x: event.clientX, y: event.clientY };
      start.timer = setTimeout(() => {
        start.menu = true;
        if (menuAt) menuAt(at.x, at.y);
        else setMenuOpen(true);
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
    } else if (!start.menu && snapshot.call?.botAudible) {
      // on a call the mascot is the pill's avatar: a click while its bot speaks cuts it, as in the app
      setMenuOpen(false);
      onEvent({ type: "call", action: "interrupt" });
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
      className={cn(
        "fb-root",
        retro && "r98-root",
        // the desktop window keeps its corner whether the chat is open or not (it holds the chat's room there)
        (desk ? side.below : balloon ? side.below : below) && "fb-below",
        (desk ? side.right : balloon && side.right) && "fb-left",
        className,
      )}
      style={{ ...style, ...((desk ? side.right : balloon && side.right) ? { alignItems: "flex-start" } : {}), "--fb-tail": `${Math.round(STAGE.width / 2) - 7}px`, "--fb-stage-h": `${STAGE.height}px` } as React.CSSProperties}
      data-reduced={snapshot.reduced ? "" : undefined}
      data-retro={retro ? "" : undefined}
      data-chatting={balloon ? "" : undefined}
      lang={snapshot.locale}
    >
      {shown.shown && shown.value && (
        <Balloon
          botId={snapshot.id ?? snapshot.name}
          name={snapshot.name}
          balloon={shown.value}
          closing={shown.closing}
          retro={retro}
          side={side}
          room={room}
          shift={shift}
          stage={STAGE}
          owl={OWL_BOX}
          onReserve={shown.closing ? undefined : onReserve}
          onEvent={onEvent}
          hover={hover}
          wantsKeyboard={wantsKeyboard}
          pinLabel={snapshot.hints.pin ?? ""}
          callLabel={!call ? snapshot.hints.call : undefined}
        />
      )}
      {call && callCardShown && (
        // right above the character's head, over the stage's empty room (no gap of empty stage between them)
        <MascotCallCardView call={call} name={snapshot.name} card={callCard} onEvent={onEvent} hover={hover} style={side.below ? undefined : { marginBottom: -(STAGE.top - CARD_GAP + 8) }} />
      )}
      {menuOpen && (
        <div role="menu" aria-label={snapshot.name} className={cn("fb-menu", retro && "r98-menu")} onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)}>
          {drawnMenuRows(snapshot.menu).map(({ item, depth }) =>
            item.type === "separator" ? (
              <span key={item.id} role="separator" className="fb-menu-sep" />
            ) : item.items ? (
              <span key={item.id} role="presentation" className="fb-menu-group">{item.label}</span>
            ) : (
              <button
                key={item.id}
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                aria-checked={item.checked}
                disabled={item.enabled === false}
                data-depth={depth || undefined}
                className={cn("fb-menu-item", retro && "r98-menu-item")}
                onClick={() => chooseMenu(item.id)}
              >
                <span className="fb-check" aria-hidden="true">{item.checked ? "✓" : ""}</span>
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
      <div
        ref={stageRef}
        className="fb-stage"
        data-pose={snapshot.pose}
        data-activity={activity}
        data-3d=""
        data-away={away ? "" : undefined}
        data-call={call && !away ? (call.muted || call.phase === "held" ? "quiet" : call.phase) : undefined}
        style={{ "--fb-owl": owlHex(snapshot.color), ...(away ? {} : { width: STAGE.width, height: STAGE.height, "--fb-feet": `${STAGE.top + OWL_SIZE - 2}px` }) } as React.CSSProperties}
      >
        {away ? (
          <AwayBadge snapshot={snapshot} hover={hover} onOpen={() => onEvent({ type: "open" })} onMenu={(x, y) => {
            onEvent({ type: "context" });
            openMenu(x, y);
          }} />
        ) : (
        <>
        {/* effects beside the character's head (a lane of the stage's transparent room), never over it */}
        <span
          className="fb-fx"
          data-character={snapshot.mascot?.character ?? "owl"}
          data-side={fxSide}
          aria-hidden="true"
          style={{ left: lane.x, top: lane.y, width: lane.width, height: lane.height }}
        >
          {snapshot.pose === "think" && activity !== "flyOut" && activity !== "think" && (
            <span className="fb-thought"><span /><span /><span /></span>
          )}
          {activity === "sleep" && (
            <span className="fb-zzz"><span>z</span><span>z</span><span>Z</span></span>
          )}
          <Emote activity={activity} hoot={snapshot.hints.hoot} />
          {burst && <Burst key={burst.key} kind={burst.kind} reduced={reduced} />}
          {retro && (
            // Trombi's sparkle when a reply settles: beside it too
            <Suspense fallback={null}>
              <RetroDecor sparkle={snapshot.sparkle} reduced={snapshot.reduced} />
            </Suspense>
          )}
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
              const at = artCenter();
              openMenu(at.x, at.y);
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            onEvent({ type: "context" });
            // right at the pointer
            openMenu(event.clientX, event.clientY);
          }}
        >
          <span className="fb-body" style={{ position: "absolute", left: STAGE.left, top: STAGE.top, width: OWL_SIZE, height: OWL_SIZE }}>
            <Character
              color={snapshot.color}
              skin={snapshot.skin}
              avatarSrc={snapshot.avatar?.src ?? null}
              avatarX={snapshot.avatar?.focusX ?? 0.5}
              avatarY={snapshot.avatar?.focusY ?? 0.5}
              look={snapshot.mascot ? JSON.stringify(snapshot.mascot) : ""}
              pose={snapshot.pose}
              activity={activity}
              mascot={mascot}
            />
          </span>
        </button>
        {call && (
          <div className="fb-call" style={{ top: STAGE.top + OWL_SIZE + 2 }}>
            <MascotCallPill call={call} name={snapshot.name} card={callCard} onCard={setCallCard} onEvent={onEvent} hover={hover} levels={onLevels} />
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
