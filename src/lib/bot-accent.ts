// Settings > Appearance > "Use bot color as accent": the app's accent follows
// the open bot's mascot color. Off by default; the skin's (and its colour's)
// accent stays whenever no bot is open or the bot has no colour.
//
// The variables are set on <body>, never on <html>: the skin and a deployment
// brand write theirs on the root, so clearing the body's puts theirs back
// with nothing to remember. Menus and dialogs portal into <body>, so they
// follow too. A bot colour is chosen for a mascot, not for text: before it
// becomes the accent it is darkened (light skins) or lifted (dark skins)
// until it holds 3:1 as a fill and 4.5:1 as text on the skin's panel, and the
// text drawn on it is the accent button's ink (bubble-colors.ts, accentInk).
import { useEffect, useSyncExternalStore } from "react";
import { prefersReducedMotion } from "./motion";
import { BOT_ACCENT_VARS, botAccentVars, normalizeHex } from "./bot-accent-colors";
import { BOT_SWITCH_VARS, botSwitchVars } from "./switch-colors";

export const BOT_ACCENT_KEY = "sagax.botAccent.v1";

export { BOT_ACCENT_VARS, botAccentVars, contrast, holdContrast, inkOn, luminanceOf, normalizeHex } from "./bot-accent-colors";

// ---- the preference (a renderer choice, it travels like the skin) ----

let sessionChoice: boolean | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function botAccentEnabled(): boolean {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    return storage()?.getItem(BOT_ACCENT_KEY) === "1";
  } catch {
    return false;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== BOT_ACCENT_KEY && event.key !== null) return;
  sessionChoice = undefined;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function setBotAccentEnabled(enabled: boolean): void {
  sessionChoice = enabled;
  try {
    if (enabled) storage()?.setItem(BOT_ACCENT_KEY, "1");
    else storage()?.removeItem(BOT_ACCENT_KEY);
  } catch {
    // the choice still holds for this session
  }
  notify();
}

export function useBotAccentEnabled(): boolean {
  return useSyncExternalStore(subscribe, botAccentEnabled, () => false);
}

// ---- applying it ----

let registered = false;

/** Lets the accent glide between bots: a registered colour property
 * interpolates where a plain custom property would jump. */
function registerAccentProperties(): void {
  if (registered || typeof CSS === "undefined" || typeof CSS.registerProperty !== "function") return;
  registered = true;
  for (const name of ["--color-accent", "--color-accent-text"]) {
    try {
      CSS.registerProperty({ name, syntax: "<color>", inherits: true, initialValue: "#3b82f6" });
    } catch {
      // already registered (a hot reload): nothing to do
    }
  }
}

function panelColor(): string | null {
  if (typeof document === "undefined") return null;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--color-panel");
  return normalizeHex(value);
}

/** Put the open bot's colour on the accent while the setting is on. */
export function useBotAccent(color: string | null | undefined): void {
  const enabled = useBotAccentEnabled();
  useEffect(() => {
    if (typeof document === "undefined") return;
    const body = document.body;
    const vars = enabled ? botAccentVars(color, panelColor()) : null;
    if (vars) {
      registerAccentProperties();
      body.style.transition = prefersReducedMotion() ? "" : "--color-accent 240ms ease, --color-accent-text 240ms ease";
      for (const [name, value] of Object.entries(vars)) body.style.setProperty(name, value);
    } else {
      for (const name of BOT_ACCENT_VARS) body.style.removeProperty(name);
    }
  }, [enabled, color]);
  useEffect(() => () => {
    if (typeof document === "undefined") return;
    for (const name of BOT_ACCENT_VARS) document.body.style.removeProperty(name);
    document.body.style.transition = "";
  }, []);
}

// ---- the switches in a bot's panel ----

/** The screens of the open bot: its chat, its routines and its tasks. The
 * team map, approvals, remote sessions and achievements belong to the app. */
const BOT_VIEWS = new Set(["chat", "routines", "code"]);

/** Whether the on track of a switch takes the bot's colour: inside a bot's
 * panel and screens (chat, routines, tasks, the bot's settings), whatever the
 * "Use bot color as accent" setting says; anywhere else only when that
 * setting is on (the accent is then the bot's colour everywhere). */
export function botSwitchActive(input: { hasBot: boolean; activeView: string; appSettingsOpen: boolean; pluginsOpen: boolean; accentEnabled: boolean }): boolean {
  if (!input.hasBot) return false;
  if (input.accentEnabled) return true;
  return BOT_VIEWS.has(input.activeView) && !input.appSettingsOpen && !input.pluginsOpen;
}

/** Put the bot's colour on the switches while `active` (body[data-bot-switch]). */
export function useBotSwitch(color: string | null | undefined, active: boolean): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const body = document.body;
    const vars = active ? botSwitchVars(normalizeHex(color)) : {};
    for (const name of BOT_SWITCH_VARS) body.style.removeProperty(name);
    if (Object.keys(vars).length) {
      for (const [name, value] of Object.entries(vars)) body.style.setProperty(name, value);
      body.dataset.botSwitch = "";
    } else delete body.dataset.botSwitch;
  }, [color, active]);
  useEffect(() => () => {
    if (typeof document === "undefined") return;
    for (const name of BOT_SWITCH_VARS) document.body.style.removeProperty(name);
    delete document.body.dataset.botSwitch;
  }, []);
}
