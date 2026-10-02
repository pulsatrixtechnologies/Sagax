// What a message sent to a busy conversation does by default
// (shared/parallel-tasks.ts): "ask" offers the three choices each time,
// otherwise the chosen one applies without asking. Stored in localStorage
// under BUSY_SEND_PREFERENCE_KEY, one of the keys that follow the person on
// an organization server (shared/user-preferences.ts).
import { useSyncExternalStore } from "react";
import {
  BUSY_SEND_PREFERENCE_KEY,
  parseBusySendPreference,
  type BusySendPreference,
} from "../../shared/parallel-tasks";

const listeners = new Set<() => void>();
let session: BusySendPreference | null = null;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readBusySendPreference(): BusySendPreference {
  if (session) return session;
  try {
    return parseBusySendPreference(storage()?.getItem(BUSY_SEND_PREFERENCE_KEY));
  } catch {
    return "ask";
  }
}

export function writeBusySendPreference(next: BusySendPreference): void {
  session = next;
  try {
    storage()?.setItem(BUSY_SEND_PREFERENCE_KEY, next);
    session = null;
  } catch {
    // Storage refused: the choice holds for this session.
  }
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== BUSY_SEND_PREFERENCE_KEY && event.key !== null) return;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function useBusySendPreference(): BusySendPreference {
  return useSyncExternalStore(subscribe, readBusySendPreference, () => "ask");
}
