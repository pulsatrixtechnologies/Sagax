// The writes behind rules_update and docs_update, and the Files list's
// rename. Every write goes through the memory store (containment, secret
// scrub, 0600, conflict hash) and the memory journal (an audit row the
// person can read and revert in History), exactly like a memory edit.
import { RULES_PATH, MemoryStoreError, readMemoryDoc } from "./memory-store.ts";
import { journalMemoryDelete, journalMemoryWrite, type MemoryActor, type MemoryJournalEntry } from "./memory-journal.ts";
import { redactSecretsInText } from "./redact.ts";
import { DOCS_DIR, RULE_MAX_CHARS, RULES_MAX_BYTES, RULES_MAX_LINES, effectiveRulesText, rulesOverBudget } from "./workspace-files.ts";
import { MEMORY_FILE_MAX_BYTES, isMemoryTopicName, memoryLineCount } from "./workspace.ts";
import { markWorkspaceUse } from "./workspace-usage.ts";

export type WorkspaceWriteResult =
  | { ok: true; path: string; entry?: string; lines?: number; bytes?: number; journal: MemoryJournalEntry | null }
  | { ok: false; code: "invalid" | "conflict" | "over-budget" | "exists" | "missing"; error: string };

export interface RulesUpdate {
  action: "append" | "replace" | "remove";
  text?: string;
  oldText?: string;
}

const BULLET = /^(?:[-*•]|\d+[.)])\s+/;

/** One rule as a line: the model's own bullet dropped, folded onto one
 * line, scrubbed. */
function ruleLine(text: string): string {
  return `- ${redactSecretsInText(text).trim().replace(BULLET, "").replace(/\s*\n\s*/g, " ").replace(/[ \t]+/g, " ")}`;
}

/** The text RULES.md becomes after one update, or why it does not change.
 * Pure. The same guard rails as memory_update: one rule per append, an
 * exact unique old_text for replace and remove, secrets scrubbed, and a
 * write that would not load whole is refused rather than cut. */
export function applyRulesUpdate(current: string, update: RulesUpdate): { ok: true; next: string; entry?: string } | { ok: false; code: "invalid" | "conflict" | "over-budget"; error: string } {
  const needsText = update.action !== "remove";
  const needsOld = update.action !== "append";
  if (!["append", "replace", "remove"].includes(update.action)
    || (needsText && (typeof update.text !== "string" || !update.text.trim()))
    || (!needsText && update.text !== undefined)
    || (needsOld && (typeof update.oldText !== "string" || !update.oldText.trim()))
    || (!needsOld && update.oldText !== undefined)) {
    return { ok: false, code: "invalid", error: "Use append with text, replace with text and old_text, or remove with old_text." };
  }
  if (update.text !== undefined && update.text.length > RULE_MAX_CHARS) {
    return { ok: false, code: "invalid", error: `text is ${update.text.length} characters; keep one rule to at most ${RULE_MAX_CHARS} characters.` };
  }
  let next: string;
  let entry: string | undefined;
  if (update.action === "append") {
    entry = ruleLine(update.text!);
    const base = current.trim() ? current : "# Rules\n\n";
    next = `${base}${base.endsWith("\n") ? "" : "\n"}${entry}\n`;
  } else {
    const oldText = update.oldText!;
    const index = current.indexOf(oldText);
    if (index === -1 || current.indexOf(oldText, index + 1) !== -1) {
      return { ok: false, code: "conflict", error: "old_text must match exactly once in the current RULES.md. Read it again (workspace_read RULES.md) and retry with a current, unique passage." };
    }
    if (update.action === "remove") {
      next = current.slice(0, index) + current.slice(index + oldText.length);
      const atLineStart = index === 0 || next[index - 1] === "\n";
      if (atLineStart && next[index] === "\n") next = next.slice(0, index) + next.slice(index + 1);
    } else {
      entry = redactSecretsInText(update.text!).trim();
      next = current.slice(0, index) + entry + current.slice(index + oldText.length);
    }
  }
  if (rulesOverBudget(next)) {
    const text = effectiveRulesText(next);
    return {
      ok: false,
      code: "over-budget",
      error: `RULES.md would be ${memoryLineCount(text)} lines and ${Buffer.byteLength(text, "utf8")} bytes, over what loads each turn (${RULES_MAX_LINES} lines / ${RULES_MAX_BYTES} bytes). Nothing was saved. Ask the person which rule to shorten or remove.`,
    };
  }
  return { ok: true, next, entry };
}

/** rules_update: read, apply, write through the journal as the bot's. */
export function updateRules(botId: string, update: RulesUpdate, opts: { threadId?: string; actor?: MemoryActor; via?: string } = {}): WorkspaceWriteResult {
  const current = readMemoryDoc(botId, RULES_PATH);
  const applied = applyRulesUpdate(current.text, update);
  if (!applied.ok) return applied;
  try {
    const { doc, entry } = journalMemoryWrite(botId, RULES_PATH, applied.next, {
      actor: opts.actor ?? "bot",
      via: opts.via ?? "tool",
      threadId: opts.threadId,
      expectedHash: current.hash,
    });
    markWorkspaceUse(botId, [RULES_PATH]);
    const text = effectiveRulesText(doc.text);
    return { ok: true, path: RULES_PATH, entry: applied.entry, lines: memoryLineCount(text), bytes: Buffer.byteLength(text, "utf8"), journal: entry };
  } catch (error) {
    return storeRefusal(error);
  }
}

