// The engines' own session files of a confidential thread
// (docs/confidential-threads.md, « Engine transcripts »).
//
// Every engine that resumes a conversation keeps it on disk in its own home:
// Claude Code `projects/<folder>/<session>.jsonl` (and `history.jsonl`),
// Codex `sessions/YYYY/MM/DD/rollout-…-<thread>.jsonl` with its
// `state_*.sqlite`, `logs_*.sqlite` and `history.jsonl`, Hermes `state.db`
// and `sessions/`, Grok `sessions/<folder>/<session>/`, pi
// `sessions/--<folder>--/…_<session>.jsonl`, Cursor `acp-sessions/<session>/`,
// Gemini and Qwen `tmp/<sha256 of the folder>/chats/…json` and `logs.json`,
// OpenCode `storage/session/…/<session>.json`. Those homes live under the
// data folder on a server (`principals/<person>/<engine>`, `org/<engine>-key`,
// `engine-policies/hermes-*`, `providers/`) or in the server's user home.
//
// A thread's files are found by keys, never by guessing which files are
// whose: the thread id (an engine that files sessions by working folder
// writes it in the folder's name, since a confidential thread always works
// in `task-workspaces/<bot>/<thread>`), the md5 and sha256 of that folder
// (engines that hash it), and every session id an engine announced for the
// thread (`session.started`, kept on the task as `engineSessions`). Keys are
// widened from what the homes say about them: the session ids filed under a
// folder named by a key, the rows of an engine database whose folder column
// holds a key, the lines of a prompt history that name a key.
//
// Then, in each home: an entry whose name holds a key goes whole; prompt
// histories and engine logs lose the lines that hold a key; an engine
// database loses the rows whose id or folder column holds one (full-text
// indexes rebuilt, then VACUUM with secure_delete); a Gemini-style chat file
// whose sessionId is a key goes. Nothing else is read or changed: another
// thread's transcript that mentions a key (a list_threads result) is left
// whole, so its own session still resumes.
import { createHash } from "node:crypto";
import { closeSync, type Dirent, lstatSync, openSync, readdirSync, readFileSync, readSync, realpathSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { writeFileAtomic } from "./atomic.ts";

type Env = Record<string, string | undefined>;

const MAX_DEPTH = 8;
const MAX_ENTRIES = 400_000;
const MAX_TEXT_BYTES = 64 * 1024 ** 2;
const MAX_CHAT_BYTES = 16 * 1024 ** 2;
/** Folders no engine files a session in: installs, caches, bundles. */
const SKIPPED_DIRS = new Set(["node_modules", ".git", "bin", "npm", "bundled", "cache", ".cache", "Cache", "downloads", "extensions", "plugins", "installed-plugins", "marketplace-cache", "skills", "completions", "docs"]);
/** A folder named after another session or thread (a UUID in its name):
 * everything in it is that one's, so the walk does not enter it. Without
 * this a home with thousands of sessions costs seconds per purge. */
const ANOTHER_ONES = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Columns that name a row's thread, session or folder in an engine
 * database. Content columns (a prompt, a reply) are never matched. */
const ID_COLUMN = /^(?:id|uuid|key|(?:parent_?)?(?:thread|session|conversation|chat|task|agent_session)_?id|rollout_?path|cwd|project|project_?(?:path|dir|root)|path|file_?path|workspace|work_?dir|directory|source_?path)$/i;
/** The columns among those that hold an id a row can be found again by. */
const SESSION_COLUMN = /^(?:id|uuid|(?:thread|session|conversation|chat|task)_?id)$/i;
const PATH_COLUMN = /^(?:rollout_?path|cwd|project|project_?(?:path|dir|root)|path|file_?path|workspace|work_?dir|directory|source_?path)$/i;

/** A value an engine gave as a session id, when it is distinctive enough to
 * be matched in file names and columns: 12 to 200 characters of an id
 * alphabet, at least one digit (a word like "fake-session" or "default" is
 * no session id). */
export function sessionKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 12 || text.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text) || !/\d/.test(text)) return null;
  return text;
}

