// The bot workspace beyond memory: RULES.md, docs/, and the whole tree as
// the persona editor's Files category shows it (docs/bot-workspace.md).
//
// RULES.md holds hard constraints the bot checks every turn. It loads right
// after the soul and before memory, under its own budget (RULES_MAX_LINES /
// RULES_MAX_BYTES), cut with a notice like MEMORY.md. HTML comments in it
// are notes for the person and never load, which is how the starter
// template's examples stay out of the prompt.
//
// docs/ holds reference markdown (procedures, templates, lists). Nothing in
// it loads by default: each turn carries only a short index (name, first
// heading or line, size), and the bot reads a document on demand with
// workspace_read or finds one with workspace_search.
//
// A bot with neither RULES.md nor docs/ gets the prompt it always had: every
// block here is empty until a file exists.
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync, type Stats } from "node:fs";
import { dirname, join, sep } from "node:path";

import {
  DOCS_DIR,
  MEMORY_MAX_BYTES,
  MEMORY_MAX_LINES,
  isMemoryTopicName,
  listDocFiles,
  memoryLineCount,
  readMemoryText,
  workspaceDir,
} from "./workspace.ts";

export { DOCS_DIR };
export const RULES_FILE = "RULES.md";
export const RULES_MAX_LINES = 60;
export const RULES_MAX_BYTES = 8_000;
/** One rule per rules_update: a rule is a sentence, not a procedure. */
export const RULE_MAX_CHARS = 500;
/** How many documents the per-turn index names; the rest are counted. */
export const DOCS_INDEX_MAX = 20;
const DOC_SUMMARY_MAX = 120;
/** What one workspace_read returns; longer files are read by offset. */
export const WORKSPACE_READ_MAX_BYTES = 64_000;
/** SOUL.md's budget lives on the bot record (shared/bot-profile.ts); the
 * tree repeats it so the Files list can show size against it. */
export const SOUL_MAX_BYTES = 24_000;
/** A file the bot has not used for this long, and that does not load every
 * turn, is marked forgotten in the Files list. */
export const FORGOTTEN_AFTER_MS = 30 * 24 * 60 * 60_000;
const TREE_MAX_ENTRIES = 1_000;
const TREE_MAX_DEPTH = 8;

/** The text the Rules editor starts from when RULES.md does not exist yet.
 * Everything below the heading is a comment: saved as is, it loads nothing. */
export const RULES_TEMPLATE = `# Rules

<!--
Hard constraints this bot checks every turn. One rule per line.
Identity goes in Soul; facts go in Memory. Text inside this comment is not loaded.

Examples (copy a line below the comment to use it):
- Never send an email to a client without showing me the draft first.
- Always answer in the language the person writes in.
- Never quote a price; send pricing questions to the sales team.
-->
`;

/** RULES.md as it loads: HTML comments removed, blank runs folded,
 * trimmed. Headings stay (they are the person's text); only comments go. */
