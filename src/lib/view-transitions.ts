/**
 * Main view changes with a View Transition (document.startViewTransition):
 * opening a conversation or a thread, going to the previous one, closing
 * Settings. The browser snapshots the old frame, the update is flushed
 * synchronously inside the transition, then the main column cross-fades and
 * slides a few pixels in the direction of travel (styles.css "View
 * transitions"). Kept deliberately small:
 *
 * - Input is never held: the pseudo-elements take no pointer events, and a
 *   pointer, wheel or key press during the transition skips straight to the
 *   new state (the update has already run or runs at once).
 * - A navigation during another one skips the first.
 * - Without the API, under reduced motion (the system setting or the in-app
 *   switch) or in a hidden window, the update simply runs now.
 *
 * Chosen over React's <ViewTransition> on purpose: that one only animates
 * updates made in a React transition, and the store's updates are urgent.
 */
import { flushSync } from "react-dom";
import { prefersReducedMotion } from "./motion";

/** Which way the person travels: into something (forward) or back out. */
export type NavDirection = "forward" | "back";
/** What changes: the main column (`main`), or the page as a whole (`page`:
 * an overlay such as Settings goes, the main column stays as it was). */
export type NavScope = "main" | "page";

let running: ViewTransition | null = null;

const SKIP_EVENTS = ["pointerdown", "wheel", "keydown"] as const;

/** Run `update` (a store dispatch, a state change) as a view transition. */
export function navigate(update: () => void, direction: NavDirection = "forward", scope: NavScope = "main"): void {
  const doc = typeof document === "undefined" ? null : document;
  if (!doc || typeof doc.startViewTransition !== "function" || prefersReducedMotion() || doc.visibilityState === "hidden") {
    update();
    return;
  }
  running?.skipTransition();
  const root = doc.documentElement;
  root.dataset.nav = scope;
  root.dataset.navDirection = direction;
  const apply = () => flushSync(update);
  let transition: ViewTransition;
  try {
    transition = doc.startViewTransition({ update: apply, types: [`nav-${direction}`, `nav-${scope}`] });
  } catch {
    // an engine that only takes the callback form
    transition = doc.startViewTransition(apply);
  }
  running = transition;
  const skip = () => transition.skipTransition();
  for (const type of SKIP_EVENTS) window.addEventListener(type, skip, { capture: true, passive: true });
  // a failed update is the caller's error, not the animation's
  transition.updateCallbackDone.catch((error: unknown) => console.error(error));
  void transition.finished.catch(() => {}).finally(() => {
    for (const type of SKIP_EVENTS) window.removeEventListener(type, skip, { capture: true });
    if (running !== transition) return;
    running = null;
    delete root.dataset.nav;
    delete root.dataset.navDirection;
  });
}
