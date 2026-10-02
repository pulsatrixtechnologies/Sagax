// Voice mode settings (Voice, Speed, Language in the voice bar's panel).
// Kept in localStorage under VOICE_MODE_STORAGE_KEY; on an organization
// server that key travels with the person (shared/user-preferences.ts), so
// the same choice follows them from the Mac to Windows and back.
import { useSyncExternalStore } from "react";

import {
  DEFAULT_VOICE_MODE_SETTINGS,
  VOICE_MODE_LANGUAGES,
  VOICE_MODE_STORAGE_KEY,
  cleanVoiceModeSettings,
  type VoiceModeSettings,
} from "../../../shared/voice-mode";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

const watchers = new Set<() => void>();
let cached: { raw: string | null; value: VoiceModeSettings } | null = null;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The saved settings, cleaned (an unknown or broken value reads as the default). */
export function readVoiceModeSettings(store: Storage | null = storage()): VoiceModeSettings {
  let raw: string | null = null;
  try {
    raw = store?.getItem(VOICE_MODE_STORAGE_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (cached && cached.raw === raw) return cached.value;
  let value = DEFAULT_VOICE_MODE_SETTINGS;
  if (raw) {
    try {
      value = cleanVoiceModeSettings(JSON.parse(raw));
    } catch {
      value = DEFAULT_VOICE_MODE_SETTINGS;
    }
  }
  cached = { raw, value };
  return value;
}

/** Save a change; the preference sync carries it to the server. */
export function writeVoiceModeSettings(patch: Partial<VoiceModeSettings>, store: Storage | null = storage()): VoiceModeSettings {
  const next = cleanVoiceModeSettings({ ...readVoiceModeSettings(store), ...patch });
  try {
    store?.setItem(VOICE_MODE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage refused: the choice lasts for this window only */
  }
  cached = null;
  for (const fn of Array.from(watchers)) fn();
  return next;
}

function subscribe(fn: () => void): () => void {
  watchers.add(fn);
  // another window, or the preference sync writing the server's value
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === VOICE_MODE_STORAGE_KEY) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    watchers.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function useVoiceModeSettings(): VoiceModeSettings {
  return useSyncExternalStore(subscribe, () => readVoiceModeSettings(), () => DEFAULT_VOICE_MODE_SETTINGS);
}

/** "1x", "1.25x" */
export function speedLabel(speed: number): string {
  return `${Number(speed.toFixed(2))}x`;
}

export function languageLabel(code: string): string {
  return VOICE_MODE_LANGUAGES.find((language) => language.code === code)?.label ?? code;
}
