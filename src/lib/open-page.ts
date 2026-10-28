// The page open over a conversation (2026-10-28, the reference design's page
// view): one at a time per app window. The conversation stays mounted under
// it, so closing the page puts the person back exactly where they were in
// the conversation. Each page also keeps the place its reader last scrolled
// to (only a number, in memory for this window), so a page the bot changes,
// or a page opened again, is drawn at the same place.
import { useSyncExternalStore } from "react";

export interface OpenPage {
  pageId: string;
  /** The conversation the page belongs to: its bot and thread. */
  botId: string;
  threadId: string;
  /** The title known when it was opened (the card's), until the page answers. */
  title: string;
  /** The version to show first; absent: the newest. */
  version?: number;
}

const ID = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_PLACES = 200;

let current: OpenPage | null = null;
const listeners = new Set<() => void>();
const places = new Map<string, number>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Open a page over its conversation (another open page is replaced). */
export function openPagePanel(page: OpenPage): void {
  if (!ID.test(page.pageId)) return;
  current = { ...page };
  emit();
}

/** Close the open page; with `pageId`, only when that page is the open one. */
export function closePagePanel(pageId?: string): void {
  if (!current || (pageId && current.pageId !== pageId)) return;
  current = null;
  emit();
}

/** The open page, when it belongs to this bot's conversation. Pure. */
export function openPageFor(page: OpenPage | null, botId: string, threadId: string | undefined): OpenPage | null {
  return page && page.botId === botId && (!threadId || page.threadId === threadId) ? page : null;
}

export function currentOpenPage(): OpenPage | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOpenPage(): OpenPage | null {
  return useSyncExternalStore(subscribe, currentOpenPage, currentOpenPage);
}

/** Remember how far down a page its reader is. */
export function rememberPagePlace(pageId: string, y: number): void {
  if (!ID.test(pageId) || !Number.isSafeInteger(y) || y < 0) return;
  places.delete(pageId);
  places.set(pageId, y);
  while (places.size > MAX_PLACES) places.delete(places.keys().next().value!);
}

/** Where a page was last read; 0 for a page not read yet. */
export function pagePlace(pageId: string): number {
  return places.get(pageId) ?? 0;
}

/** Tests: nothing open, no place kept. */
export function resetOpenPage(): void {
  current = null;
  places.clear();
  emit();
}

/** The newest version of a page the conversation names (its cards), so an
 * open page follows the bot's changes. Pure. */
export function latestPageVersionIn(messages: ReadonlyArray<{ pagePublish?: { pageId: string; version: number } }>, pageId: string): number | undefined {
  let latest: number | undefined;
  for (const message of messages) {
    const ref = message.pagePublish;
    if (ref && ref.pageId === pageId && (latest === undefined || ref.version > latest)) latest = ref.version;
  }
  return latest;
}