/** The session ids a value carries: a resume cursor is usually the id
 * itself, sometimes an object holding it. */
export function sessionKeysOf(value: unknown, out: Set<string> = new Set()): Set<string> {
  const direct = sessionKey(value);
  if (direct) out.add(direct);
  else if (value && typeof value === "object") {
    for (const item of Array.isArray(value) ? value : Object.values(value)) {
      if (typeof item === "string") { const key = sessionKey(item); if (key) out.add(key); }
      else if (item && typeof item === "object") sessionKeysOf(item, out);
    }
  }
  return out;
}

/** The keys of a thread's own folder: its id, and the md5 and sha256 of the
 * folder (as given and resolved) that engines bucketing by a hash use. */
export function threadKeys(threadId: string, folders: readonly string[] = []): string[] {
  const keys = new Set<string>();
  if (/^[A-Za-z0-9_-]{8,128}$/.test(threadId)) keys.add(threadId);
  for (const folder of folders) {
    if (!folder) continue;
    const variants = new Set([folder, resolve(folder)]);
    try { variants.add(realpathSync(folder)); } catch { /* gone already */ }
    for (const path of variants) {
      keys.add(createHash("md5").update(path).digest("hex"));
      keys.add(createHash("sha256").update(path).digest("hex"));
    }
  }
  return [...keys];
}

/** A thread's keys from its record: thread keys plus its session ids. */
export function taskEngineKeys(task: { threadId: string; resumeCursors?: Record<string, unknown>; engineSessions?: readonly string[] }, folders: readonly string[] = [], more: Iterable<string> = []): string[] {
  const keys = new Set(threadKeys(task.threadId, folders));
  sessionKeysOf(task.resumeCursors ?? {}, keys);
  for (const id of task.engineSessions ?? []) { const key = sessionKey(id); if (key) keys.add(key); }
  for (const id of more) { const key = sessionKey(id); if (key) keys.add(key); }
  return [...keys];
}

/** The session ids a thread's event log announced (`session.started`),
 * for threads from before `engineSessions` was kept. */
export function eventLogSessionIds(path: string): string[] {
  const out = new Set<string>();
  let text = "";
  try {
    if (!lstatSync(path).isFile() || lstatSync(path).size > MAX_TEXT_BYTES) return [];
    text = readFileSync(path, "utf8");
  } catch { return []; }
  for (const line of text.split("\n")) {
    if (!line.includes("session.started")) continue;
    try {
      const event = JSON.parse(line) as { type?: unknown; sessionId?: unknown };
      if (event.type === "session.started") { const key = sessionKey(event.sessionId); if (key) out.add(key); }
    } catch { /* a torn line */ }
  }
  return [...out];
}

// ── where the engines keep their homes ──────────────────────────────────

function directory(path: string | undefined): string | null {
  if (!path) return null;
  try { return lstatSync(path).isDirectory() ? resolve(path) : null; } catch { return null; }
}
function children(path: string): string[] {
  try { return readdirSync(path).map((name) => join(path, name)).filter((child) => directory(child) !== null); } catch { return []; }
}

/** The engine homes under a server's data folder: every person's engine
 * folders (`principals/<id>/<engine>`), the organization's key homes
 * (`org/<engine>-key`), the homes Sagax owns for withheld turns
 * (`engine-policies/*`) and the managed provider homes (`providers/`). */
export function dataEngineHomes(dataDir: string): string[] {
  const out: string[] = [];
  for (const person of children(join(dataDir, "principals"))) out.push(...children(person));
  out.push(...children(join(dataDir, "org")), ...children(join(dataDir, "engine-policies")));
  const providers = directory(join(dataDir, "providers"));
  if (providers) out.push(providers);
  return out;
}

/** The homes the engines use in a process environment: each CLI's own
 * variable, else its folder in the user's home. */
