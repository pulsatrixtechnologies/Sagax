// What a person hid from their own sidebar: bots, groups and conversations
// with other people. Hiding is a view choice only: nothing is deleted, the
// conversations stay, nobody else sees a change, and every hidden entry is
// still reached through search, the command palette and the To: picker.
//
// Stored in localStorage under SIDEBAR_HIDDEN_KEY, one of the keys that
// follow the person to every device on an organization server
// (shared/user-preferences.ts). On a solo server it stays on this device.
import { useSyncExternalStore } from "react";
import { z } from "zod";

export const SIDEBAR_HIDDEN_KEY = "sagax.sidebarHidden.v1";

/** A bot (by bot id), a group (by group id) or a person (by principal id:
 * their direct conversation with the viewer). */
export type HiddenKind = "bot" | "group" | "person";

export interface HiddenEntry {
  kind: HiddenKind;
  id: string;
  /** When it was hidden: only a message after this brings it back. */
  at: number;
}

export interface SidebarHiddenPrefs {
  items: HiddenEntry[];
  /** Whether a new message brings a hidden entry back. People (and groups,
   * where people write) default to on: a colleague writing to you should
   * not go unseen. Bots default to off: a bot posts on its own (routines,
   * reports), so one hidden for being noisy would come back at every run. */
  unhideOnMessage: { people: boolean; bots: boolean };
}

export const DEFAULT_SIDEBAR_HIDDEN: SidebarHiddenPrefs = Object.freeze({
  items: [],
  unhideOnMessage: Object.freeze({ people: true, bots: false }),
}) as SidebarHiddenPrefs;

/** A bound, not a quota: the value must fit one preference (8 KiB). */
export const MAX_HIDDEN = 100;

const schema = z.object({
  items: z.array(z.object({
    kind: z.enum(["bot", "group", "person"]),
    id: z.string().min(1).max(200),
    at: z.number().finite().nonnegative(),
  })).catch([]),
  unhideOnMessage: z.object({ people: z.boolean().catch(true), bots: z.boolean().catch(false) }).catch({ people: true, bots: false }),
});

export function hiddenKey(kind: HiddenKind, id: string): string {
  return `${kind}:${kind === "person" ? id.trim().toLowerCase() : id}`;
}

export function parseSidebarHidden(raw: string | null | undefined): SidebarHiddenPrefs {
  if (!raw) return DEFAULT_SIDEBAR_HIDDEN;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_SIDEBAR_HIDDEN;
    const seen = new Set<string>();
    const items = parsed.data.items.filter((item) => {
      const key = hiddenKey(item.kind, item.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(-MAX_HIDDEN);
    return { items, unhideOnMessage: parsed.data.unhideOnMessage };
  } catch {
    return DEFAULT_SIDEBAR_HIDDEN;
  }
}

export function serializeSidebarHidden(prefs: SidebarHiddenPrefs): string {
  return JSON.stringify({ items: prefs.items.slice(-MAX_HIDDEN), unhideOnMessage: prefs.unhideOnMessage });
}

export function withHidden(prefs: SidebarHiddenPrefs, kind: HiddenKind, id: string, at: number): SidebarHiddenPrefs {
  const key = hiddenKey(kind, id);
  const items = prefs.items.filter((item) => hiddenKey(item.kind, item.id) !== key);
  return { ...prefs, items: [...items, { kind, id: kind === "person" ? id.trim().toLowerCase() : id, at }].slice(-MAX_HIDDEN) };
}

export function withoutHidden(prefs: SidebarHiddenPrefs, keys: readonly string[]): SidebarHiddenPrefs {
  const drop = new Set(keys);
  const items = prefs.items.filter((item) => !drop.has(hiddenKey(item.kind, item.id)));
  return items.length === prefs.items.length ? prefs : { ...prefs, items };
}

export function hiddenKeySet(prefs: SidebarHiddenPrefs): Set<string> {
  return new Set(prefs.items.map((item) => hiddenKey(item.kind, item.id)));
}

interface Activity { unread: boolean; messages: readonly { at: number; role?: string }[]; tasks?: readonly { updatedAt?: number }[] }

function newestAt(entry: Activity): number {
  let newest = entry.messages.at(-1)?.at ?? 0;
  for (const task of entry.tasks ?? []) newest = Math.max(newest, task.updatedAt ?? 0);
  return newest;
}

/**
 * The hidden entries a new unread message brings back, by the person's
 * setting: people and groups when `people` is on, bots when `bots` is on.
 * `personGroup` finds the direct conversation with a person.
 */
export function entriesToUnhide(
  prefs: SidebarHiddenPrefs,
  input: {
    bots: readonly (Activity & { id: string })[];
    groups: readonly (Activity & { id: string })[];
    personGroup: (personId: string) => (Activity & { id: string }) | undefined;
  },
): string[] {
  const out: string[] = [];
  for (const item of prefs.items) {
    const on = item.kind === "bot" ? prefs.unhideOnMessage.bots : prefs.unhideOnMessage.people;
    if (!on) continue;
    const entry = item.kind === "bot"
      ? input.bots.find((bot) => bot.id === item.id)
      : item.kind === "group"
        ? input.groups.find((group) => group.id === item.id)
        : input.personGroup(item.id);
    if (entry?.unread && newestAt(entry) > item.at) out.push(hiddenKey(item.kind, item.id));
  }
  return out;
}

// ── the page's store ─────────────────────────────────────────────────────

let session: SidebarHiddenPrefs | null = null;
let cachedRaw: string | null | undefined;
let cachedValue: SidebarHiddenPrefs = DEFAULT_SIDEBAR_HIDDEN;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readSidebarHidden(): SidebarHiddenPrefs {
  if (session) return session;
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(SIDEBAR_HIDDEN_KEY) ?? null;
  } catch {
    raw = null;
  }
  // useSyncExternalStore needs the same object while the value is the same.
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parseSidebarHidden(raw);
  }
  return cachedValue;
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== SIDEBAR_HIDDEN_KEY && event.key !== null) return;
  session = null;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function writeSidebarHidden(next: SidebarHiddenPrefs): void {
  session = next;
  try {
    storage()?.setItem(SIDEBAR_HIDDEN_KEY, serializeSidebarHidden(next));
    session = null;
  } catch {
    // Storage refused: the choice holds for this session.
  }
  notify();
}

export function hideFromSidebar(kind: HiddenKind, id: string, now: number = Date.now()): void {
  writeSidebarHidden(withHidden(readSidebarHidden(), kind, id, now));
}

export function showInSidebar(keys: string | readonly string[]): void {
  const current = readSidebarHidden();
  const next = withoutHidden(current, typeof keys === "string" ? [keys] : keys);
  if (next !== current) writeSidebarHidden(next);
}

export function setUnhideOnMessage(kind: "people" | "bots", on: boolean): void {
  const current = readSidebarHidden();
  writeSidebarHidden({ ...current, unhideOnMessage: { ...current.unhideOnMessage, [kind]: on } });
}

export function useSidebarHidden(): SidebarHiddenPrefs {
  return useSyncExternalStore(subscribe, readSidebarHidden, () => DEFAULT_SIDEBAR_HIDDEN);
}
