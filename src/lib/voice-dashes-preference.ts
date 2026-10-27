import { useSyncExternalStore } from "react";
import { voiceDashesEnabled, VOICE_DASHES_PREFERENCE } from "../../shared/voice-dashes";

// Settings > Models and voice > Voice > "No em or en dashes in replies"
// (shared/voice-dashes.ts). One of USER_PREFERENCE_KEYS: on an organization
// server it follows the person to the server, which cleans the replies.
// Absent means the person never chose: on for French, off otherwise.
const listeners = new Set<() => void>();
let sessionChoice: string | null | undefined;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function stored(): string | undefined {
  if (sessionChoice !== undefined) return sessionChoice ?? undefined;
  try {
    return storage()?.getItem(VOICE_DASHES_PREFERENCE) ?? undefined;
  } catch {
    return undefined;
  }
}

export function readVoiceDashes(language: string | undefined): boolean {
  return voiceDashesEnabled(stored(), language);
}

export function setVoiceDashes(on: boolean): void {
  sessionChoice = on ? "on" : "off";
  try {
    storage()?.setItem(VOICE_DASHES_PREFERENCE, sessionChoice);
  } catch {
    /* storage refused: this session keeps the choice */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== VOICE_DASHES_PREFERENCE) return;
    sessionChoice = undefined;
    listener();
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.("storage", onStorage);
  };
}

export function useVoiceDashes(language: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () => readVoiceDashes(language), () => false);
}
