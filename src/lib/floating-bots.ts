// Floating bots: the small, always-loaded half. It only remembers which bots
// this device put "on the desktop" (and, in a browser, where), and tells the
// host when that list changes. Everything that draws or talks (the floating
// character, its balloon, the desktop windows' brain) lives behind a dynamic
// import in src/components/floating-bots, fetched only once a bot floats.
import { reportAchievement } from "./achievements";

export interface FloatingBotEntry {
  id: string;
  /** Desktop: keep the bot's window above other apps. On unless switched off. */
  top: boolean;
  /** Browser and phone: the character's offset from the viewport's bottom-right corner. */
  pos?: { right: number; bottom: number };
  /** "Hide for 1 hour": the mascot stays off the desktop until then (ms since the epoch). */
  hiddenUntil?: number;
}

/** How long "Hide for 1 hour" hides a mascot. */
export const SNOOZE_MS = 60 * 60 * 1000;

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
    const value = item as { id?: unknown; top?: unknown; pos?: { right?: unknown; bottom?: unknown }; hiddenUntil?: unknown };
    if (typeof value.id !== "string" || !BOT_ID.test(value.id) || seen.has(value.id)) continue;
    seen.add(value.id);
    const pos = value.pos && finite(value.pos.right) && finite(value.pos.bottom) ? { right: value.pos.right, bottom: value.pos.bottom } : undefined;
    const hiddenUntil = finite(value.hiddenUntil) && value.hiddenUntil > 0 ? value.hiddenUntil : undefined;
    entries.push({ id: value.id, top: value.top !== false, ...(pos ? { pos } : {}), ...(hiddenUntil ? { hiddenUntil } : {}) });
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
  reportAchievement("mascot.floated");
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

/** "Hide for 1 hour": the mascot leaves the desktop and comes back by itself at `until`. */
export function snoozeFloatingBot(botId: string, until: number, storage?: FloatingStorage): void {
  if (!finite(until)) return;
  const list = entries();
  if (!list.some((entry) => entry.id === botId)) return;
  commit(list.map((entry) => (entry.id === botId ? { ...entry, hiddenUntil: until } : entry)), storage);
}

/** Whether a floating bot is on the desktop now (not hidden for a while). */
export const floatingShown = (entry: FloatingBotEntry, now: number): boolean => !entry.hiddenUntil || entry.hiddenUntil <= now;

/** The next time a hidden mascot comes back, or null when none is hidden. */
export function nextFloatingReturn(list: readonly FloatingBotEntry[], now: number): number | null {
  const times = list.map((entry) => entry.hiddenUntil ?? 0).filter((time) => time > now);
  return times.length ? Math.min(...times) : null;
}

/**
 * "Switch bot": the mascot now stands for another bot, in the same place in
 * the list and on the desktop. False when the other bot already floats (or a
 * bad id).
 */
export function switchFloatingBot(fromId: string, toId: string, storage?: FloatingStorage): boolean {
  if (!BOT_ID.test(toId) || fromId === toId) return false;
  const list = entries();
  if (!list.some((entry) => entry.id === fromId) || list.some((entry) => entry.id === toId)) return false;
  commit(list.map((entry) => (entry.id === fromId ? { ...entry, id: toId, hiddenUntil: undefined } : entry)), storage);
  return true;
}

/** Browser and phone: remember where the character was dropped. */
export function setFloatingBotPosition(botId: string, pos: { right: number; bottom: number }, storage?: FloatingStorage): void {
  if (!finite(pos.right) || !finite(pos.bottom)) return;
  const list = entries();
  if (!list.some((entry) => entry.id === botId)) return;
  commit(list.map((entry) => (entry.id === botId ? { ...entry, pos: { right: pos.right, bottom: pos.bottom } } : entry)), storage);
}

/* ------------------------------------------------------------- settings */

export type FloatingLiveliness = "calm" | "normal" | "lively";
export const FLOATING_LIVELINESS: readonly FloatingLiveliness[] = ["calm", "normal", "lively"];

export interface FloatingBotPrefs {
  /** The mascot flies off to the screen edge while its bot works, and comes back when done. */
  flyAway: boolean;
  /** How often the mascot does something on its own. */
  liveliness: FloatingLiveliness;
}