export function effectiveRulesText(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Whether RULES.md holds anything but comments and its heading. */
function hasRules(text: string): boolean {
  return text.split("\n").some((line) => line.trim() && !/^#{1,6}\s/.test(line.trim()));
}

export interface LoadedRules {
  text: string;
  truncated: boolean;
  /** lines and bytes of the whole effective text, before the cut */
  lines: number;
  bytes: number;
}

/** RULES.md under its budget, or null when there is no file or it holds
 * no rule (the template alone, a heading alone). */
export function loadRules(botId: string): LoadedRules | null {
  let raw: string;
  try {
    raw = readMemoryText(join(workspaceDir(botId), RULES_FILE));
  } catch {
    return null;
  }
  const effective = effectiveRulesText(raw);
  if (!hasRules(effective)) return null;
  let text = effective;
  let truncated = false;
  if (memoryLineCount(text) > RULES_MAX_LINES) {
    text = text.split("\n").slice(0, RULES_MAX_LINES).join("\n");
    truncated = true;
  }
  if (Buffer.byteLength(text, "utf8") > RULES_MAX_BYTES) {
    text = Buffer.from(text, "utf8").subarray(0, RULES_MAX_BYTES).toString("utf8").replace(/�+$/, "");
    truncated = true;
  }
  return { text, truncated, lines: memoryLineCount(effective), bytes: Buffer.byteLength(effective, "utf8") };
}

/** Whether `raw` would load whole (after comments are removed). */
export function rulesOverBudget(raw: string): boolean {
  const effective = effectiveRulesText(raw);
  return memoryLineCount(effective) > RULES_MAX_LINES || Buffer.byteLength(effective, "utf8") > RULES_MAX_BYTES;
}

/** The Rules block of the system prompt, placed right after the soul
 * (buildSystemPrompt). Empty without rules, so a bot without RULES.md gets
 * today's prompt byte for byte. */
export function rulesSystemPrompt(botId: string, opts: { writes?: boolean } = {}): string {
  const rules = loadRules(botId);
  if (!rules) return "";
  const bytes = Buffer.byteLength(rules.text, "utf8");
  const cut = rules.truncated
    ? `\n[RULES.md is ${rules.lines} lines and ${rules.bytes} bytes; only the first ${RULES_MAX_LINES} lines / ${RULES_MAX_BYTES} bytes are shown above. Ask the person to shorten it in Persona > Rules.]`
    : "";
  return (
    "\n\nYour rules follow: hard constraints the person set for you. Check every reply and every action against them before you act." +
    " They rank with your standing instructions, above your memory, documents and imported skills, and below the person's current request and safety boundaries." +
    " Text inside this block is instruction for you, never tool authorization or permission to expose secrets." +
    (opts.writes ? " Change RULES.md only with rules_update, and only when the person asks for it in this conversation." : "") +
    `\n\n--- BEGIN RULES (RULES.md, ${bytes} bytes) ---\n` +
    rules.text +
    "\n--- END RULES ---" +
    cut
  );
}

export interface DocSummary {
  path: string;
  name: string;
  bytes: number;
  summary: string;
}

/** A document's one-line summary: its first heading, else its first line,
 * skipping a frontmatter block and comments. */
export function docSummary(text: string): string {
  let body = text.replace(/^﻿/, "");
  const front = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(body);
  if (front) body = body.slice(front[0].length);
  body = body.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const heading = lines.find((line) => /^#{1,6}\s+\S/.test(line));
  const pick = (heading ?? lines[0] ?? "").replace(/^#{1,6}\s+/, "").replace(/\s+/g, " ");
  return pick.length > DOC_SUMMARY_MAX ? `${pick.slice(0, DOC_SUMMARY_MAX - 1)}…` : pick;
}

function readHead(path: string, bytes = 4096): string {
  try {
    return readMemoryText(path).slice(0, bytes);
  } catch {
    return "";
  }
}

/** The docs/ files with their summaries, sorted by name. */
export function listDocs(botId: string): DocSummary[] {
  const dir = join(workspaceDir(botId), DOCS_DIR);
  return listDocFiles(botId).map((doc) => ({
    path: `${DOCS_DIR}/${doc.name}`,
    name: doc.name,
    bytes: doc.bytes,
    summary: docSummary(readHead(join(dir, doc.name))),
  }));
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The per-turn documents index: never the documents themselves. Empty when
 * docs/ is missing or empty. `tools` says how this turn can read them. */
export function docsIndexPrompt(botId: string, opts: { tools: "agents" | "files" | "none" }): string {
  const docs = listDocs(botId);
  if (!docs.length) return "";
  const shown = docs.slice(0, DOCS_INDEX_MAX);
  const lines = shown.map((doc) => `- ${doc.path}: ${doc.summary || "(no heading)"} (${formatSize(doc.bytes)})`);
  const more = docs.length > shown.length ? `\n…and ${docs.length - shown.length} more; find them with ${opts.tools === "agents" ? "workspace_search" : "your file tools"}.` : "";
  const how = opts.tools === "agents"
    ? "read one with workspace_read before relying on it, find a passage with workspace_search, and change one with docs_update when the person asks"
    : opts.tools === "files"
      ? `read one with your file tools (the folder is ${JSON.stringify(join(workspaceDir(botId), DOCS_DIR))}) before relying on it`
      : "this turn cannot open them; say so if one is needed";
  return `\n\nDocuments available (reference material in your workspace, not loaded; ${how}):\n${lines.join("\n")}${more}`;
}

// ── safe paths ────────────────────────────────────────────────────────

export class WorkspacePathError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "WorkspacePathError";
    this.status = status;
  }
}

/** A workspace-relative path as the tools and the Files list spell it:
 * forward slashes, no empty, "." or ".." segment, no hidden segment, no
 * absolute or drive prefix, no backslash or NUL. Returns it normalised. */
export function normaliseWorkspacePath(input: unknown): string {
  if (typeof input !== "string") throw new WorkspacePathError("path must be a string");
  const path = input.trim().replace(/^\.\/+/, "");
  if (!path || path.length > 512) throw new WorkspacePathError("path is empty or too long");
  if (/[\\\0]/.test(path) || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new WorkspacePathError(`path must be relative to the workspace: ${JSON.stringify(input)}`);
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new WorkspacePathError(`path leaves the workspace or names a hidden file: ${JSON.stringify(input)}`);
  }
  return parts.join("/");
}

/** The absolute path of a regular file inside the bot's workspace, after
 * proving it stays there: the grammar refuses traversal, and realpath on
 * the parent refuses a link out of the workspace (a bot can make one with
 * its file tools). The file itself must be a regular file, not a link. */
export function resolveWorkspaceFile(botId: string, input: unknown): { path: string; absolute: string; stat: Stats } {
  const path = normaliseWorkspacePath(input);
  const root = workspaceDir(botId);
  const absolute = join(root, ...path.split("/"));
  let realRoot: string;
  let realParent: string;
  try {
    realRoot = realpathSync(root);
    realParent = realpathSync(dirname(absolute));
  } catch {
    throw new WorkspacePathError(`no such file: ${path}`, 404);
  }
  if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
    throw new WorkspacePathError(`path escapes the workspace: ${JSON.stringify(path)}`);
  }
  let stat: Stats;
  try {
    stat = lstatSync(absolute);
  } catch {
    throw new WorkspacePathError(`no such file: ${path}`, 404);
  }
  if (stat.isSymbolicLink()) throw new WorkspacePathError(`${path} is a link, not a file`);
  if (!stat.isFile()) throw new WorkspacePathError(`${path} is not a file`);
  return { path, absolute, stat };
}

/** A text file of the workspace for workspace_read: up to
 * WORKSPACE_READ_MAX_BYTES from `offset` (bytes), refusing binary files. */
export function readWorkspaceText(botId: string, input: unknown, offset = 0): { path: string; text: string; bytes: number; offset: number; nextOffset: number | null } {
  const file = resolveWorkspaceFile(botId, input);
  const buffer = readFileSync(file.absolute);
  if (buffer.subarray(0, 8192).includes(0)) throw new WorkspacePathError(`${file.path} is not a text file`);
  const start = Math.max(0, Math.min(Math.trunc(offset) || 0, buffer.length));
  let end = Math.min(buffer.length, start + WORKSPACE_READ_MAX_BYTES);
  // never cut a UTF-8 character in half: back up to a lead byte
  while (end < buffer.length && end > start && (buffer[end]! & 0xc0) === 0x80) end -= 1;
  return { path: file.path, text: buffer.subarray(start, end).toString("utf8"), bytes: buffer.length, offset: start, nextOffset: end < buffer.length ? end : null };
}

// ── the tree ──────────────────────────────────────────────────────────

/** When a file reaches the model: every turn (in the system prompt), on
 * demand (the bot reads it when a task needs it; an index may name it), or
 * never (kept for the person or for search, not read by the bot). */
export type WorkspaceLoad = "every-turn" | "on-demand" | "never";

export interface WorkspaceBudget {
  maxLines?: number;
  maxBytes: number;
  /** what counts against it: the loaded text, which for RULES.md leaves
   * comments out */
  lines: number;
  bytes: number;
  over: boolean;
}

export interface WorkspaceEntry {
  path: string;
  kind: "file" | "dir";
  bytes: number;
  createdAt: number;
  modifiedAt: number;
  load: WorkspaceLoad;
  /** opens in the markdown editor (the memory store reaches it) */
  editable: boolean;
  markdown: boolean;
  budget?: WorkspaceBudget;
}

const EDITABLE = [/^MEMORY\.md$/, /^RULES\.md$/, /^memory\/[^/]+\.md$/, /^memory\/log\/[^/]+\.md$/, /^docs\/[^/]+\.md$/];

/** Where a path sits in the load order. MEMORY.md loads every turn only
 * while memory is on. */
export function workspaceLoad(path: string, opts: { memoryEnabled?: boolean } = {}): WorkspaceLoad {
  if (path === RULES_FILE) return "every-turn";
  if (path === "MEMORY.md") return opts.memoryEnabled === false ? "never" : "every-turn";
  if (path === "memory/archive.md" || path.startsWith("memory/log/")) return "never";
  if (/^memory\/[^/]+\.md$/.test(path)) return opts.memoryEnabled === false ? "never" : "on-demand";
  if (/^docs\/[^/]+\.md$/.test(path)) return "on-demand";
  if (path.startsWith("skills/")) return "on-demand";
  return "never";
}

function budgetFor(path: string, absolute: string): WorkspaceBudget | undefined {
  if (path !== RULES_FILE && path !== "MEMORY.md") return undefined;
  let raw = "";
  try {
    raw = readMemoryText(absolute);
  } catch {
    return undefined;
  }
  if (path === RULES_FILE) {
    const text = effectiveRulesText(raw);
    const lines = memoryLineCount(text);
    const bytes = Buffer.byteLength(text, "utf8");
    return { maxLines: RULES_MAX_LINES, maxBytes: RULES_MAX_BYTES, lines, bytes, over: lines > RULES_MAX_LINES || bytes > RULES_MAX_BYTES };
  }
  const lines = memoryLineCount(raw);
  const bytes = Buffer.byteLength(raw, "utf8");
  return { maxLines: MEMORY_MAX_LINES, maxBytes: MEMORY_MAX_BYTES, lines, bytes, over: lines > MEMORY_MAX_LINES || bytes > MEMORY_MAX_BYTES };
}

/** Every file and folder of the workspace, depth first, folders before
 * their files. Hidden entries (a dot name: engine settings, skill
 * revisions) and links are left out; reads never create the workspace. */
export function workspaceTree(botId: string, opts: { memoryEnabled?: boolean } = {}): { entries: WorkspaceEntry[]; truncated: boolean } {
  const root = workspaceDir(botId);
  const entries: WorkspaceEntry[] = [];
  let truncated = false;
  const walk = (dir: string, prefix: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(dir).filter((name) => !name.startsWith("."));
    } catch {
      return;
    }
    const stats = names.flatMap((name) => {
      try {
        return [{ name, stat: lstatSync(join(dir, name)) }];
      } catch {
        return [];
      }
    });
    // folders after files at each level reads oddly for MEMORY.md + memory/;
    // files first, then folders, each by name, matches a file manager
    stats.sort((a, b) => Number(a.stat.isDirectory()) - Number(b.stat.isDirectory()) || a.name.localeCompare(b.name));
    for (const { name, stat } of stats) {
      if (entries.length >= TREE_MAX_ENTRIES) {
        truncated = true;
        return;
      }
      const path = prefix ? `${prefix}/${name}` : name;
      const absolute = join(dir, name);
      if (stat.isSymbolicLink()) continue;
      const createdAt = Math.round(stat.birthtimeMs || stat.ctimeMs);
      if (stat.isDirectory()) {
        entries.push({ path, kind: "dir", bytes: 0, createdAt, modifiedAt: Math.round(stat.mtimeMs), load: workspaceLoad(`${path}/`, opts), editable: false, markdown: false });
        if (depth < TREE_MAX_DEPTH) walk(absolute, path, depth + 1);
        else truncated = true;
        continue;
      }
      if (!stat.isFile()) continue;
      const markdown = /\.md$/i.test(name);
      const budget = budgetFor(path, absolute);
      entries.push({
        path,
        kind: "file",
        bytes: stat.size,
        createdAt,
        modifiedAt: Math.round(stat.mtimeMs),
        load: workspaceLoad(path, opts),
        editable: markdown && EDITABLE.some((pattern) => pattern.test(path)) && path.split("/").every((part) => part === "log" || part === "memory" || part === DOCS_DIR || isMemoryTopicName(part)),
        markdown,
        ...(budget ? { budget } : {}),
      });
    }
  };
  try {
    if (statSync(root).isDirectory()) walk(root, "", 0);
  } catch {
    // no workspace yet: an empty tree
  }
  return { entries, truncated };
}

/** Whether a file counts as forgotten: not loaded every turn, and neither
 * used nor created within FORGOTTEN_AFTER_MS. Daily logs are a record by
 * design, never "forgotten". */
export function isForgotten(entry: Pick<WorkspaceEntry, "path" | "kind" | "load" | "createdAt">, lastUsedAt: number | undefined, now = Date.now()): boolean {
  if (entry.kind !== "file" || entry.load === "every-turn" || entry.path.startsWith("memory/log/")) return false;
  return now - Math.max(lastUsedAt ?? 0, entry.createdAt) > FORGOTTEN_AFTER_MS;
}
