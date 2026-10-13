// Who asked for the model window from outside a model chip (the sidebar's
// bot menu): one bot at a time, drawn by ModelWindowHost. The composer's
// chip opens its own menu and its Edit… item opens the same window there.
import { useSyncExternalStore } from "react";

let requested: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Open the model window on this bot. */
export function openModelWindow(botId: string): void {
  requested = botId;
  emit();
}

export function closeModelWindow(): void {
  if (requested === null) return;
  requested = null;
  emit();
}

/** The bot whose model window is open, or null. */
export function useModelWindowRequest(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => requested,
    () => null,
  );
}
