import { useSyncExternalStore } from "react";

export const NOTIFICATION_SOUNDS_KEY = "omb-notification-sounds";

// Whether desktop notifications on THIS computer may play the platform's
// alert sound. The server still decides what is worth a notification (each
// bot's own switch); this only decides whether it dings when it lands. Kept
// per renderer, like the thread display choice: a laptop in a meeting and a
// desk machine can differ, and nothing about the conversation is in it.
//
// Same shape as thread-preferences.ts: a session choice survives blocked or
// full storage, and another window's storage event supersedes it.
let sessionChoice: boolean | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** True unless this computer has muted notification sounds. Plain function
 * rather than a hook because the notification path runs outside React. */
export function notificationSoundsEnabled(): boolean {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    return storage()?.getItem(NOTIFICATION_SOUNDS_KEY) !== "0";
  } catch {
    return true;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== NOTIFICATION_SOUNDS_KEY && event.key !== null) return;
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

export function setNotificationSounds(enabled: boolean): void {
  sessionChoice = enabled;
  try {
    const local = storage();
    const value = enabled ? "1" : "0";
    local?.setItem(NOTIFICATION_SOUNDS_KEY, value);
    // Notifications also read this outside mounted Settings. Prefer storage
    // when it works, so another window's change cannot leave a stale override.
    if (local?.getItem(NOTIFICATION_SOUNDS_KEY) === value) sessionChoice = undefined;
  } catch {
    // The visible setting still changes for this session when storage is full.
  }
  notify();
}

export function useNotificationSounds(): boolean {
  return useSyncExternalStore(subscribe, notificationSoundsEnabled, () => true);
}

// Nudge sound: whether a RECEIVED nudge plays its sound on THIS computer.
// Same storage rules as the notification sounds above; on by default.
export const NUDGE_SOUND_KEY = "omb-nudge-sound";
let nudgeSessionChoice: boolean | undefined;

export function nudgeSoundEnabled(): boolean {
  if (nudgeSessionChoice !== undefined) return nudgeSessionChoice;
  try {
    return storage()?.getItem(NUDGE_SOUND_KEY) !== "0";
  } catch {
    return true;
  }
}

function onNudgeStorage(event: StorageEvent) {
  if (event.key !== NUDGE_SOUND_KEY && event.key !== null) return;
  if (event.storageArea && event.storageArea !== storage()) return;
  nudgeSessionChoice = undefined;
  notify();
}

function subscribeNudge(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined") window.addEventListener("storage", onNudgeStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onNudgeStorage);
  };
}

export function setNudgeSound(enabled: boolean): void {
  nudgeSessionChoice = enabled;
  try {
    const local = storage();
    const value = enabled ? "1" : "0";
    local?.setItem(NUDGE_SOUND_KEY, value);
    if (local?.getItem(NUDGE_SOUND_KEY) === value) nudgeSessionChoice = undefined;
  } catch {
    // The visible setting still changes for this session when storage is full.
  }
  notify();
}

export function useNudgeSound(): boolean {
  return useSyncExternalStore(subscribeNudge, nudgeSoundEnabled, () => true);
}