export function environmentEngineHomes(env: Env, configDirs: readonly string[] = []): string[] {
  const home = process.platform === "win32" ? env.USERPROFILE || env.HOME || "" : env.HOME || env.USERPROFILE || "";
  const at = (variable: string | undefined, ...fallback: string[]) => variable?.trim() ? variable.trim() : home ? join(home, ...fallback) : undefined;
  const candidates = [
    at(env.CLAUDE_CONFIG_DIR, ".claude"), ...configDirs,
    at(env.CODEX_HOME, ".codex"),
    at(env.GROK_HOME, ".grok"),
    at(env.KIMI_CODE_HOME, ".kimi"),
    at(env.HERMES_HOME, ".hermes"),
    env.GEMINI_CLI_HOME?.trim() ? join(env.GEMINI_CLI_HOME.trim(), ".gemini") : at(undefined, ".gemini"),
    at(undefined, ".qwen"),
    at(env.PI_CODING_AGENT_DIR, ".pi", "agent"),
    at(undefined, ".cursor"),
    at(env.FACTORY_HOME_OVERRIDE, ".factory"),
    at(undefined, ".cline"),
    env.XDG_DATA_HOME?.trim() ? join(env.XDG_DATA_HOME.trim(), "opencode") : at(undefined, ".local", "share", "opencode"),
  ];
  return candidates.map((path) => directory(path)).filter((path): path is string => path !== null);
}

/** Homes in a stable order, none inside another (it is walked already). */
export function distinctHomes(homes: Iterable<string>): string[] {
  const sorted = [...new Set([...homes].map((home) => resolve(home)))].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const out: string[] = [];
  for (const home of sorted) if (!out.some((parent) => home === parent || home.startsWith(parent + sep))) out.push(home);
  return out;
}

// ── matching ─────────────────────────────────────────────────────────────

function holdsKey(text: string, keys: ReadonlySet<string>): boolean {
  for (const key of keys) if (text.includes(key)) return true;
  return false;
}
/** A prompt history or an engine log, filed line by line: Claude's and
 * Codex's `history.jsonl`, the `*.jsonl` and `*.log` of a `logs` folder.
 * A line that names a key is that thread's, whatever else it says. */
function lineIndexFile(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]/);
  const name = parts.at(-1) ?? "";
  if (/^(?:history|prompt[-_]?history)\.jsonl$/i.test(name) && parts.length <= 3) return true;
  return parts.length >= 2 && parts.length <= 4 && parts.at(-2)!.toLowerCase() === "logs" && /\.(?:jsonl|ndjson|log)$/i.test(name);
}
/** Gemini's and Qwen's prompt log: a JSON array of entries with a sessionId. */
function arrayIndexFile(relativePath: string): boolean {
  return /(?:^|[\\/])logs\.json$/i.test(relativePath);
}
/** A Gemini-style chat record (`…/chats/session-….json`): its name carries
 * only a prefix of the session id, its body the whole id. */
function chatFile(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]/);
  return parts.length >= 2 && parts.at(-2)!.toLowerCase() === "chats" && /\.json$/i.test(parts.at(-1) ?? "");
}
/** Whether a database's bytes (its file and journal files) hold a key at
 * all: SQLite keeps text as it is, so a database without a key's bytes
 * holds no row of it and is never opened. A very large one is opened. */
function databaseBytesHoldKey(path: string, keys: ReadonlySet<string>): boolean {
  for (const file of [path, `${path}-wal`, `${path}-journal`]) {
    let stat;
    try { stat = lstatSync(file); } catch { continue; }
    if (!stat.isFile()) continue;
    if (stat.size > 512 * 1024 ** 2) return true;
    let bytes: Buffer;
    try { bytes = readFileSync(file); } catch { return true; }
    for (const key of keys) if (bytes.includes(key)) return true;
  }
  return false;
}
function sqliteFile(path: string): boolean {
  if (!/\.(?:sqlite3?|db)$/i.test(path)) return false;
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const header = Buffer.alloc(16);
    return readSync(fd, header, 0, 16, 0) === 16 && header.toString("latin1") === "SQLite format 3\u0000";
  } catch { return false; } finally { if (fd !== undefined) closeSync(fd); }
}

