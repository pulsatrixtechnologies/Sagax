// How this computer takes part in a live call: hands-free (the call hears
// the person whenever they speak, like a phone) or push-to-talk, and "Only
// my voice". Kept on this device only (`omb.voiceCall.v1`, not in the
// preferences that travel): a microphone and a room belong to a computer.
import { useSyncExternalStore } from "react";

export const CALL_SETTINGS_KEY = "omb.voiceCall.v1";

export interface CallSettings {
  /** "auto": hands-free with barge-in; "push": hold Space (or the button) to talk */
  input: "auto" | "push";
  /** accept turns from the enrolled voice only (needs an enrollment) */
  onlyMyVoice: boolean;
  /** subtle tones for connect, interrupt, hold and end */
  earcons: boolean;
  /** a soft tone when the answer is slow to start (over THINKING_CUE_MS
   * after the person stopped), so the silence is not a dead line */
  thinkingCue: boolean;
  /** how long a pause ends a turn: short (fast answers), normal, or
   * patient (the person thinks between phrases) */
  pause: CallPause;
  /** the settings card's Advanced zone is open (closed by default) */
  advancedOpen: boolean;
}

export type CallPause = "short" | "normal" | "patient";
export const CALL_PAUSES: readonly CallPause[] = ["short", "normal", "patient"];

export const DEFAULT_CALL_SETTINGS: CallSettings = { input: "auto", onlyMyVoice: true, earcons: true, thinkingCue: true, pause: "normal", advancedOpen: false };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const watchers = new Set<() => void>();
let cached: { raw: string | null; value: CallSettings } | null = null;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function cleanCallSettings(value: unknown): CallSettings {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    input: record.input === "push" ? "push" : "auto",
    onlyMyVoice: typeof record.onlyMyVoice === "boolean" ? record.onlyMyVoice : DEFAULT_CALL_SETTINGS.onlyMyVoice,
    earcons: typeof record.earcons === "boolean" ? record.earcons : DEFAULT_CALL_SETTINGS.earcons,
    thinkingCue: typeof record.thinkingCue === "boolean" ? record.thinkingCue : DEFAULT_CALL_SETTINGS.thinkingCue,
    pause: CALL_PAUSES.includes(record.pause as CallPause) ? (record.pause as CallPause) : DEFAULT_CALL_SETTINGS.pause,
    advancedOpen: typeof record.advancedOpen === "boolean" ? record.advancedOpen : DEFAULT_CALL_SETTINGS.advancedOpen,
  };
}

export function readCallSettings(store: Storage | null = storage()): CallSettings {
  let raw: string | null = null;
  try {
    raw = store?.getItem(CALL_SETTINGS_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (cached && cached.raw === raw) return cached.value;
  let value = DEFAULT_CALL_SETTINGS;
  try {
    value = raw ? cleanCallSettings(JSON.parse(raw)) : DEFAULT_CALL_SETTINGS;
  } catch {
    value = DEFAULT_CALL_SETTINGS;
  }
  cached = { raw, value };
  return value;
}

export function writeCallSettings(patch: Partial<CallSettings>, store: Storage | null = storage()): CallSettings {
  const next = cleanCallSettings({ ...readCallSettings(store), ...patch });
  try {
    store?.setItem(CALL_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* storage refused: lasts for this window */
  }
  cached = null;
  for (const fn of Array.from(watchers)) fn();
  return next;
}

/** Tell watchers something call-related changed (an enrollment). */
export function notifyCallSettings(): void {
  cached = null;
  for (const fn of Array.from(watchers)) fn();
}

function subscribe(fn: () => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

export function useCallSettings(): CallSettings {
  return useSyncExternalStore(subscribe, () => readCallSettings(), () => DEFAULT_CALL_SETTINGS);
}
