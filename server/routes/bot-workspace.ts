// The persona editor's Files category (docs/bot-workspace.md): the bot's
// whole workspace as a tree, with when each file reaches the bot, its size
// against a budget, its dates and its last use; a download of any file; and
// a document rename. Reading and saving a markdown file in place, creating
// and deleting a document go through the memory routes
// (server/routes/bot-memory.ts), whose store reaches RULES.md and docs/ as
// well, so every change lands in the memory journal.
//
// Admin scope (server/request-auth.ts default), like the memory routes.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";

import { MEMORY_MAX_BYTES, MEMORY_MAX_LINES, workspaceDir } from "../workspace.ts";
import {
  FORGOTTEN_AFTER_MS,
  RULES_MAX_BYTES,
  RULES_MAX_LINES,
  RULES_TEMPLATE,
  SOUL_MAX_BYTES,
  WorkspacePathError,
  isForgotten,
  resolveWorkspaceFile,
  workspaceTree,
} from "../workspace-files.ts";
import { renameDoc } from "../workspace-tools.ts";
import { workspaceUsage } from "../workspace-usage.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Past this a download is refused: the Files list is for a bot's notes
 * and outputs, not for streaming a disk image through the API. */
const DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;

export interface BotWorkspaceRouteDeps {
  bot(id: string): { id: string; soul?: string; memoryEnabled?: boolean; updatedAt?: number | string; createdAt?: number | string } | null | undefined;
}

function time(value: number | string | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function createBotWorkspaceRoutes(deps: BotWorkspaceRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, json, readBody }) => {
    let m = path.match(/^\/api\/bots\/([\w-]+)\/workspace$/);
    if (m && method === "GET") {
      const bot = deps.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const now = Date.now();
      const usage = workspaceUsage(bot.id);
      const tree = workspaceTree(bot.id, { memoryEnabled: bot.memoryEnabled });
      const entries = tree.entries.map((entry) => {
        const lastUsedAt = usage[entry.path];
        return { ...entry, ...(lastUsedAt ? { lastUsedAt } : {}), forgotten: isForgotten(entry, lastUsedAt, now) };
      });
      // SOUL.md is on the bot record (its mirror sits outside the
      // workspace): listed first, opened in the Soul category.
      const soul = bot.soul ?? "";
      const soulBytes = Buffer.byteLength(soul.trim(), "utf8");
      return json(res, 200, {
        workspacePath: workspaceDir(bot.id),
        now,
        forgottenAfterDays: Math.round(FORGOTTEN_AFTER_MS / (24 * 60 * 60_000)),
        budgets: {
          rules: { maxLines: RULES_MAX_LINES, maxBytes: RULES_MAX_BYTES },
          memory: { maxLines: MEMORY_MAX_LINES, maxBytes: MEMORY_MAX_BYTES },
          soul: { maxBytes: SOUL_MAX_BYTES },
        },
        rulesTemplate: RULES_TEMPLATE,
        soul: {
          path: "SOUL.md",
          kind: "file",
          virtual: "soul",
          bytes: soulBytes,
          load: soulBytes ? "every-turn" : "never",
          editable: false,
          markdown: true,
          budget: { maxBytes: SOUL_MAX_BYTES, lines: 0, bytes: soulBytes, over: soulBytes > SOUL_MAX_BYTES },
          ...(time(bot.createdAt) ? { createdAt: time(bot.createdAt) } : {}),
          ...(time(bot.updatedAt) ? { modifiedAt: time(bot.updatedAt) } : {}),
          ...(usage["SOUL.md"] ? { lastUsedAt: usage["SOUL.md"] } : {}),
          forgotten: false,
        },
        entries,
        truncated: tree.truncated,
      });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/workspace\/download$/);
    if (m && method === "GET") {
      const bot = deps.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      try {
        const file = resolveWorkspaceFile(bot.id, url.searchParams.get("path") ?? "");
        if (file.stat.size > DOWNLOAD_MAX_BYTES) return json(res, 413, { error: `${file.path} is over ${DOWNLOAD_MAX_BYTES / (1024 * 1024)} MB; open the workspace folder on the server instead.` });
        const body = readFileSync(file.absolute);
        const name = basename(file.path).replace(/["\r\n]/g, "_");
        res.writeHead(200, {
          "content-type": /\.md$/i.test(name) ? "text/markdown; charset=utf-8" : "application/octet-stream",
          "content-length": String(body.length),
          "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(basename(file.path))}`,
          "x-content-type-options": "nosniff",
          "cache-control": "no-store",
        });
        res.end(body);
        return;
      } catch (error) {
        if (error instanceof WorkspacePathError) return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/workspace\/docs\/rename$/);
    if (m && method === "POST") {
      const bot = deps.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const parsed = z.object({ from: z.string(), to: z.string() }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "from and to are document paths (docs/<name>.md)" });
      const result = renameDoc(bot.id, parsed.data.from, parsed.data.to);
      if (!result.ok) return json(res, result.code === "exists" ? 409 : result.code === "missing" ? 404 : 400, { error: result.error, code: result.code });
      return json(res, 200, { ok: true, path: result.path });
    }
    return PASS;
  };
}