/** Whether an entry of a home belongs to a key's thread by its name. */
export function namedByKey(name: string, keys: ReadonlySet<string>): boolean {
  return holdsKey(name, keys);
}

/** Session ids in the names under a folder named by a key: Claude's
 * `<session>.jsonl`, Grok's `<session>/`, pi's `<time>_<session>.jsonl`. */
function idsInNames(path: string, into: Set<string>): void {
  let names: string[] = [];
  try { names = readdirSync(path); } catch { return; }
  for (const name of names) {
    const stem = name.replace(/\.(?:jsonl|json|ndjson|txt|db)$/i, "");
    const whole = sessionKey(stem);
    if (whole && /[0-9a-f]{8}/i.test(stem)) into.add(whole);
    for (const match of stem.matchAll(UUID)) into.add(match[0]);
  }
}

// ── databases ────────────────────────────────────────────────────────────

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
interface TableShape { name: string; fts: boolean; external: boolean; columns: string[] }
function tablesOf(db: DatabaseSync): TableShape[] {
  const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string; sql: string | null }>;
  const fts = rows.filter((row) => /\bUSING\s+fts[345]\b/i.test(row.sql ?? "")).map((row) => row.name);
  const shadow = (name: string) => fts.some((table) => name.startsWith(`${table}_`));
  const out: TableShape[] = [];
  for (const row of rows) {
    if (row.name.startsWith("sqlite_") || shadow(row.name)) continue;
    let columns: string[] = [];
    try { columns = (db.prepare(`PRAGMA table_xinfo(${quote(row.name)})`).all() as Array<{ name: string }>).map((column) => column.name); } catch { continue; }
    const isFts = fts.includes(row.name);
    out.push({ name: row.name, fts: isFts, external: isFts && /\bcontent\s*=\s*(?!''|"")[^,)]+/i.test(row.sql ?? ""), columns });
  }
  return out;
}

/** Ids of rows whose folder column holds a key (Codex's `threads.cwd`). */
function idsInDatabase(path: string, keys: ReadonlySet<string>, into: Set<string>): void {
  if (!databaseBytesHoldKey(path, keys)) return;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true, timeout: 2_000 });
    for (const table of tablesOf(db)) {
      if (table.external) continue;
      const ids = table.columns.filter((column) => SESSION_COLUMN.test(column));
      const paths = table.columns.filter((column) => PATH_COLUMN.test(column));
      if (!ids.length || !paths.length) continue;
      for (const column of paths) {
        const read = db.prepare(`SELECT ${ids.map(quote).join(", ")} FROM ${quote(table.name)} WHERE instr(CAST(${quote(column)} AS TEXT), ?) > 0 LIMIT 10000`);
        for (const key of keys) {
          for (const row of read.all(key) as Array<Record<string, unknown>>) for (const value of Object.values(row)) { const id = sessionKey(value); if (id) into.add(id); }
        }
      }
    }
  } catch { /* unreadable or locked: the scrub tries again */ } finally { db?.close(); }
}

/** Whether a row of the database names a key (read only: no write lock is
 * taken on a database that holds nothing of the keys). */
function databaseNamesKey(path: string, keys: ReadonlySet<string>): boolean {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 3_000 });
  try {
    for (const table of tablesOf(db)) {
      if (table.external) continue;
      for (const column of table.columns.filter((name) => ID_COLUMN.test(name))) {
        const read = db.prepare(`SELECT 1 FROM ${quote(table.name)} WHERE instr(CAST(${quote(column)} AS TEXT), ?) > 0 LIMIT 1`);
        for (const key of keys) if (read.get(key)) return true;
      }
    }
    return false;
  } finally {
    db.close();
  }
}

/** Delete the rows of a key's threads from an engine database: rows whose
 * id or folder column holds a key, in every table but full-text shadow
 * tables; full-text indexes rebuilt or merged; then VACUUM with
 * secure_delete so no free page keeps them. Returns the rows deleted.
 * Throws when the database is held (the purge is then kept to retry). */
