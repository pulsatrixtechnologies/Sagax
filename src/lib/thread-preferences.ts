import { useSyncExternalStore } from "react";

export const SHOW_THREADS_KEY = "omb-show-threads";

// Only a renderer preference: no conversation or server configuration belongs
// here. Keep a session choice even if private/blocked storage rejects reads or
// writes; another window's storage event can supersede that choice.
//
// On by default: a person who never chose (no stored value, or storage that
// cannot be read) sees threads. Any stored value other than "1" (the switch writes "0") is a recorded off, so the
// person's own "off" is kept. On an organization server the value travels as
// the synced key `omb-show-threads` (shared/user-preferences.ts); an absent
// key means unset, so the server holds no default of its own.
let sessionChoice: boolean | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export const SHOW_THREADS_DEFAULT = true;

function showThreads(): boolean {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    const stored = storage()?.getItem(SHOW_THREADS_KEY);
    // Only a missing value is "unset". Any stored value keeps its old reading
    // ("1" is on, everything else is off), so nobody who chose off is moved.
    return stored === null || stored === undefined ? SHOW_THREADS_DEFAULT : stored === "1";
  } catch {
    return SHOW_THREADS_DEFAULT;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== SHOW_THREADS_KEY && event.key !== null) return;
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

export function setShowThreads(enabled: boolean): void {
  sessionChoice = enabled;
  try {
    storage()?.setItem(SHOW_THREADS_KEY, enabled ? "1" : "0");
  } catch {
    // The visible setting still changes for this session when storage is full.
  }
  notify();
}

/** The person's own choice in Settings > Appearance, whatever the mode. */
export function useShowThreadsChoice(): boolean {
  return useSyncExternalStore(subscribe, showThreads, () => SHOW_THREADS_DEFAULT);
}

/** Whether the sidebar shows threads: the person's choice, in Simple and
 * Advanced mode alike. Thread mode is on by default for everyone (AGENTS.md,
 * "Thread mode is on by default"), so Simple mode does not hide it the way
 * the upstream project does. */
export function useShowThreads(): boolean {
  return useShowThreadsChoice();
}
