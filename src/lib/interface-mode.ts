import { useSyncExternalStore } from "react";

// Simple or Advanced, one choice per person. Simple is the default for a new
// install, a solo server, and an organization member. An organization owner
// or admin starts on Advanced. An explicit choice (this key) always wins.
// Nothing is deleted when the switch is off: a hidden setting keeps its value.
// The choice is written only when the person toggles it, so a role default
// can still change until then. On an organization server the key is one of
// USER_PREFERENCE_KEYS and follows the person; solo keeps it in localStorage.
export const INTERFACE_MODE_KEY = "sagax.interfaceMode.v1";

// The previous key was written on every boot (settle always stored "1").
// It is not a choice. Dropped at startup.
export const LEGACY_ADVANCED_MODE_KEY = "omb-advanced-mode";

export type InterfaceMode = "simple" | "advanced";

export type InterfaceModeRole = {
  organization: boolean;
  role: "owner" | "admin" | "member" | null;
};

export function defaultInterfaceMode(role: InterfaceModeRole | null): InterfaceMode {
  if (!role?.organization) return "simple";
  if (role.role === "owner" || role.role === "admin") return "advanced";
  return "simple";
}

// The viewer's role, published from the shell once config and the
// organization answer are known. Absent until then: Simple.
let roleSnapshot: InterfaceModeRole | null = null;
// Keep a session choice even if private/blocked storage rejects reads or
// writes; another window's storage event can supersede that choice.
let sessionChoice: InterfaceMode | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The stored choice, null when there is none, undefined when storage
 * cannot be read (that falls back to Simple, not the role default). */
function readStored(): InterfaceMode | null | undefined {
  try {
    const store = storage();
    if (!store) return null;
    const stored = store.getItem(INTERFACE_MODE_KEY);
    if (stored === "simple" || stored === "advanced") return stored;
    return null;
  } catch {
    return undefined;
  }
}

export function readInterfaceMode(): InterfaceMode {
  if (sessionChoice !== undefined) return sessionChoice;
  const stored = readStored();
  if (stored === undefined) return "simple";
  if (stored) return stored;
  return defaultInterfaceMode(roleSnapshot);
}

export function readAdvancedMode(): boolean {
  return readInterfaceMode() === "advanced";
}

/** The shell publishes who is looking. With no explicit choice, a change
 * in the role default (an organization admin's answer arriving) updates
 * subscribers. A stored or session choice is left alone. */
export function setInterfaceModeRole(role: InterfaceModeRole | null): void {
  const before = readInterfaceMode();
  roleSnapshot = role;
  if (readInterfaceMode() !== before) notify();
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== INTERFACE_MODE_KEY && event.key !== null) return;
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

export function setInterfaceMode(mode: InterfaceMode): void {
  sessionChoice = mode;
  try {
    storage()?.setItem(INTERFACE_MODE_KEY, mode);
  } catch {
    // The switch still takes effect for this session when storage is full.
  }
  notify();
}

export function setAdvancedMode(enabled: boolean): void {
  setInterfaceMode(enabled ? "advanced" : "simple");
}

/** Remove the old always-on key. It is not read. */
export function retireLegacyInterfaceMode(): void {
  try {
    storage()?.removeItem(LEGACY_ADVANCED_MODE_KEY);
  } catch {
    // Nothing to retire when storage is blocked.
  }
}

export function useAdvancedMode(): boolean {
  // The server snapshot is the same read as the client. A static render
  // (and a test) must see the stored choice, not a hardcoded Advanced.
  return useSyncExternalStore(subscribe, readAdvancedMode, readAdvancedMode);
}