export function scrubEngineDatabase(path: string, keys: ReadonlySet<string>): number {
  if (!keys.size || !databaseBytesHoldKey(path, keys) || !databaseNamesKey(path, keys)) return 0;
  const db = new DatabaseSync(path, { timeout: 3_000 });
  try {
    db.exec("PRAGMA secure_delete = ON");
    const tables = tablesOf(db);
    let deleted = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of tables) {
        if (table.external) continue;
        for (const column of table.columns.filter((name) => ID_COLUMN.test(name))) {
          const remove = db.prepare(`DELETE FROM ${quote(table.name)} WHERE instr(CAST(${quote(column)} AS TEXT), ?) > 0`);
          for (const key of keys) deleted += Number(remove.run(key).changes);
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    if (!deleted) return 0;
    for (const table of tables.filter((shape) => shape.fts)) {
      // an external-content index is rebuilt from what stays; an index of its
      // own content merges its segments, which drops deleted terms
      try { db.exec(`INSERT INTO ${quote(table.name)}(${quote(table.name)}) VALUES ('${table.external ? "rebuild" : "optimize"}')`); } catch { /* a contentless index: nothing kept to rebuild */ }
    }
    db.exec("VACUUM");
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* not in WAL mode */ }
    return deleted;
  } finally {
    db.close();
  }
}

// ── text stores ──────────────────────────────────────────────────────────

function readSmall(path: string, limit: number): string | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > limit) return null;
    return readFileSync(path, "utf8");
  } catch { return null; }
}
/** A line file without the lines that name a key, or null when none does. */
export function linesWithoutKeys(text: string, keys: ReadonlySet<string>): string | null {
  if (!holdsKey(text, keys)) return null;
  return text.split("\n").filter((line) => !holdsKey(line, keys)).join("\n");
}
/** A JSON array without the entries that name a key, or null. */
export function arrayWithoutKeys(text: string, keys: ReadonlySet<string>): string | null {
  if (!holdsKey(text, keys)) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(value)) return null;
  const kept = value.filter((item) => !holdsKey(JSON.stringify(item), keys));
  return kept.length === value.length ? null : JSON.stringify(kept, null, 2);
}
function chatSession(text: string): string | null {
  try {
    const value = JSON.parse(text) as { sessionId?: unknown };
    return typeof value?.sessionId === "string" ? value.sessionId : null;
  } catch { return null; }
}
function sessionIdsInLines(text: string, keys: ReadonlySet<string>, into: Set<string>): void {
  for (const line of text.split("\n")) {
    if (!holdsKey(line, keys)) continue;
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      for (const field of ["sessionId", "session_id", "conversationId", "conversation_id", "thread_id", "threadId"]) { const id = sessionKey(value[field]); if (id) into.add(id); }
    } catch { /* not JSON */ }
  }
}
function rewrite(path: string, text: string): void {
  const mode = lstatSync(path).mode & 0o777;
  writeFileAtomic(path, text, { mode: mode || 0o600 });
}

// ── the walk ─────────────────────────────────────────────────────────────

/** One entry of a home, as the walk found it. `kind` says what a purge may
 * look inside: a prompt history or log, a JSON prompt log, a chat record,
 * a database, or nothing (only its name counts). */
interface Indexed { path: string; name: string; dir: boolean; kind: "lines" | "array" | "chat" | "database" | null }

/** Every entry of the homes, depth first, links never followed, folders
 * named after another session or thread not entered (ANOTHER_ONES), read
 * once so widening the keys and purging cost one walk. */
