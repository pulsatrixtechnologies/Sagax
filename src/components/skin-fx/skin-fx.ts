// The premium skins' shared machinery (shapes and Trombi): each skin's effect
// palette, when a skin draws its full effects or its cheap still look, and
// the hooks that pause effects off screen, honor reduced motion and play the
// equip and move bursts. Pure data and tiny hooks; the drawing lives in
// ShapeMascot.tsx, Trombi.tsx and SkinFx.tsx, the keyframes in skin-fx.css.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { MascotActivity } from "../floating-bots/behavior";

/** The family of effects a skin plays: its particles, its trails, its glow. */
export type FxKind = "plain" | "ink" | "gold" | "neon" | "chrome" | "crystal" | "circuit" | "holo" | "molten" | "galaxy" | "glitch" | "retro" | "velvet";

export type FxParticle = "dot" | "spark" | "ember" | "star" | "shard" | "bit" | "splat" | "streak";

export interface FxPalette {
  kind: FxKind;
  /** Main effect color. */
  a: string;
  /** Second effect color. */
  b: string;
  /** Effects glow (a soft blur under them). */
  glow: boolean;
  particle: FxParticle;
  /** Moves leave afterimages of the body (light trails). */
  trail: boolean;
}

/** Mixes a hex color toward another (t 0..1). */
export function mix(hex: string, toward: string, t: number): string {
  const a = Number.parseInt(hex.slice(1), 16);
  const b = Number.parseInt(toward.slice(1), 16);
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

/** The effect palette of a skin family, in the bot's color where the skin wears it. */
export function fxPalette(kind: FxKind, hex: string): FxPalette {
  switch (kind) {
    case "neon":
      return { kind, a: mix(hex, "#ffffff", 0.2), b: "#ffffff", glow: true, particle: "streak", trail: true };
    case "ink":
      return { kind, a: "#1b1f27", b: hex, glow: false, particle: "splat", trail: false };
    case "gold":
      return { kind, a: "#ffd75e", b: "#fff6d0", glow: true, particle: "spark", trail: false };
    case "chrome":
      return { kind, a: "#e8eef5", b: "#9fb4c8", glow: true, particle: "spark", trail: true };
    case "crystal":
      return { kind, a: mix(hex, "#ffffff", 0.55), b: "#ffffff", glow: true, particle: "shard", trail: false };
    case "circuit":
      return { kind, a: mix(hex, "#7dffea", 0.45), b: "#ffffff", glow: true, particle: "bit", trail: true };
    case "holo":
      return { kind, a: "#ff8be6", b: "#7df4ff", glow: true, particle: "star", trail: true };
    case "molten":
      return { kind, a: "#ff7a1a", b: "#ffd36b", glow: true, particle: "ember", trail: false };
    case "galaxy":
      return { kind, a: "#b9a4ff", b: "#ffffff", glow: true, particle: "star", trail: true };
    case "glitch":
      return { kind, a: "#ff2bd6", b: "#22e6ff", glow: false, particle: "bit", trail: true };
    case "velvet":
      return { kind, a: mix(hex, "#ffffff", 0.45), b: "#ffd9f2", glow: true, particle: "dot", trail: false };
    case "retro":
      return { kind, a: "#000080", b: "#c0c0c0", glow: false, particle: "bit", trail: false };
    default:
      return { kind: "plain", a: mix(hex, "#ffffff", 0.35), b: "#ffffff", glow: false, particle: "dot", trail: false };
  }
}

/** Below this size an avatar draws a skin's still, cheap look (sidebar, lists). */
export const FX_FULL_MIN = 44;

export type FxDetail = "full" | "static";

/** Full effects only for animated drawings large enough to read them. */
export function fxDetail(size: number, animated: boolean, override?: FxDetail): FxDetail {
  if (override) return override;
  return animated && size >= FX_FULL_MIN ? "full" : "static";
}

/** How long a move's burst plays, ms (the editor plays a move for 1600 ms). */
export const MOVE_FX_MS = 1700;
/** How long the equip animation plays, ms. */
export const EQUIP_FX_MS = 1100;

/** The moves that have their own burst. */
export const FX_MOVES = ["wave", "dance", "jump", "hop", "love", "hoot"] as const;
export type FxMove = (typeof FX_MOVES)[number];

export function fxMoveFor(activity: MascotActivity | string | null | undefined): FxMove | null {
  return (FX_MOVES as readonly string[]).includes(activity ?? "") ? (activity as FxMove) : null;
}

function reducedNow(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The OS reduced-motion setting, followed live. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(reducedNow);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

/**
 * Pauses an element's effects while it is off screen or its page hidden: sets
 * data-fx-paused on it (skin-fx.css pauses every animation under it). No
 * React state, so scrolling a long list never re-renders the avatars.
 */
export function useFxVisibility(ref: RefObject<Element | null>, active: boolean): void {
  useEffect(() => {
    const node = ref.current;
    if (!active || !node || typeof IntersectionObserver === "undefined") return;
    let onScreen = true;
    const apply = () => {
      const paused = !onScreen || (typeof document !== "undefined" && document.hidden);
      if (paused) node.setAttribute("data-fx-paused", "");
      else node.removeAttribute("data-fx-paused");
    };
    const observer = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      apply();
    });
    observer.observe(node);
    document.addEventListener("visibilitychange", apply);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", apply);
      node.removeAttribute("data-fx-paused");
    };
  }, [ref, active]);
}

/**
 * The equip animation: a key that changes when the skin changes after the
 * first draw (choosing a skin plays it; mounting a list of avatars never
 * does), null once it has played.
 */
export function useEquipBurst(skin: string, enabled: boolean): number | null {
  const first = useRef(skin);
  const [burst, setBurst] = useState<number | null>(null);
  useEffect(() => {
    if (skin === first.current) return;
    first.current = skin;
    if (!enabled) return;
    const key = Date.now();
    setBurst(key);
    const timer = setTimeout(() => setBurst((current) => (current === key ? null : current)), EQUIP_FX_MS);
    return () => clearTimeout(timer);
  }, [skin, enabled]);
  return enabled ? burst : null;
}

/** A one-shot move asked by the app (the avatar popover's Moves), shown for MOVE_FX_MS. */
export interface FxMoveRequest {
  clip: string;
  key: number;
}

export function useMoveBurst(request: FxMoveRequest | null | undefined, enabled: boolean): { move: FxMove; key: number } | null {
  const [shown, setShown] = useState<{ move: FxMove; key: number } | null>(null);
  const move = fxMoveFor(request?.clip);
  const key = request?.key ?? 0;
  useEffect(() => {
    if (!enabled || !move || !key) return;
    setShown({ move, key });
    const timer = setTimeout(() => setShown((current) => (current?.key === key ? null : current)), MOVE_FX_MS);
    return () => clearTimeout(timer);
  }, [move, key, enabled]);
  return enabled ? shown : null;
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Replays the body's own move (fx-body-*) each time a new move starts,
 * without remounting the drawing. A remount (a changing React key) restarts
 * every idle loop under it too: the holographic foil and the sweeps jumped
 * back to their start at every move. Only the element's own animations
 * replay, never its children's.
 */
export function useReplayMove(ref: RefObject<Element | null>, key: number | null | undefined): void {
  useIsoLayoutEffect(() => {
    const node = ref.current;
    if (!node || !key || typeof node.getAnimations !== "function") return;
    for (const animation of node.getAnimations()) {
      animation.cancel();
      animation.play();
    }
  }, [ref, key]);
}
