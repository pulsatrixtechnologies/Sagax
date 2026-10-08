// The mascot's global hotkey (Control+Option+Space by default), on the
// brain's side, as pure rules (tested in hotkey.test.ts). Main owns the key
// (electron/mascot-hotkey.mjs) and reports a "tap", a "hold" (held past
// 350 ms, only while the brain asks for holds) or the "release" of a hold;
// this decides what each means for the call: start it with the mascot's bot,
// mute or unmute it, or push to talk while held.

export type HotkeyKind = "tap" | "hold" | "release";
export type HotkeyAction = "start" | "mute" | "unmute" | "talk" | "release" | "none";

/** The accelerators offered in Settings (the same list as electron/mascot-hotkey.mjs HOTKEY_CHOICES). */
export { DEFAULT_HOTKEY, HOTKEY_CHOICES, type HotkeyChoice } from "@/lib/floating-bots";

export interface HotkeyContext {
  /** The setting is on. */
  enabled: boolean;
  /** The mascot the key speaks to (null: no mascot shown). */
  botId: string | null;
  /** Voice mode serves that bot. */
  canCall: boolean;
  /** The bot on a call now, whoever started it (null: none). */
  callBot: string | null;
  muted: boolean;
  /** The call settings are in push-to-talk mode. */
  push: boolean;
  /** The key is being held to talk now. */
  talking: boolean;
}

/**
 * What a hotkey event does. Off, or with no mascot shown: nothing. A tap
 * starts the call with the mascot's bot (ending any other call, as the
 * mascot's call button does), and during its call mutes or unmutes it. A
 * hold talks while held when the call is push to talk (else it is a tap);
 * its release stops talking.
 */
export function hotkeyAction(kind: HotkeyKind, context: HotkeyContext): HotkeyAction {
  if (kind === "release") return context.talking ? "release" : "none";
  if (!context.enabled || !context.botId) return "none";
  const onThisCall = context.callBot === context.botId;
  if (!onThisCall) return context.canCall ? "start" : "none";
  if (kind === "hold" && context.push && !context.muted) return "talk";
  return context.muted ? "unmute" : "mute";
}

/**
 * Which mascot the key speaks to: the one already on the call, else the
 * first one shown. Null when none is shown (the key is then let go).
 */
export function hotkeyBot(shown: readonly string[], callBot: string | null): string | null {
  if (callBot && shown.includes(callBot)) return callBot;
  return shown[0] ?? null;
}

/** What the brain asks of main: the key while the setting is on and a mascot is shown; holds only when they mean push to talk. */
export function hotkeyConfig({ enabled, accelerator, botId, callBot, push }: { enabled: boolean; accelerator: string; botId: string | null; callBot: string | null; push: boolean }): { enabled: boolean; accelerator: string; hold: boolean } {
  const on = enabled && Boolean(botId);
  return { enabled: on, accelerator, hold: on && push && callBot !== null && callBot === botId };
}
