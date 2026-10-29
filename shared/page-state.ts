// Shared state of a published page (2026-10-28, #1544): a small key/value
// store per page that the page's own script reads and writes through
// `window.sagax.page` (get, all, set, subscribe), so a mark or a claim made
// in the page stays after a refresh and every reader of the link sees it,
// with who set it and when.
//
// The page stays in its sandbox with no network: its script talks to the
// wrapper (postMessage), and the wrapper's bar reads the store from this
// server (GET /pages/state/<token>, anyone who may read the page) and
// writes it with the reader's own session (PUT /api/pages/:id/state,
// anyone signed in who may annotate the page). A reader who is not signed
// in reads it only. The store is erased when the page is revoked or deleted.
// A page that never uses the bridge behaves as before.

export const STATE_LIMITS = {
  keys: 200,
  keyChars: 100,
  /** One value, as JSON. */
  valueBytes: 4 * 1024,
  /** Every value of a page, as JSON. */
  totalBytes: 64 * 1024,
  /** Writes by one person on one page per minute. */
  writesPerMinute: 60,
} as const;

/** One value as stored: what was set, by whom (a principal id, "owner" or
 * nobody else), when. */
export interface PageStateEntry {
  value: unknown;
  by: string;
  at: number;
}

/** One value as a reader gets it: the name of who set it, never their id. */
export interface PageStateView {
  value: unknown;
  name: string;
  at: number;
}

export const STATE_PREFIX = "/pages/state/";

const KEY = /^[\p{L}\p{N}_.:/#@ -]{1,100}$/u;

/** A key the page names: letters, digits and a few separators, 1 to
 * keyChars characters. Pure. */
export function validStateKey(key: unknown): key is string {
  return typeof key === "string" && key.length <= STATE_LIMITS.keyChars && KEY.test(key);
}

/** A value the page sets, as JSON text, or null when it is not plain JSON
 * data or too large. `null` (the JSON value) clears the key. Pure. */
export function stateValueJson(value: unknown): string | null {
  if (value === undefined) return null;
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    return null;
  }
  if (text === undefined || new TextEncoder().encode(text).length > STATE_LIMITS.valueBytes) return null;
  return text;
}

// ── between the page's frame and the wrapper ─────────────────────────────

/** frame -> wrapper: send me the state. */
export const STATE_ASK_MESSAGE = "sagax-state-ask";
/** frame -> wrapper: set one key (`id` comes back with the result). */
export const STATE_SET_MESSAGE = "sagax-state-set";
/** wrapper -> frame: the whole state and whether this reader may write. */
export const STATE_MESSAGE = "sagax-state";
/** wrapper -> frame: how a set went. */
export const STATE_RESULT_MESSAGE = "sagax-state-result";

/** A set the frame posted, checked, or null. Pure. */
export function parseStateSet(data: unknown): { id: number; key: string; value: unknown } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.type !== STATE_SET_MESSAGE || record.v !== 1) return null;
  if (typeof record.id !== "number" || !Number.isSafeInteger(record.id) || record.id < 0) return null;
  if (!validStateKey(record.key) || stateValueJson(record.value) === null) return null;
  return { id: record.id, key: record.key, value: record.value };
}

/** A state answer from the server, as the wrapper passes it on: names and
 * values only. Pure. */
export function parseStateAnswer(value: unknown): Record<string, PageStateView> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = (value as { entries?: unknown }).entries;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return null;
  const out: Record<string, PageStateView> = {};
  for (const [key, raw] of Object.entries(entries as Record<string, unknown>)) {
    if (!validStateKey(key) || !raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.name !== "string" || typeof entry.at !== "number") continue;
    out[key] = { value: entry.value, name: entry.name, at: entry.at };
  }
  return out;
}
