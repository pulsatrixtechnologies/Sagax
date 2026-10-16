/**
 * The motion tokens for code that animates from JavaScript (timers that wait
 * for a CSS transition, Web Animations, View Transitions). The values mirror
 * the `@theme` block at the top of src/styles.css (`--transition-duration-*`,
 * `--ease-*`); src/lib/motion.test.ts keeps the two in step.
 */

/** Durations in milliseconds. */
export const MOTION_MS = {
  instant: 50,
  fast: 100,
  base: 150,
  moderate: 200,
  slow: 300,
} as const;

/** Named easings, as CSS timing functions. */
export const EASE = {
  /** The app's curve: menus, panels, the sidebar. */
  outQuint: "cubic-bezier(0.22, 1, 0.36, 1)",
  /** A two-way change of state. */
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  /** An arrival worth a beat more. */
  emphasized: "cubic-bezier(0.16, 1, 0.3, 1)",
  /** Leaving: accelerates away; always shorter than the way in. */
  exit: "cubic-bezier(0.4, 0, 1, 1)",
  /** The mascots' settle. */
  outSoft: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  /** A travel from one place to another. */
  inOutStrong: "cubic-bezier(0.77, 0, 0.175, 1)",
} as const;

/** The reduced-motion rule: the system setting, or the in-app switch on the
 * root (`data-reduced-motion="true"`, which the preview pages also flip). */
export function prefersReducedMotion(): boolean {
  if (typeof document !== "undefined" && document.documentElement?.dataset?.reducedMotion === "true") return true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A progress fill drawn at full width and clipped to `percent` (0..100), with
 * its round ends kept: a clip changes paint only, a width would lay the bar
 * out again on every step. */
export function progressClip(percent: number): string {
  const shown = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return `inset(0 ${Math.round((100 - shown) * 100) / 100}% 0 0 round 9999px)`;
}
