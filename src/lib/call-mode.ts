// Which kind of call the phone button starts, window-wide and remembered.
//
// "turns" is the original call: on-device listening, the bot's configured
// voice, and strict turn-taking (the microphone closes while the bot talks).
// "live" hands the conversation itself to OpenAI GPT-Live — both sides can
// talk at once — while every real request still goes to the bot as a normal
// turn. See server/live-call.ts.
import { useSyncExternalStore } from "react";
import type { LocaleKey } from "@/locales";
import { t } from "./i18n";

export type CallMode = "turns" | "live";
export const CALL_MODE_KEY = "openmausbot.callMode.v1";

/** The modes, as catalog keys (read with t() when shown). */
export const CALL_MODES: ReadonlyArray<{ id: CallMode; label: LocaleKey }> = [
  { id: "turns", label: "call.mode.turns" },
  { id: "live", label: "call.mode.live" },
];

/** What a mode means, in the app's language. Choosing Live is where Live is
 * turned on, so its hint says what a Live call sends to OpenAI. */
export function callModeHint(mode: CallMode): string {
  return mode === "live" ? `${t("call.mode.liveHint")} ${t("call.live.disclosure")}` : t("call.mode.turnsHint");
}

export function parseCallMode(value: string | null): CallMode {
  return value === "live" ? "live" : "turns";
}

function readStored(): CallMode {
  try {
    return parseCallMode(globalThis.localStorage?.getItem(CALL_MODE_KEY) ?? null);
  } catch {
    return "turns";
  }
}

let current: CallMode = readStored();
const watchers = new Set<() => void>();

export function callMode(): CallMode {
  return current;
}

export function setCallMode(next: CallMode): void {
  if (next === current) return;
  current = next;
  try {
    globalThis.localStorage?.setItem(CALL_MODE_KEY, next);
  } catch {
    // Private windows may refuse storage; the choice still holds this session.
  }
  for (const fn of Array.from(watchers)) fn();
}

export function useCallMode(): CallMode {
  return useSyncExternalStore(
    (fn) => {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
    () => current,
    () => current,
  );
}
