/** Pause display-rate animation when the user is not looking.
 *
 * Hidden or minimized: always. Blurred but still on screen: the main window
 * only. A floating mascot and the detached Hibou 98 assistant are unfocused
 * for their whole life, so blur is not a pause for them.
 * prefers-reduced-motion stays on the stylesheets (`animation: none`).
 * Pausing play-state instead would freeze entrance animations on their
 * first keyframe.
 */

let watching = false;
const listeners = new Set<() => void>();

function backgroundPet(): boolean {
  const root = typeof document === "undefined" ? null : document.documentElement;
  if (!root) return false;
  return "floatingBot" in root.dataset || "retroDetached" in root.dataset;
}

/** True when this document should not paint a frame loop. */
export function animationsPaused(): boolean {
  if (typeof document === "undefined") return false;
  if (document.hidden || document.visibilityState === "hidden") return true;
  if (backgroundPet()) return false;
  if (typeof document.hasFocus !== "function") return false;
  try {
    return document.hasFocus() === false;
  } catch {
    return false;
  }
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
  if (typeof window !== "undefined") {
    window.addEventListener("focus", onChange);
    window.addEventListener("blur", onChange);
  }
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