export function indexEngineHomes(homes: readonly string[]): { entries: Indexed[]; complete: boolean } {
  const entries: Indexed[] = [];
  let left = MAX_ENTRIES;
  for (const home of homes) {
    const go = (dir: string, rel: string, depth: number) => {
      if (depth > MAX_DEPTH || left <= 0) return;
      let found: Dirent[];
      try { found = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      found.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const entry of found) {
        if (--left <= 0) return;
        const name = entry.name;
        const path = join(dir, name);
        const childRel = rel ? `${rel}/${name}` : name;
        // a link is never followed, nor taken for a folder
        const isDir = entry.isDirectory();
        const kind = isDir || !entry.isFile() ? null
          : lineIndexFile(childRel) ? "lines" : arrayIndexFile(childRel) ? "array" : chatFile(childRel) ? "chat"
            : /\.(?:sqlite3?|db)$/i.test(name) && sqliteFile(path) ? "database" : null;
        entries.push({ path, name, dir: isDir, kind });
        if (isDir && !SKIPPED_DIRS.has(name) && !ANOTHER_ONES.test(name)) go(path, childRel, depth + 1);
      }
    };
    go(home, "", 1);
  }
  return { entries, complete: left > 0 };
}

/** The keys a set of homes adds to a thread's: the session ids filed under a
 * folder its keys name, in database rows whose folder holds one, and on
 * the history lines that name one. Read only. */
export function widenKeys(homes: readonly string[], seed: Iterable<string>, index = indexEngineHomes(homes)): Set<string> {
  const keys = new Set(seed);
  if (!keys.size) return keys;
  const texts = new Map<string, string | null>();
  const text = (path: string) => { if (!texts.has(path)) texts.set(path, readSmall(path, MAX_TEXT_BYTES)); return texts.get(path)!; };
  const listed = new Set<string>();
  for (let round = 0; round < 3; round++) {
    const before = keys.size;
    for (const entry of index.entries) {
      if (namedByKey(entry.name, keys)) {
        if (entry.dir && !listed.has(entry.path)) { listed.add(entry.path); idsInNames(entry.path, keys); }
        continue;
      }
      if (entry.kind === "lines") { const body = text(entry.path); if (body) sessionIdsInLines(body, keys, keys); }
      else if (entry.kind === "database") idsInDatabase(entry.path, keys, keys);
    }
    if (keys.size === before) break;
  }
  return keys;
}

export interface EnginePurgeResult {
  /** entries removed whole (files and folders) */
  removed: number;
  /** history and log files rewritten without a line */
  rewritten: number;
  /** database rows deleted */
  rows: number;
  /** homes' paths a purge could not finish (held, unreadable): retried */
  failed: string[];
}

/** Remove everything of the keys' threads from the homes (see the header).
 * Keys are widened first (widenKeys). Never throws: what it could not do is
 * listed in `failed`, for the caller to keep and retry. */
export function purgeEngineSessions(homes: readonly string[], seed: Iterable<string>): EnginePurgeResult & { keys: Set<string> } {
  const index = indexEngineHomes(homes);
  const keys = widenKeys(homes, seed, index);
  const result: EnginePurgeResult = { removed: 0, rewritten: 0, rows: 0, failed: [] };
  if (!keys.size) return { ...result, keys };
  const removed: string[] = [];
  for (const entry of index.entries) {
    if (removed.some((parent) => entry.path.startsWith(parent + sep))) continue;
    try {
      if (namedByKey(entry.name, keys)) {
        rmSync(entry.path, { recursive: true, force: true });
        result.removed++;
        if (entry.dir) removed.push(entry.path);
        continue;
      }
      if (entry.kind === "lines" || entry.kind === "array") {
        const text = readSmall(entry.path, MAX_TEXT_BYTES);
        const next = text === null ? null : entry.kind === "lines" ? linesWithoutKeys(text, keys) : arrayWithoutKeys(text, keys);
        if (next !== null) { rewrite(entry.path, next); result.rewritten++; }
      } else if (entry.kind === "chat") {
        const text = readSmall(entry.path, MAX_CHAT_BYTES);
        const session = text === null ? null : chatSession(text);
        if (session && keys.has(session)) { rmSync(entry.path, { force: true }); result.removed++; }
      } else if (entry.kind === "database") {
        result.rows += scrubEngineDatabase(entry.path, keys);
      }
    } catch {
      result.failed.push(entry.path);
    }
  }
  if (!index.complete) result.failed.push("(entry budget reached)");
  return { ...result, keys };
}

