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
 * - A room (GroupView, `[data-room-view]`) on either side, or a main column
 *   that changes size (a side panel that lives outside the column on one
 *   side and inside it on the other), skips the animation once the update
 *   has run: the browser would otherwise morph the snapshot from the old
 *   box to the new one, a zoom that made people feel sick when opening a
 *   group. A room opens in place, like a 1:1 at rest (#group-open-motion).
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

/** The column a navigation swaps, and what it holds. */
const FRAME = ".app-content-frame";
const ROOM = "[data-room-view]";

interface FrameShape { width: number; height: number; room: boolean }

function frameShape(doc: Document): FrameShape | null {
  const frame = typeof doc.querySelector === "function" ? doc.querySelector<HTMLElement>(FRAME) : null;
  if (!frame) return null;
  const box = frame.getBoundingClientRect();
  return { width: Math.round(box.width), height: Math.round(box.height), room: Boolean(frame.querySelector(ROOM)) };
}

/** True when the swap must not animate: a room on either side, or a column
 * whose box changed (the old snapshot would be stretched into the new one). */
export function swapStandsStill(before: FrameShape | null, after: FrameShape | null): boolean {
  if (!before || !after) return false;
  return before.room || after.room || before.width !== after.width || before.height !== after.height;
}

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
  const before = frameShape(doc);
  let transition: ViewTransition | undefined;
  const apply = () => {
    flushSync(update);
    if (swapStandsStill(before, frameShape(doc))) transition?.skipTransition();
  };
  try {
    transition = doc.startViewTransition({ update: apply, types: [`nav-${direction}`, `nav-${scope}`] });
  } catch {
    // an engine that only takes the callback form
    transition = doc.startViewTransition(apply);
  }
  running = transition;
  const started = transition;
  const skip = () => started.skipTransition();
  for (const type of SKIP_EVENTS) window.addEventListener(type, skip, { capture: true, passive: true });
  // a failed update is the caller's error, not the animation's
  started.updateCallbackDone.catch((error: unknown) => console.error(error));
  void started.finished.catch(() => {}).finally(() => {
    for (const type of SKIP_EVENTS) window.removeEventListener(type, skip, { capture: true });
    if (running !== started) return;
    running = null;
    delete root.dataset.nav;
    delete root.dataset.navDirection;
  });
}
