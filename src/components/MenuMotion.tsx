import { useLayoutEffect, useRef, useState } from "react";
import { MOTION_MS, prefersReducedMotion } from "@/lib/motion";

/** A menu pops in over `--animate-pop-in` (100ms, opacity and a tiny scale)
 * and out over `--animate-pop-out`, quicker still; it stays mounted that long. */
export const MENU_ENTER_MS = MOTION_MS.fast;
export const MENU_EXIT_MS = 75;

/** A revealed panel (useReveal) opens over `moderate` and folds away over `base`. */
export const REVEAL_MOTION_MS = MOTION_MS.moderate;
export const REVEAL_EXIT_MS = MOTION_MS.base;

/** The reduced-motion rule: the system setting, or the in-app
 * `data-reduced-motion` switch on the root (src/lib/motion.ts). */
export const reducedMotion = prefersReducedMotion;

export interface MenuMotion {
  /** Render the menu: it is open, or still playing its close. */
  shown: boolean;
  /** Closed, and playing the open pop backwards. */
  closing: boolean;
  className: string;
  /** Spread on the menu element. A closing menu is only a picture of one:
   * inert and aria-hidden keep it out of the tab order, hit-testing and the
   * accessibility tree, so nothing (a person, a screen reader, a test
   * driver) can reach a menu that is already closed. */
  exitProps: { inert?: boolean; "aria-hidden"?: boolean };
}

/** Keep a menu mounted through its exit pop (`exitMs`), so close is the open
 * motion played backwards, faster. */
export function useMenuMotion(open: boolean, exitMs: number = MENU_EXIT_MS): MenuMotion {
  // True from the menu's first open until its close has finished playing.
  const [mounted, setMounted] = useState(open);

  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    if (reducedMotion()) {
      setMounted(false);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [open, mounted, exitMs]);

  // Read `open` itself, not only the state that trails it, so the menu shows
  // on the render its trigger flips and goes inert on the render it closes.
  const closing = !open && mounted;
  return {
    shown: open || mounted,
    closing,
    className: closing ? "animate-pop-out pointer-events-none" : "animate-pop-in",
    exitProps: closing ? { inert: true, "aria-hidden": true } : {},
  };
}

/** Remember the last open payload so a menu can finish closing after its
 * owner has already cleared the state that positioned it. */
export function useHeldMenuMotion<T>(value: T | null): MenuMotion & { value: T | null } {
  const motion = useMenuMotion(value != null);
  const held = useRef<T | null>(value);
  if (value != null) held.current = value;
  return { ...motion, value: value ?? held.current };
}

/** The class a revealed panel's shell carries (styles.css `.reveal-shell`):
 * a one-row grid whose row goes from 0fr to 1fr with its opacity, the menus'
 * easing, nothing under the reduced-motion rule. The browser interpolates
 * the row itself, so nothing is measured or written from script, and the
 * start state comes from `@starting-style` on the first paint. */
export const REVEAL_SHELL_CLASS = "reveal-shell";

export interface RevealMotion extends MenuMotion {
  /** Spread on the shell, with REVEAL_SHELL_CLASS. */
  shellProps: { "data-reveal": "open" | "closing" };
}

/** A panel that grows out of the edge above it and folds back into it.
 *
 * The shell (REVEAL_SHELL_CLASS, overflow hidden) is a grid of one row; the
 * panel inside it is its only in-flow child, at its natural size. Opening,
 * the row goes from 0fr to 1fr while the shell fades in; closing plays it
 * back to 0fr, quicker, then the shell unmounts. Another panel in the same
 * place (`contentKey` changes while open) simply takes the new height: the
 * caller cross-fades the two bodies. `beforeReveal` runs once the new
 * content is laid out and before it is painted (a transcript scrolls to its
 * last line there). No height is animated from script and the content never
 * reflows. Under the reduced-motion rule the panel simply appears and goes. */
export function useReveal(open: boolean, contentKey?: string | null, beforeReveal?: () => void): RevealMotion {
  const motion = useMenuMotion(open, REVEAL_EXIT_MS);
  const was = useRef<{ open: boolean; key: string | null | undefined }>({ open: false, key: contentKey });
  const before = useRef(beforeReveal);
  before.current = beforeReveal;

  useLayoutEffect(() => {
    const previous = was.current;
    was.current = { open, key: contentKey };
    if (open && (!previous.open || previous.key !== contentKey)) before.current?.();
  }, [open, contentKey]);

  return { ...motion, shellProps: { "data-reveal": motion.closing ? "closing" : "open" } };
}
