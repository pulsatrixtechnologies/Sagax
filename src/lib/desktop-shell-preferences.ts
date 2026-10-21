// Settings > Appearance > Desktop: hardware acceleration and the spell
// checker (parity 2E). The page keeps each as "true" / "false" under its own
// key (so a bot can set it with sagax_settings, DEVICE_PREFERENCE_KEYS) and
// hands it to the desktop shell, which can only act on it itself
// (electron/desktop-shell-preferences.mjs). On this computer only: not part
// of what follows the person to another device.
import { localChoice } from "./local-choice";

export const hardwareAccelerationChoice = localChoice<"true" | "false">("sagax.hardwareAcceleration.v1", ["true", "false"], "true");
export const spellcheckChoice = localChoice<"true" | "false">("sagax.spellcheck.v1", ["true", "false"], "true");

export function hasDesktopShellPreferences(): boolean {
  return typeof window !== "undefined" && Boolean(window.ogb?.shellPreferences);
}

function stored(key: string): "true" | "false" | null {
  try {
    const value = globalThis.localStorage?.getItem(key);
    return value === "true" || value === "false" ? value : null;
  } catch {
    return null;
  }
}

function push(): void {
  void window.ogb?.shellPreferences?.set({
    hardwareAcceleration: hardwareAccelerationChoice.get() === "true",
    spellcheck: spellcheckChoice.get() === "true",
  });
}

/** Start-up: a choice the shell already keeps (storage was cleared) is
 * adopted; a choice kept here is handed over; then every change goes over. */
export function installDesktopShellPreferences(): () => void {
  const bridge = typeof window === "undefined" ? undefined : window.ogb?.shellPreferences;
  if (!bridge) return () => {};
  const kept = bridge.get();
  if (kept) {
    if (stored(hardwareAccelerationChoice.key) === null && !kept.hardwareAcceleration) hardwareAccelerationChoice.set("false");
    if (stored(spellcheckChoice.key) === null && !kept.spellcheck) spellcheckChoice.set("false");
  }
  if (stored(hardwareAccelerationChoice.key) !== null || stored(spellcheckChoice.key) !== null) push();
  const stops = [hardwareAccelerationChoice, spellcheckChoice].map((choice) => choice.subscribe(push));
  return () => stops.forEach((stop) => stop());
}
