import { useSyncExternalStore } from "react";

export const ROUTINES_BADGE_KEY = "sagax-show-routines-badge";

// Only a renderer preference: no conversation or server configuration belongs
// here. Keep a session choice even if private/blocked storage rejects reads or
// writes; another window's storage event can supersede that choice.
let sessionChoice: boolean | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function showRoutinesBadge(): boolean {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    return storage()?.getItem(ROUTINES_BADGE_KEY) === "1";
  } catch {
    return false;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== ROUTINES_BADGE_KEY && event.key !== null) return;
  if (event.storageArea && event.storageArea !== storage()) return;
  sessionChoice = undefined;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function setShowRoutinesBadge(enabled: boolean): void {
  sessionChoice = enabled;
  try {
    storage()?.setItem(ROUTINES_BADGE_KEY, enabled ? "1" : "0");
  } catch {
    // The visible setting still changes for this session when storage is full.
  }
  notify();
}

export function useShowRoutinesBadge(): boolean {
  return useSyncExternalStore(subscribe, showRoutinesBadge, () => false);
}
