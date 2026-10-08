/** Served from public/ like app-icon.svg: vite copies it to dist/, and the
 * packaged app serves dist/ from inside the asar (on an organization server,
 * electron/bundled-ui.cjs answers it from the bundle). */
export const NUDGE_SOUND_URL = "/nudge.mp3";
const NUDGE_SOUND_VOLUME = 0.6;

let warned = false;
let primed: HTMLAudioElement | null = null;

function logOnce(error: unknown) {
  if (warned) return;
  warned = true;
  console.warn("[nudge] sound not played", error);
}

function makeElement(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  const audio = new Audio(NUDGE_SOUND_URL);
  audio.volume = NUDGE_SOUND_VOLUME;
  audio.preload = "auto";
  return audio;
}

/** Load the sound when the app starts, so the first nudge plays at once
 * even when it lands before any click in the page and while the window is
 * in the background (the desktop shell lets media play without a gesture).
 * Safe to call more than once. */
export function primeNudgeSound(): void {
  if (primed) return;
  try {
    primed = makeElement();
    primed?.load?.();
  } catch (error) {
    primed = null;
    logOnce(error);
  }
}

/** Play the nudge sound once. Only for a nudge RECEIVED on this computer, in
 * step with the window shake; the sender never calls it. The volume is fixed
 * below full and never raises the system volume. Never throws. Resolves true
 * when the sound started, false when it could not (the autoplay policy of a
 * plain browser, no audio device): the caller then lets the notification
 * ring instead. A refusal is only logged once. */
export function playNudgeSound(): Promise<boolean> {
  try {
    const audio = primed ?? makeElement();
    if (!audio) return Promise.resolve(false);
    try {
      audio.currentTime = 0;
    } catch {
      // not loaded yet: it starts from the beginning anyway
    }
    const started = audio.play();
    if (!started || typeof started.then !== "function") return Promise.resolve(true);
    return started.then(
      () => true,
      (error: unknown) => {
        logOnce(error);
        return false;
      },
    );
  } catch (error) {
    logOnce(error);
    return Promise.resolve(false);
  }
}

/** Test seam: forget that a failure was already logged and the primed element. */
export function resetNudgeSoundLog(): void {
  warned = false;
  primed = null;
}
