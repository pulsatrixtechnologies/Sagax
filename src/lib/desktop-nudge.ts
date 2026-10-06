/** Ask the desktop shell to focus the main window and shake it once.
 * A browser has no window to move. The shell ignores a second call while
 * the first shake is still running. */
export function onDesktopNudge(): void {
  if (typeof window === "undefined") return;
  window.ogb?.nudgeWindow?.();
}
