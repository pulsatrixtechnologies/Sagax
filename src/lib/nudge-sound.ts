import { nudgeSoundEnabled } from "@/lib/notification-preferences";

/** Served from public/ like app-icon.svg: vite copies it to dist/, and the
 * packaged app serves dist/ from inside the asar. */
export const NUDGE_SOUND_URL = "/nudge.mp3";
const NUDGE_SOUND_VOLUME = 0.6;

let warned = false;

function logOnce(error: unknown) {
  if (warned) return;
  warned = true;
  console.warn("[nudge] sound not played", error);
}

/** Play the nudge sound once. Only for a nudge RECEIVED on this computer, in
 * step with the window shake; the sender never calls it. Silent when this
 * computer turned the Nudge sound switch off. The volume is fixed below full
 * and never raises the system volume. Never throws: the autoplay policy may
 * refuse, and a refused sound is only logged once. */
export function playNudgeSound(): void {
  if (typeof Audio === "undefined") return;
  if (!nudgeSoundEnabled()) return;
  try {
    const audio = new Audio(NUDGE_SOUND_URL);
    audio.volume = NUDGE_SOUND_VOLUME;
    const started = audio.play();
    if (started && typeof started.catch === "function") started.catch(logOnce);
  } catch (error) {
    logOnce(error);
  }
}

/** Test seam: forget that a failure was already logged. */
export function resetNudgeSoundLog(): void {
  warned = false;
}
