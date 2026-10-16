import { useSyncExternalStore } from "react";

export const LANGUAGE_KEY = "omb-language";

// The app language chosen on THIS device. It used to live only in the
// server's config, which every person and device on the server shares and
// which needs the admin scope to change: a chat-only teammate could not
// switch at all, and an admin's switch changed everyone's screen. The
// server's `language` stays the default for a device that never chose.
//
// "" is a choice (follow the system), so an absent key (null) and a stored
// "" are different answers. Same shape as notification-preferences.ts: a
// session choice survives blocked or full storage, and another window's
// storage event supersedes it.
let sessionChoice: string | null | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

// In the desktop app the local page and an organization server's page are
// two origins with two storages: a choice made on one was invisible to the
// other (French picked on the organization's page, English launch screen).
// Main keeps the last choice made on any of them (desktop-language.mjs) and
// it comes first. A browser has no bridge and keeps the behavior below.
function desktopLanguage(): NonNullable<Window["ogb"]>["desktopLanguage"] | undefined {
  try {
    return (globalThis as { ogb?: Window["ogb"] }).ogb?.desktopLanguage;
  } catch {
    return undefined;
  }
}

function desktopChoice(): string | null {
  try {
    const value = desktopLanguage()?.get();
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/** The language picked on this device: the desktop's last choice (any
 * origin), else this page's, as a locale code, "" for the system language,
 * or null when never picked. */
export function languageChoice(): string | null {
  const desktop = desktopChoice();
  if (desktop !== null) return desktop;
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    return storage()?.getItem(LANGUAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** This device's choice, else the server's default, else the system. */
export function effectiveLanguage(choice: string | null, serverDefault: string | undefined): string {
  return choice ?? serverDefault ?? "";
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== LANGUAGE_KEY && event.key !== null) return;
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

export function setLanguageChoice(language: string): void {
  sessionChoice = language;
  try {
    void desktopLanguage()?.set(language);
  } catch {
    // The page's own storage below still keeps it.
  }
  try {
    const local = storage();
    local?.setItem(LANGUAGE_KEY, language);
    // Prefer storage when it works, so another window's change cannot leave
    // a stale override behind.
    if (local?.getItem(LANGUAGE_KEY) === language) sessionChoice = undefined;
  } catch {
    // The visible language still changes for this session when storage is full.
  }
  notify();
}

export function useLanguageChoice(): string | null {
  return useSyncExternalStore(subscribe, languageChoice, () => null);
}
