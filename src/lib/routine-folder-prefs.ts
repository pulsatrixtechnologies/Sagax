// Routine folders on this device (2026-10-28): which folders of each bot are
// folded, and whether the Sort by prefix offer was already answered for a
// bot (it is offered once). Per-viewer conveniences: an unreadable or
// blocked storage only means everything is open and the offer shows.
import { routineFolderKey } from "../../shared/routine-folders";

export const ROUTINE_FOLDERS_COLLAPSED_KEY = "sagax.routineFolders.collapsed.v1";
export const ROUTINE_PREFIX_OFFER_KEY = "sagax.routineFolders.prefixOffer.v1";
/** Bots whose "seen" mark was checked once against the 0.8.8 fix. */
export const ROUTINE_PREFIX_OFFER_SETTLED_KEY = "sagax.routineFolders.prefixOfferSettled.v1";

function read<T>(key: string): Record<string, T> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, T> : {};
  } catch {
    return {};
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // a private window: kept for this page only
  }
}

/** The folded folders of a bot, as folder keys. */
export function collapsedRoutineFolders(botId: string): Set<string> {
  const saved = read<unknown>(ROUTINE_FOLDERS_COLLAPSED_KEY)[botId];
  return new Set(Array.isArray(saved) ? saved.filter((name): name is string => typeof name === "string").map(routineFolderKey) : []);
}

export function saveCollapsedRoutineFolders(botId: string, folders: ReadonlySet<string>): void {
  const all = read<unknown>(ROUTINE_FOLDERS_COLLAPSED_KEY);
  if (folders.size) all[botId] = [...folders];
  else delete all[botId];
  write(ROUTINE_FOLDERS_COLLAPSED_KEY, all);
}

/** True once the person sorted (it worked) or dismissed the offer for this bot.
 * A failed try, or a server without the route, never marks it. */
export function routinePrefixOfferAnswered(botId: string): boolean {
  return read<unknown>(ROUTINE_PREFIX_OFFER_KEY)[botId] === true;
}

export function answerRoutinePrefixOffer(botId: string): void {
  const all = read<unknown>(ROUTINE_PREFIX_OFFER_KEY);
  all[botId] = true;
  write(ROUTINE_PREFIX_OFFER_KEY, all);
}

/**
 * A soft migration (once per bot). Before the fix, the offer was marked as
 * seen even when the Sort by prefix call failed (a server still without the
 * route), so it never came back. A bot that still has [Prefix] titles and no
 * folder is exactly such a bot: its mark is cleared once. Nothing is judged
 * before the routines are loaded. Returns whether the offer is answered.
 */
export function settleRoutinePrefixOffer(botId: string, state: { loaded: boolean; hasPrefixTitles: boolean; hasFolders: boolean }): boolean {
  if (state.loaded) {
    const settled = read<unknown>(ROUTINE_PREFIX_OFFER_SETTLED_KEY);
    if (settled[botId] !== true) {
      if (state.hasPrefixTitles && !state.hasFolders) {
        const all = read<unknown>(ROUTINE_PREFIX_OFFER_KEY);
        if (botId in all) { delete all[botId]; write(ROUTINE_PREFIX_OFFER_KEY, all); }
      }
      settled[botId] = true;
      write(ROUTINE_PREFIX_OFFER_SETTLED_KEY, settled);
    }
  }
  return routinePrefixOfferAnswered(botId);
}
