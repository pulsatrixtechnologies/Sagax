import { playNudgeSound } from "@/lib/nudge-sound";

/** Ask the desktop shell to focus the main window and shake it once.
 * A browser has no window to move. The shell ignores a second call while
 * the first shake is still running. */
export function onDesktopNudge(): void {
  if (typeof window === "undefined") return;
  window.ogb?.nudgeWindow?.();
}

/** A nudge reached this computer (the `nudge` frame): shake the window and
 * play the nudge sound once. The sender's own window uses onDesktopNudge, so
 * it shakes without a sound. */
export function onNudgeReceived(): void {
  onDesktopNudge();
  playNudgeSound();
}
