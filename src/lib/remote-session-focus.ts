// Which remote session the Computer tab should show. The server keeps the
// same choice for the shell; this store updates the panel before the next poll.
import { useSyncExternalStore } from "react";

let focused: { botId: string; id: string } | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function focusRemoteSessionLocal(botId: string, id: string) {
  focused = { botId, id };
  emit();
}

export function clearRemoteSessionLocal(botId: string, id: string) {
  if (focused?.botId === botId && focused.id === id) {
    focused = null;
    emit();
  }
}

export function useFocusedRemoteSession(botId: string): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (focused?.botId === botId ? focused.id : null),
    () => null,
  );
}

// Prendre le contrôle opens the Computer tab in every mode. Simple hides that
// tab otherwise, so the bot whose remote session is being controlled is kept
// here until the Computer tab closes.
let controlling: string | null = null;
const controlListeners = new Set<() => void>();

function emitControl() {
  for (const listener of controlListeners) listener();
}

export function startRemoteControl(botId: string) {
  if (controlling === botId) return;
  controlling = botId;
  emitControl();
}

export function endRemoteControl() {
  if (controlling === null) return;
  controlling = null;
  emitControl();
}

export function remoteControlBot(): string | null {
  return controlling;
}

export function useRemoteControlBot(): string | null {
  return useSyncExternalStore(
    (listener) => {
      controlListeners.add(listener);
      return () => controlListeners.delete(listener);
    },
    () => controlling,
    () => null,
  );
}