// ── the workspace backup (server/workspace-backup.ts) ────────────────────

/** The part of a data-relative path that names an engine home, or null:
 * `principals/<person>/<engine>`, `org/<engine>`, `engine-policies/<name>`
 * (`providers/` never leaves in a backup). */
export function engineHomeOf(path: string): string | null {
  const parts = path.split("/");
  if (parts[0] === "principals" && parts.length >= 3) return parts.slice(0, 3).join("/");
  if ((parts[0] === "org" || parts[0] === "engine-policies") && parts.length >= 2) return parts.slice(0, 2).join("/");
  return null;
}

/** Whether a data-relative path is an engine's file of a confidential
 * thread by its name: inside an engine home, an entry whose name holds a
 * key (a transcript, a session folder, a folder named after the thread's). */
export function confidentialEngineSessionPath(path: string, keys: ReadonlySet<string>): boolean {
  if (!keys.size) return false;
  const home = engineHomeOf(path);
  if (!home || home === path) return false;
  return path.slice(home.length + 1).split("/").some((part) => namedByKey(part, keys));
}

/** How a backup copies a file of an engine home that may name a key inside
 * it: "lines" (a prompt history or log, without the key's lines), "array"
 * (Gemini's logs.json), "chat" (left out when its session is a key),
 * "database" (snapshotted, then scrubbed), or null (copied as it is). */
export function engineStoreKind(path: string, absolute: string): "lines" | "array" | "chat" | "database" | null {
  const home = engineHomeOf(path);
  if (!home || home === path) return null;
  const rel = path.slice(home.length + 1);
  if (lineIndexFile(rel)) return "lines";
  if (arrayIndexFile(rel)) return "array";
  if (chatFile(rel)) return "chat";
  if (sqliteFile(absolute)) return "database";
  return null;
}

/** A database's sidecars (`-wal`, `-shm`, `-journal`): a snapshot of the
 * database already holds what they committed. */
export function databaseSidecarOf(path: string): string | null {
  const match = /^(.*\.(?:sqlite3?|db))-(?:wal|shm|journal)$/i.exec(path);
  return match ? match[1]! : null;
}

/** A chat file's session id is a key: the file is the key's thread's. */
export function chatOfKeys(text: string, keys: ReadonlySet<string>): boolean {
  const session = chatSession(text);
  return session !== null && keys.has(session);
}

export const ENGINE_PURGE_FILE = "confidential-engine-purge.json";
export const ENGINE_PURGE_DONE = "confidential-engine-sessions-v1";

/** The keys of purges not finished yet (a held database, an engine that
 * still ran): retried at start and after every purge. Ids only. */
export function readPendingPurges(dataDir: string): string[][] {
  const text = readSmall(join(dataDir, ENGINE_PURGE_FILE), MAX_TEXT_BYTES);
  if (!text) return [];
  try {
    const value = JSON.parse(text) as { pending?: unknown };
    return Array.isArray(value.pending) ? value.pending.filter((keys): keys is string[] => Array.isArray(keys) && keys.every((key) => typeof key === "string")).slice(-500) : [];
  } catch { return []; }
}
export function writePendingPurges(dataDir: string, pending: readonly string[][]): void {
  const path = join(dataDir, ENGINE_PURGE_FILE);
  if (!pending.length) { rmSync(path, { force: true }); return; }
  writeFileAtomic(path, JSON.stringify({ pending: pending.slice(-500) }), { mode: 0o600 });
}

/** For a log line: how many homes and keys, never a path or a key. */
export function describePurge(result: EnginePurgeResult): string {
  return `${result.removed} entr${result.removed === 1 ? "y" : "ies"}, ${result.rewritten} file(s) rewritten, ${result.rows} row(s)${result.failed.length ? `, ${result.failed.length} left to retry` : ""}`;
}

