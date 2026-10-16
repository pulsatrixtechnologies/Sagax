/**
 * The sidebar's snap between the icons rail and the expanded width, drawn
 * with transforms only (Grok Bot's 200ms ease-out-quint, armed only while it
 * plays). The width itself changes at once, so the chat column is laid out a
 * single time; then, for 200ms:
 *
 * - the column beside the sidebar slides from where its edge was to where it
 *   is now (`translateX`, compositor only);
 * - expanding, the sidebar's new content is revealed from the rail's width
 *   to its own (`clip-path`);
 * - collapsing, the rail's colour fills the strip the column has not crossed
 *   yet (a spread `box-shadow` behind the column), so no gap opens.
 *
 * Nothing animates width, margin or position, and no transition stays armed
 * between snaps (`data-sidebar-animating` marks the 200ms).
 */
import { EASE, MOTION_MS, prefersReducedMotion } from "./motion";

export const SIDEBAR_SNAP_MS = MOTION_MS.moderate;

export interface SidebarSnapFrames {
  sidebar: Keyframe[];
  follower: Keyframe[];
}

/** Keyframes for a snap from one sidebar width to another; null when the
 * width does not change. `fill` is the sidebar's background colour. */
export function sidebarSnapFrames(fromWidth: number, toWidth: number, fill: string): SidebarSnapFrames | null {
  const delta = Math.round(fromWidth - toWidth);
  if (!delta) return null;
  const follower: Keyframe[] = [{ transform: `translateX(${delta}px)` }, { transform: "translateX(0px)" }];
  if (delta < 0) {
    // expanding: show the new sidebar from the old width out to its own
    return { sidebar: [{ clipPath: `inset(0px ${-delta}px 0px 0px)` }, { clipPath: "inset(0px 0px 0px 0px)" }], follower };
  }
  // collapsing: the rail's colour spans the old width and shrinks with the column's edge
  const half = delta / 2;
  return {
    sidebar: [{ boxShadow: `${half}px 0px 0px ${half}px ${fill}` }, { boxShadow: `0px 0px 0px 0px ${fill}` }],
    follower,
  };
}

/** Play a snap on the sidebar and the column that follows it. Returns a
 * function that stops it early; does nothing under reduced motion, without
 * the Web Animations API, or when nothing moves. */
export function animateSidebarSnap(sidebar: HTMLElement, follower: HTMLElement | null, fromWidth: number, toWidth: number): () => void {
  if (prefersReducedMotion() || typeof sidebar.animate !== "function") return () => {};
  const frames = sidebarSnapFrames(fromWidth, toWidth, getComputedStyle(sidebar).backgroundColor);
  if (!frames) return () => {};
  const timing: KeyframeAnimationOptions = { duration: SIDEBAR_SNAP_MS, easing: EASE.outQuint };
  const row = sidebar.parentElement;
  const overflow = row?.style.overflow ?? "";
  // the column's far edge slides past the window for a moment: clip it there
  if (row) row.style.overflow = "clip";
  sidebar.setAttribute("data-sidebar-animating", "");
  const animations = [sidebar.animate(frames.sidebar, timing), ...(follower ? [follower.animate(frames.follower, timing)] : [])];
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    sidebar.removeAttribute("data-sidebar-animating");
    if (row) row.style.overflow = overflow;
  };
  void Promise.all(animations.map((animation) => animation.finished)).then(finish, finish);
  return () => {
    for (const animation of animations) animation.cancel();
    finish();
  };
}
