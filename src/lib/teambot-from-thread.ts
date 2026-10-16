// "Create a Team Bot from this conversation": the thread menus ask, one
// dialog answers (TeamBotFromThreadHost, mounted once by App). A tiny store
// so the menus (sidebar rows, the header picker) need no new props.
import { useSyncExternalStore } from "react";

export interface TeamBotFromThreadRequest {
  botId: string;
  threadId: string;
  title: string;
}

let current: TeamBotFromThreadRequest | null = null;
const listeners = new Set<() => void>();
/** Bots whose threads may start a Team Bot (the viewer's visible bots). */
let sources: ReadonlySet<string> = new Set();

function emit(): void {
  for (const listener of listeners) listener();
}

export function openTeamBotFromThread(request: TeamBotFromThreadRequest): void {
  current = request;
  emit();
}

export function closeTeamBotFromThread(): void {
  current = null;
  emit();
}

export function useTeamBotFromThreadRequest(): TeamBotFromThreadRequest | null {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => current,
    () => null,
  );
}

/** The host keeps this list current; a menu offers the action for these. */
export function setTeamBotSources(ids: Iterable<string>): void {
  sources = new Set(ids);
}

export function teamBotSourceAllowed(ownerId: string): boolean {
  return sources.has(ownerId);
}
