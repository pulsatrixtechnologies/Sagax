/** Pause display-rate animation when the window cannot be seen.
 *
 * Hidden or minimized only. A window that is visible but not focused (on a
 * second screen, beside the app the person is typing in) keeps animating, so
 * a working bot still looks alive there; a resting face is already still.
 * prefers-reduced-motion stays on the stylesheets (`animation: none`).
 * Pausing play-state instead would freeze entrance animations on their
 * first keyframe.
 */

let watching = false;
const listeners = new Set<() => void>();

/** True when this document should not paint a frame loop. */
export function animationsPaused(): boolean {
  if (typeof document === "undefined") return false;
  return document.hidden || document.visibilityState === "hidden";
}

export function applyAnimationPauseAttribute(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root) return;
  if (animationsPaused()) root.dataset.animationsPaused = "";
  else delete root.dataset.animationsPaused;
}

function onChange() {
  applyAnimationPauseAttribute();
  for (const fn of listeners) fn();
}

function ensureWatching() {
  if (watching || typeof document === "undefined") return;
  watching = true;
  document.addEventListener("visibilitychange", onChange);
  applyAnimationPauseAttribute();
}

/** Subscribe to pause changes. The listener runs once immediately. */
export function watchAnimationPause(fn: () => void): () => void {
  listeners.add(fn);
  ensureWatching();
  fn();
  return () => listeners.delete(fn);
}

/** Called once from the renderer entry so CSS pauses even with no owls. */
export function installAnimationPause(): void {
  ensureWatching();
  applyAnimationPauseAttribute();
}

/** Test hook. Production code never calls this. */
export function resetAnimationPauseForTests(): void {
  watching = false;
  listeners.clear();
}