const PREFS_KEY = "omb.floatingBots.prefs.v1";

export function readFloatingBotPrefs(storage: FloatingStorage | undefined = defaultStorage()): FloatingBotPrefs {
  let raw: unknown = null;
  try {
    raw = JSON.parse(storage?.getItem(PREFS_KEY) ?? "null");
  } catch {
    raw = null;
  }
  const value = raw && typeof raw === "object" ? (raw as { flyAway?: unknown; liveliness?: unknown }) : {};
  const liveliness = FLOATING_LIVELINESS.includes(value.liveliness as FloatingLiveliness) ? (value.liveliness as FloatingLiveliness) : "normal";
  return { flyAway: value.flyAway !== false, liveliness };
}

let prefs: FloatingBotPrefs | null = null;

export function floatingBotPrefs(): FloatingBotPrefs {
  if (!prefs) prefs = readFloatingBotPrefs();
  return prefs;
}

/** Settings > Appearance and the mascot's own menu: "Fly away during tasks". */
export function setFloatingFlyAway(on: boolean, storage: FloatingStorage | undefined = defaultStorage()): void {
  if (floatingBotPrefs().flyAway === on) return;
  savePrefs({ ...floatingBotPrefs(), flyAway: on }, storage);
}

/** Settings > Appearance and the mascot's own menu: "Activity level". */
export function setFloatingLiveliness(level: FloatingLiveliness, storage: FloatingStorage | undefined = defaultStorage()): void {
  if (!FLOATING_LIVELINESS.includes(level) || floatingBotPrefs().liveliness === level) return;
  savePrefs({ ...floatingBotPrefs(), liveliness: level }, storage);
}

/** The next activity level, for the menu item that cycles through them. */
export const nextLiveliness = (level: FloatingLiveliness): FloatingLiveliness =>
  FLOATING_LIVELINESS[(FLOATING_LIVELINESS.indexOf(level) + 1) % FLOATING_LIVELINESS.length];

function savePrefs(next: FloatingBotPrefs, storage: FloatingStorage | undefined): void {
  prefs = next;
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode or quota: the choice holds for this session */
  }
  for (const listener of listeners) listener();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/* ------------------------------------------- the old per-device character */
// The character used to be kept per device (omb.botMascots.v1). It now lives
// with the bot (bot.mascotLook, shared/mascot-look.ts); this reads the old
// record once so the app can move it onto the bots, then forgets it.

const LEGACY_MASCOTS_KEY = "omb.botMascots.v1";
const LEGACY_SHAPES: Record<string, string> = { circle: "circle", blob: "blob", squircle: "squircle", capsule: "pill", hexagon: "hexagon", drop: "drop" };

/** The old per-device choices, as bot looks: { botId: { character, style, shape } }. */
export function readLegacyBotLooks(storage: FloatingStorage | undefined = defaultStorage()): Record<string, { character: "owl" | "shape" | "trombi"; style?: "2d" | "3d"; shape?: string }> {
  let raw: unknown = null;
  try {
    raw = JSON.parse(storage?.getItem(LEGACY_MASCOTS_KEY) ?? "null");
  } catch {
    raw = null;
  }
  const out: Record<string, { character: "owl" | "shape" | "trombi"; style?: "2d" | "3d"; shape?: string }> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [botId, value] of Object.entries(raw).slice(0, 256)) {
    const old = value as { kind?: unknown; body?: unknown; style?: unknown } | null;
    if (!BOT_ID.test(botId) || !old || typeof old !== "object") continue;
    const style = old.style === "3d" || old.style === "2d" ? old.style : undefined;
    if (old.kind === "owl") out[botId] = { character: "owl", ...(style ? { style } : {}) };
    else if (old.kind === "trombi") out[botId] = { character: "trombi" };
    else if (old.kind === "body") out[botId] = { character: "shape", shape: LEGACY_SHAPES[String(old.body)] ?? "circle" };
  }
  return out;
}

export function forgetLegacyBotLooks(storage: FloatingStorage | undefined = defaultStorage()): void {
  try {
    (storage as Storage | undefined)?.removeItem?.(LEGACY_MASCOTS_KEY);
  } catch {
    /* nothing to forget */
  }
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
