// Shared state of a published page (2026-10-28, #1544): a small key/value
// store per page that the page's own script reads and writes through
// `window.sagax.page` (get, all, set, subscribe), so a mark or a claim made
// in the page stays after a refresh and every reader of the link sees it,
// with who set it and when.
//
// The page stays in its sandbox with no network: its script talks to the
// wrapper (postMessage), and the wrapper's bar reads the store from this
// server (GET /pages/state/<token>, anyone who may read the page) and
// writes it with the reader's own session (PUT /api/pages/:id/state), or,
// for a reader who is not signed in, on the public link itself (PUT
// /pages/state/<token>). Who may write which key is the page's own
// declaration within its sharing (below, 2026-10-29); the server applies it.
// The store is erased when the page is revoked or deleted.
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

/** One value as stored: what was set, by whom (a principal id, "owner", or
 * "anon:<hash>" for a reader who was not signed in: a hash of their
 * browser's random id, nothing personal), when. */
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
  /** Who set it, as a handle of this page only (never an id): equal to the
   * reader's own `me` when they set it. */
  who?: string;
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
    out[key] = { value: entry.value, name: entry.name, at: entry.at, ...(typeof entry.who === "string" && /^[\w-]{1,40}$/.test(entry.who) ? { who: entry.who } : {}) };
  }
  return out;
}

// ── who may write a key (2026-10-29) ─────────────────────────────────────
// The page declares its keys and who may write each, in its own HTML: a
// JSON block the bot writes once, read by the server from the published
// version (never from the reader's browser), so the rule holds whatever the
// page's script does:
//
//   <script type="application/sagax-state+json">
//     { "vote:*": "anyone", "decision": "editors" }
//   </script>
//
// A value is a level or { "write": level }. A key ending in `*` covers every
// key it starts (`vote:*` covers `vote:abc`); `*` alone covers every key the
// block does not name. A key named nowhere keeps the default, signed_in.
// Every level stays inside the page's sharing: `anyone` reaches a reader
// who is not signed in only while the page is shared with anyone who has
// the link. The page's person can always clear the state, or make one key
// read-only, from the reader's bar.

export const STATE_WRITE_LEVELS = ["anyone", "signed_in", "editors", "owner"] as const;
export type StateWriteLevel = (typeof STATE_WRITE_LEVELS)[number];
export const STATE_DEFAULT_LEVEL: StateWriteLevel = "signed_in";

/** Declared keys (a key, `prefix*` or `*`) and who writes each. */
export type StateRules = Record<string, StateWriteLevel>;

/** Who is writing, as the server sees them: not signed in; signed in and
 * allowed to read the page; one who may change the page; its own person. */
export type StateRole = "anon" | "signed_in" | "editor" | "owner";

export const STATE_DECLARATION_TYPE = "application/sagax-state+json";
const STATE_RULES_MAX = 100;

/** Writes of readers who are not signed in: tighter than a person's. */
export const ANON_STATE_LIMITS = {
  /** One value, as JSON. */
  valueBytes: 1024,
  /** Writes by one browser on one page per minute. */
  writesPerMinute: 20,
  /** Writes from one network address on one page per minute. */
  sourceWritesPerMinute: 120,
  /** Keys set by readers who are not signed in, on one page at once. */
  keys: 100,
} as const;

/** The name a reader sees for a write by someone not signed in. */
export function anonymousName(lang: "fr" | "en"): string {
  return lang === "fr" ? "Anonyme" : "Anonymous";
}

/** Whether a stored `by` is a reader who was not signed in. Pure. */
export function anonymousBy(by: string): boolean {
  return by.startsWith("anon:");
}

/** A browser's own random id, as the wrapper sends it (x-sagax-reader). */
export const READER_ID = /^[A-Za-z0-9_-]{16,64}$/;
export const READER_ID_HEADER = "x-sagax-reader";

function levelOf(value: unknown): StateWriteLevel | null {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as { write?: unknown }).write : value;
  return typeof raw === "string" && (STATE_WRITE_LEVELS as readonly string[]).includes(raw) ? raw as StateWriteLevel : null;
}

/** A declaration as the page wrote it: known levels on valid keys and
 * patterns, at most 100; anything else is left out. Pure. */
export function parseStateRules(value: unknown): StateRules {
  const rules: StateRules = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return rules;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(rules).length >= STATE_RULES_MAX) break;
    const level = levelOf(raw);
    const stem = key.endsWith("*") ? key.slice(0, -1) : key;
    if (!level || (stem !== "" && !validStateKey(stem)) || (stem === "" && key !== "*")) continue;
    rules[key] = level;
  }
  return rules;
}

/** The declaration in a page's HTML: its first sagax-state block, or no
 * rules. Pure. */
export function stateRulesOf(html: string): StateRules {
  const match = /<script\b[^>]*\btype\s*=\s*["']?application\/sagax-state\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/i.exec(html);
  if (!match) return {};
  try {
    return parseStateRules(JSON.parse(match[1]!));
  } catch {
    return {};
  }
}

/** The level for one key: its own rule, else the longest pattern it starts
 * with, else `*`, else the default. Pure. */
export function stateLevelFor(rules: StateRules, key: string): StateWriteLevel {
  if (Object.prototype.hasOwnProperty.call(rules, key) && !key.endsWith("*")) return rules[key]!;
  let best: { stem: number; level: StateWriteLevel } | null = null;
  for (const [pattern, level] of Object.entries(rules)) {
    if (!pattern.endsWith("*") || pattern === "*") continue;
    const stem = pattern.slice(0, -1);
    if (key.startsWith(stem) && (!best || stem.length > best.stem)) best = { stem: stem.length, level };
  }
  return best?.level ?? rules["*"] ?? STATE_DEFAULT_LEVEL;
}

/** Whether this writer may write this key. `publicLink`: the page is
 * shared with anyone who has the link (and the organization allows it);
 * `locked`: its person made the key read-only. Pure. */
export function stateMayWrite(role: StateRole, level: StateWriteLevel, input: { publicLink: boolean; locked: boolean }): boolean {
  if (input.locked) return false;
  if (role === "anon") return level === "anyone" && input.publicLink;
  if (level === "anyone" || level === "signed_in") return true;
  if (level === "editors") return role === "editor" || role === "owner";
  return role === "owner";
}

/** What a reader's wrapper hands the page about writing: the rules, the
 * read-only keys and the reader's role. */
export interface StateAccess {
  role: StateRole;
  rules: StateRules;
  locked: string[];
  publicLink: boolean;
}

/** The access part of a state answer, checked; null when absent. Pure. */
export function parseStateAccess(value: unknown): StateAccess | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const role = record.role;
  if (role !== "anon" && role !== "signed_in" && role !== "editor" && role !== "owner") return null;
  const locked = Array.isArray(record.locked) ? record.locked.filter((key): key is string => validStateKey(key)) : [];
  return { role, rules: parseStateRules(record.rules), locked, publicLink: record.publicLink === true };
}

/** Whether this reader may write this key, or (no key) at least one key:
 * the same rule the server applies, for the page to show its controls.
 * Pure. */
export function stateWritable(access: StateAccess, key?: string): boolean {
  const may = (k: string) => stateMayWrite(access.role, stateLevelFor(access.rules, k), { publicLink: access.publicLink, locked: access.locked.includes(k) });
  if (key !== undefined) return may(key);
  return ["\u0000", ...Object.keys(access.rules)].some(may);
}
