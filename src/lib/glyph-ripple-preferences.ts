import { useSyncExternalStore } from "react";

export const GLYPH_RIPPLE_KEY = "sagax-glyph-ripple";

// Settings > Appearance > "Glyph ripple on click": the character field
// behind the conversation (src/components/GlyphRippleLayer.tsx). A renderer
// preference of this person on this computer, like the other appearance
// switches; nothing goes to the server. Keep a session choice even if
// private/blocked storage rejects reads or writes; another window's storage
// event can supersede that choice. Off unless turned on ("1").
let sessionChoice: boolean | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function glyphRippleEnabled(): boolean {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    return storage()?.getItem(GLYPH_RIPPLE_KEY) === "1";
  } catch {
    return false;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== GLYPH_RIPPLE_KEY && event.key !== null) return;
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

export function setGlyphRippleEnabled(enabled: boolean): void {
  sessionChoice = enabled;
  try {
    storage()?.setItem(GLYPH_RIPPLE_KEY, enabled ? "1" : "0");
  } catch {
    // The visible setting still changes for this session when storage is full.
  }
  notify();
}

export function useGlyphRipple(): boolean {
  return useSyncExternalStore(subscribe, glyphRippleEnabled, () => false);
}
