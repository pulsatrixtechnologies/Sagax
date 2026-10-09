// The persona editor's Rules and Files categories: the bot workspace as the
// server lists it (GET /api/bots/:id/workspace, server/routes/bot-workspace.ts)
// and the small pure helpers both categories share. RULES.md and docs/ are
// read and saved through /workspace/file, open to the bot's owner like the
// Soul; MEMORY.md and memory/ stay on the admin memory routes (src/lib/memory.ts).
import { ApiError, api } from "@/state/store";
import type { MemoryDoc } from "@/lib/memory";

export const RULES_PATH = "RULES.md";
export const DOCS_DIR = "docs";
/** Mirrors server/workspace-files.ts; the server's list carries the live
 * values, these are the fallback before it answers. */
export const RULES_MAX_LINES = 60;
export const RULES_MAX_BYTES = 8_000;

export type WorkspaceLoad = "every-turn" | "on-demand" | "never";

export interface WorkspaceBudget {
  maxLines?: number;
  maxBytes: number;
  lines: number;
  bytes: number;
  over: boolean;
}

export interface WorkspaceEntry {
  path: string;
  kind: "file" | "dir";
  bytes: number;
  createdAt?: number;
  modifiedAt?: number;
  lastUsedAt?: number;
  load: WorkspaceLoad;
  editable: boolean;
  markdown: boolean;
  budget?: WorkspaceBudget;
  forgotten: boolean;
  /** "soul": SOUL.md lives on the bot record; it opens the Soul category. */
  virtual?: "soul";
}

export interface WorkspaceListing {
  workspacePath: string;
  now: number;
  forgottenAfterDays: number;
  budgets: { rules: { maxLines: number; maxBytes: number }; memory: { maxLines: number; maxBytes: number }; soul: { maxBytes: number } };
  rulesTemplate: string;
  soul: WorkspaceEntry;
  entries: WorkspaceEntry[];
  truncated: boolean;
}

export function fetchWorkspace(botId: string): Promise<WorkspaceListing> {
  return api(`/api/bots/${encodeURIComponent(botId)}/workspace`);
}

export function workspaceDownloadUrl(botId: string, path: string): string {
  return `/api/bots/${encodeURIComponent(botId)}/workspace/download?path=${encodeURIComponent(path)}`;
}

/** Is `path` one /workspace/file serves: RULES.md or docs/<name>.md. */
export function isRulesOrDoc(path: string): boolean {
  return path === RULES_PATH || /^docs\/[^/]+\.md$/.test(path);
}

const fileUrl = (botId: string, path?: string) =>
  `/api/bots/${encodeURIComponent(botId)}/workspace/file${path === undefined ? "" : `?path=${encodeURIComponent(path)}`}`;

export function fetchWorkspaceDoc(botId: string, path: string): Promise<MemoryDoc> {
  return api(fileUrl(botId, path));
}

export type WorkspaceSaveResult =
  | { ok: true; doc: MemoryDoc }
  | { ok: false; conflict: true; current: string; currentHash: string };

/** A 409 carries what is on disk now (the bot may have written), like a
 * memory save. */
export async function saveWorkspaceDoc(botId: string, path: string, text: string, expectedHash: string | undefined): Promise<WorkspaceSaveResult> {
  const response = await fetch(fileUrl(botId), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, text, expectedHash }),
  });
  // SAFETY: the server's JSON is narrowed field by field below
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 409 && typeof body.current === "string" && typeof body.currentHash === "string") {
    return { ok: false, conflict: true, current: body.current, currentHash: body.currentHash };
  }
  if (!response.ok) throw new ApiError(typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`, response.status);
  return { ok: true, doc: { path: String(body.path), text: String(body.text), hash: String(body.hash), exists: body.exists === true } };
}

export function deleteWorkspaceDoc(botId: string, path: string): Promise<{ ok: true; path: string }> {
  return api(fileUrl(botId, path), { method: "DELETE" });
}

export function renameWorkspaceDoc(botId: string, from: string, to: string): Promise<{ ok: true; path: string }> {
  return api(`/api/bots/${encodeURIComponent(botId)}/workspace/docs/rename`, { method: "POST", body: JSON.stringify({ from, to }) });
}

/** RULES.md as it loads: comments removed, blank runs folded, trimmed
 * (server/workspace-files.ts effectiveRulesText). */
export function effectiveRulesText(raw: string): string {
  return raw.replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

export interface RulesCount {
  lines: number;
  bytes: number;
  maxLines: number;
  maxBytes: number;
  over: boolean;
}

/** Lines and bytes of what loads, against the rules budget. */
export function rulesCount(raw: string, maxLines = RULES_MAX_LINES, maxBytes = RULES_MAX_BYTES): RulesCount {
  const text = effectiveRulesText(raw);
  const lines = text ? text.replace(/\n$/, "").split("\n").length : 0;
  const bytes = new TextEncoder().encode(text).length;
  return { lines, bytes, maxLines, maxBytes, over: lines > maxLines || bytes > maxBytes };
}

/** A document's path from whatever the person typed: spaces and odd
 * punctuation become dashes, .md is added, docs/ in front. Null when
 * nothing usable is left. */
export function docPathFromName(input: string): string | null {
  const stem = input.trim().replace(/^docs\//, "").replace(/\.md$/i, "").replace(/[^\p{L}\p{N}_ .-]+/gu, "-").replace(/^[^\p{L}\p{N}_]+/u, "").trim();
  if (!stem || stem.length > 190) return null;
  return `${DOCS_DIR}/${stem}.md`;
}

/** Folder depth, for indenting the tree. */
export function entryDepth(path: string): number {
  return path.split("/").length - 1;
}

export function entryName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}
