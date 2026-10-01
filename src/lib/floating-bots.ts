// Floating bots: the small, always-loaded half. It only remembers which bots
// this device put "on the desktop" (and, in a browser, where), and tells the
// host when that list changes. Everything that draws or talks (the floating
// character, its balloon, the desktop windows' brain) lives behind a dynamic
// import in src/components/floating-bots, fetched only once a bot floats.

export interface FloatingBotEntry {
  id: string;
  /** Desktop: keep the bot's window above other apps. On unless switched off. */
  top: boolean;
  /** Browser and phone: the character's offset from the viewport's bottom-right corner. */
  pos?: { right: number; bottom: number };
}

export type FloatingStorage = Pick<Storage, "getItem" | "setItem">;

const KEY = "omb.floatingBots.v1";
const CHANGE_EVENT = "omb:floating-bots";
/** The same cap as the desktop windows (electron/floating-bot-window.mjs). */
export const MAX_FLOATING_BOTS = 12;
const BOT_ID = /^[a-zA-Z0-9:_-]{1,64}$/;

function defaultStorage(): FloatingStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Reads what was saved, keeping only well-formed entries, once each, in order. */
export function readFloatingBots(storage: FloatingStorage | undefined = defaultStorage()): FloatingBotEntry[] {
  let raw: unknown = null;
  try {
    raw = JSON.parse(storage?.getItem(KEY) ?? "null");
  } catch {
    raw = null;
  }
  const list = raw && typeof raw === "object" && Array.isArray((raw as { bots?: unknown }).bots) ? (raw as { bots: unknown[] }).bots : [];
  const seen = new Set<string>();
  const entries: FloatingBotEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const value = item as { id?: unknown; top?: unknown; pos?: { right?: unknown; bottom?: unknown } };
    if (typeof value.id !== "string" || !BOT_ID.test(value.id) || seen.has(value.id)) continue;
    seen.add(value.id);
    const pos = value.pos && finite(value.pos.right) && finite(value.pos.bottom) ? { right: value.pos.right, bottom: value.pos.bottom } : undefined;
    entries.push({ id: value.id, top: value.top !== false, ...(pos ? { pos } : {}) });
    if (entries.length >= MAX_FLOATING_BOTS) break;
  }
  return entries;
}

function write(entries: FloatingBotEntry[], storage: FloatingStorage | undefined): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ bots: entries }));
  } catch {
    /* private mode or quota: the bots still float for this session */
  }
}

// Module state: the sidebar menu and the host read the same list.
let current: FloatingBotEntry[] | null = null;
const listeners = new Set<() => void>();

function entries(): FloatingBotEntry[] {
  if (!current) current = readFloatingBots();
  return current;
}

function commit(next: FloatingBotEntry[], storage = defaultStorage()): void {
  current = next;
  write(next, storage);
  for (const listener of listeners) listener();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function floatingBots(): readonly FloatingBotEntry[] {
  return entries();
}

export function isBotFloating(botId: string): boolean {
  return entries().some((entry) => entry.id === botId);
}

/** Puts a bot on the desktop. False when it cannot float (bad id, too many). */
export function floatBot(botId: string, storage?: FloatingStorage): boolean {
  if (!BOT_ID.test(botId)) return false;
  const list = entries();
  if (list.some((entry) => entry.id === botId)) return true;
  if (list.length >= MAX_FLOATING_BOTS) return false;
  commit([...list, { id: botId, top: true }], storage);
  return true;
}

/** Puts a floating bot back in the window. */
export function unfloatBot(botId: string, storage?: FloatingStorage): void {
  const list = entries();
  if (!list.some((entry) => entry.id === botId)) return;
  commit(list.filter((entry) => entry.id !== botId), storage);
}

export function toggleFloatingBot(botId: string): boolean {
  if (isBotFloating(botId)) {
    unfloatBot(botId);
    return false;
  }
  return floatBot(botId);
}

export function setFloatingBotOnTop(botId: string, top: boolean, storage?: FloatingStorage): void {
  const list = entries();
  if (!list.some((entry) => entry.id === botId && entry.top !== top)) return;
  commit(list.map((entry) => (entry.id === botId ? { ...entry, top } : entry)), storage);
}

/** Browser and phone: remember where the character was dropped. */
export function setFloatingBotPosition(botId: string, pos: { right: number; bottom: number }, storage?: FloatingStorage): void {
  if (!finite(pos.right) || !finite(pos.bottom)) return;
  const list = entries();
  if (!list.some((entry) => entry.id === botId)) return;
  commit(list.map((entry) => (entry.id === botId ? { ...entry, pos: { right: pos.right, bottom: pos.bottom } } : entry)), storage);
}

/* ------------------------------------------------------------- settings */

export interface FloatingBotPrefs {
  /** The mascot flies off to the screen edge while its bot works, and comes back when done. */
  flyAway: boolean;
}

const PREFS_KEY = "omb.floatingBots.prefs.v1";

export function readFloatingBotPrefs(storage: FloatingStorage | undefined = defaultStorage()): FloatingBotPrefs {
  let raw: unknown = null;
  try {
    raw = JSON.parse(storage?.getItem(PREFS_KEY) ?? "null");
  } catch {
    raw = null;
  }
  const value = raw && typeof raw === "object" ? (raw as { flyAway?: unknown }) : {};
  return { flyAway: value.flyAway !== false };
}

let prefs: FloatingBotPrefs | null = null;

export function floatingBotPrefs(): FloatingBotPrefs {
  if (!prefs) prefs = readFloatingBotPrefs();
  return prefs;
}

/** Settings > Appearance and the mascot's own menu: "Fly away during tasks". */
export function setFloatingFlyAway(on: boolean, storage: FloatingStorage | undefined = defaultStorage()): void {
  if (floatingBotPrefs().flyAway === on) return;
  prefs = { ...floatingBotPrefs(), flyAway: on };
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode or quota: the choice holds for this session */
  }
  for (const listener of listeners) listener();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function subscribeFloatingBots(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests only: forget the cached list so the next read comes from storage. */
export function resetFloatingBotsForTests(): void {
  current = null;
  prefs = null;
  listeners.clear();
}

/** The floating bots' brain and drawings, fetched the first time a bot floats. */
export const loadFloatingBots = () => import("@/components/floating-bots/FloatingBots");