function storeRefusal(error: unknown): WorkspaceWriteResult {
  if (!(error instanceof MemoryStoreError)) throw error;
  return { ok: false, code: error.code === "conflict" ? "conflict" : "invalid", error: error.message };
}

/** A document path as the tools accept it: `docs/<name>.md`, or a bare
 * `<name>.md` (placed in docs/). Null when it is anything else. */
export function docPath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().replace(/^\.\/+/, "");
  const name = trimmed.startsWith(`${DOCS_DIR}/`) ? trimmed.slice(DOCS_DIR.length + 1) : trimmed;
  return isMemoryTopicName(name) ? `${DOCS_DIR}/${name}` : null;
}

export interface DocUpdate {
  action: "write" | "append" | "replace" | "delete";
  path: string;
  text?: string;
  oldText?: string;
}

/** docs_update: write a whole document (create or overwrite), append to
 * it, replace an exact unique passage, or delete it. */
export function updateDoc(botId: string, update: DocUpdate, opts: { threadId?: string; actor?: MemoryActor; via?: string } = {}): WorkspaceWriteResult {
  const path = docPath(update.path);
  if (!path) return { ok: false, code: "invalid", error: "path must be docs/<name>.md: letters, digits, spaces, dots, dashes or underscores, ending in .md, no folders." };
  if (!["write", "append", "replace", "delete"].includes(update.action)) {
    return { ok: false, code: "invalid", error: "action is write, append, replace or delete." };
  }
  const journal = { actor: opts.actor ?? "bot", via: opts.via ?? "tool", threadId: opts.threadId } as const;
  try {
    const current = readMemoryDoc(botId, path);
    if (update.action === "delete") {
      if (!current.exists) return { ok: false, code: "missing", error: `${path} does not exist.` };
      const entry = journalMemoryDelete(botId, path, journal);
      return { ok: true, path, journal: entry };
    }
    if (typeof update.text !== "string" || (update.action !== "write" && !update.text.trim())) {
      return { ok: false, code: "invalid", error: `${update.action} needs text.` };
    }
    let next: string;
    if (update.action === "write") next = update.text.endsWith("\n") ? update.text : `${update.text}\n`;
    else if (update.action === "append") {
      if (!current.exists) return { ok: false, code: "missing", error: `${path} does not exist; create it with action write.` };
      next = `${current.text}${current.text && !current.text.endsWith("\n") ? "\n" : ""}${update.text.endsWith("\n") ? update.text : `${update.text}\n`}`;
    } else {
      const oldText = update.oldText;
      if (typeof oldText !== "string" || !oldText) return { ok: false, code: "invalid", error: "replace needs old_text." };
      const index = current.text.indexOf(oldText);
      if (index === -1 || current.text.indexOf(oldText, index + 1) !== -1) {
        return { ok: false, code: "conflict", error: `old_text must match exactly once in ${path}. Read it again with workspace_read and retry.` };
      }
      next = current.text.slice(0, index) + update.text + current.text.slice(index + oldText.length);
    }
    if (Buffer.byteLength(next, "utf8") > MEMORY_FILE_MAX_BYTES) {
      return { ok: false, code: "over-budget", error: `${path} would be over ${Math.round(MEMORY_FILE_MAX_BYTES / 1024)} KB; split it into several documents.` };
    }
    const { entry } = journalMemoryWrite(botId, path, next, { ...journal, expectedHash: current.hash });
    markWorkspaceUse(botId, [path]);
    return { ok: true, path, bytes: Buffer.byteLength(next, "utf8"), journal: entry };
  } catch (error) {
    return storeRefusal(error);
  }
}

/** The Files list's rename of a document: the new file first, then the
 * old one removed, both journaled, so a failure halfway leaves two copies
 * rather than none. */
export function renameDoc(botId: string, from: string, to: string, opts: { actor?: MemoryActor; via?: string } = {}): WorkspaceWriteResult {
  const source = docPath(from);
  const target = docPath(to);
  if (!source || !target) return { ok: false, code: "invalid", error: "Both names must be docs/<name>.md." };
  if (source === target) return { ok: true, path: target, journal: null };
  try {
    const current = readMemoryDoc(botId, source);
    if (!current.exists) return { ok: false, code: "missing", error: `${source} does not exist.` };
    if (readMemoryDoc(botId, target).exists) return { ok: false, code: "exists", error: `${target} already exists.` };
    const journal = { actor: opts.actor ?? "person", via: opts.via ?? "ui" } as const;
    const { entry } = journalMemoryWrite(botId, target, current.text, journal);
    journalMemoryDelete(botId, source, journal);
    return { ok: true, path: target, journal: entry };
  } catch (error) {
    return storeRefusal(error);
  }
}
