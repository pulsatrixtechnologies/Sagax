// "View as a member" (2026-10-30, Providers, lot 1): an organization admin
// sees Providers (and, later, Models and the bot's model list) as a member
// of their organization does, to check what the organization's lists leave
// them. A view only: it changes no right and no setting, and the server
// still answers as the admin. It lasts while the app is open, never saved.
import { useSyncExternalStore } from "react";

let viewAsMember = false;
const listeners = new Set<() => void>();

export function setViewAsMember(on: boolean): void {
  if (viewAsMember === on) return;
  viewAsMember = on;
  for (const listener of listeners) listener();
}

export function viewingAsMember(): boolean {
  return viewAsMember;
}

export function useViewAsMember(): boolean {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => viewAsMember,
    () => viewAsMember,
  );
}
