// Routine folders on this device (2026-10-28): which folders of each bot are
// folded, and whether the Sort by prefix offer was already answered for a
// bot (it is offered once). Per-viewer conveniences: an unreadable or
// blocked storage only means everything is open and the offer shows.
import { routineFolderKey } from "../../shared/routine-folders";

export const ROUTINE_FOLDERS_COLLAPSED_KEY = "sagax.routineFolders.collapsed.v1";
export const ROUTINE_PREFIX_OFFER_KEY = "sagax.routineFolders.prefixOffer.v1";

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

/** True once the person sorted or dismissed the offer for this bot. */
export function routinePrefixOfferAnswered(botId: string): boolean {
  return read<unknown>(ROUTINE_PREFIX_OFFER_KEY)[botId] === true;
}

export function answerRoutinePrefixOffer(botId: string): void {
  const all = read<unknown>(ROUTINE_PREFIX_OFFER_KEY);
  all[botId] = true;
  write(ROUTINE_PREFIX_OFFER_KEY, all);
}
