// A bot's own runtime settings and tool access (JC 2026-10-15), edited in the
// bot editor instead of Settings > General > Advanced
// (server/bot-runtime-settings.ts says what each field does).
//
//   GET   /api/bots/:id/runtime-settings -> { settings, stored }
//   PATCH /api/bots/:id/runtime-settings { maxConcurrentThreads?,
//         maxParallelPerPerson?, busySend?, automaticRecovery? } -> same
//   GET   /api/bots/:id/tool-grants -> { grants } (this bot's, with state)
//   POST  /api/bots/:id/tool-grants { scope, expiresAt? } -> 201 { grant }
//   POST  /api/bots/:id/tool-grants/:grantId/revoke -> { ok }
//
// Who: the bot's owner or an admin (`mayManage`, the server's gate: a member
// owner also needs the permission of their profiles, bots.behaviour for the
// settings and bots.tools for the grants). An admin-tier grant stays an
// admin's (`isAdmin`) and always ends within 30 days (docs/tool-policy.md §6);
// revoking only narrows, so the owner may revoke any of the bot's grants.
// Every change is one row in the admin activity log. Member scope:
// request-auth.ts CLIENT_ALLOW lists these paths; the handler decides.
import type { IncomingMessage } from "node:http";
import { z } from "zod";

import type { RequestAuth } from "../request-auth.ts";
import type { ToolGrantStore } from "../tool-grants.ts";
import {
  botRuntimeSettingsPatchSchema,
  effectiveBotRuntimeSettings,
  type BotAutomaticRecovery,
  type BotRuntimeSettings,
  type GlobalRuntimeSettings,
} from "../bot-runtime-settings.ts";
import { PASS, type RouteHandler } from "./table.ts";

const SETTINGS = /^\/api\/bots\/([\w-]+)\/runtime-settings$/;
const GRANTS = /^\/api\/bots\/([\w-]+)\/tool-grants$/;
const REVOKE = /^\/api\/bots\/([\w-]+)\/tool-grants\/(tg_[\w-]+)\/revoke$/;
const MAX_ADMIN_DAYS = 30;
const RUNTIME_FIELDS = ["maxConcurrentThreads", "maxParallelPerPerson", "busySend", "automaticRecovery"] as const;

type RuntimeBot = { id: string; name?: string } & BotRuntimeSettings;

export interface BotRuntimeSettingsRouteDeps {
  bot(id: string): RuntimeBot | null | undefined;
  /** The global values of config.json: the default of a bot with none. */
  global(): GlobalRuntimeSettings;
  /** The bot's owner or an admin, with the permission of `area`. */
  mayManage(auth: RequestAuth, bot: RuntimeBot, area: "behaviour" | "tools"): boolean;
  /** An admin (admin-tier grants stay theirs). */
  isAdmin(auth: RequestAuth): boolean;
  /** A backup model the server can run: the checked selection, or why not. */
  checkBackup(selection: NonNullable<BotAutomaticRecovery["backup"]>): { ok: true; selection: NonNullable<BotAutomaticRecovery["backup"]> } | { ok: false; status: number; error: string; code?: string };
  /** Store the fields on the bot and tell the clients. */
  save(botId: string, patch: BotRuntimeSettings): RuntimeBot | null;
  grants: Pick<ToolGrantStore, "all" | "grant" | "revoke">;
  audit(action: "bot.runtime_settings" | "tool_grants.grant" | "tool_grants.revoke", auth: RequestAuth, req: IncomingMessage, detail: Record<string, unknown>): void;
  now?: () => number;
}

const grantBody = z.object({
  scope: z.string().regex(/^[a-z0-9-]+:(read|write|admin)$/),
  expiresAt: z.number().int().positive().optional(),
}).strict();

function actor(auth: RequestAuth): string {
  return auth.kind === "session" ? auth.session.principalId ?? `session:${auth.session.id}` : "loopback";
}

function stored(bot: RuntimeBot): BotRuntimeSettings {
  return Object.fromEntries(RUNTIME_FIELDS.filter((field) => bot[field] !== undefined).map((field) => [field, structuredClone(bot[field])]));
}

export function createBotRuntimeSettingsRoutes(deps: BotRuntimeSettingsRouteDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const settings = path.match(SETTINGS);
    const grants = settings ? null : path.match(GRANTS);
    const revoke = settings || grants ? null : path.match(REVOKE);
    const id = settings?.[1] ?? grants?.[1] ?? revoke?.[1];
    if (!id) return PASS;
    res.setHeader("cache-control", "no-store");
    const bot = deps.bot(id);
    if (!bot) return json(res, 404, { error: "no such bot" });
    if (auth.kind === "loopback" && auth.trust === "service") return json(res, 403, { error: "forbidden" });

    if (settings) {
      if (method !== "GET" && method !== "PATCH") return json(res, 405, { error: "GET or PATCH" });
      if (!deps.mayManage(auth, bot, "behaviour")) return json(res, 403, { error: "forbidden: only the bot's owner or an admin can change its settings" });
      const answer = (current: RuntimeBot) => json(res, 200, { settings: effectiveBotRuntimeSettings(current, deps.global()), stored: stored(current) });
      if (method === "GET") return answer(bot);
      const parsed = botRuntimeSettingsPatchSchema.safeParse(await readBody(req));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const message = issue?.code === "unrecognized_keys" ? `unknown setting: ${issue.keys[0]}` : issue?.message ?? "invalid settings";
        return json(res, 400, { error: message });
      }
      const patch: BotRuntimeSettings = { ...parsed.data } as BotRuntimeSettings;
      const recovery = parsed.data.automaticRecovery;
      if (recovery?.backup) {
        const checked = deps.checkBackup(recovery.backup);
        // Turning recovery off never fails on a backup that went away.
        if (!checked.ok && recovery.enabled) return json(res, checked.status, { error: checked.error, ...(checked.code ? { code: checked.code } : {}) });
        patch.automaticRecovery = checked.ok ? { enabled: recovery.enabled, backup: checked.selection } : { enabled: false };
      }
      const before = stored(bot);
      const saved = deps.save(bot.id, patch);
      if (!saved) return json(res, 404, { error: "no such bot" });
      const after = stored(saved);
      const changed = RUNTIME_FIELDS.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
      if (changed.length) {
        deps.audit("bot.runtime_settings", auth, req, {
          bot: { id: bot.id, ...(bot.name ? { name: bot.name } : {}) }, changed,
          before: Object.fromEntries(changed.map((field) => [field, before[field] ?? null])),
          after: Object.fromEntries(changed.map((field) => [field, after[field] ?? null])),
        });
      }
      return answer(saved);
    }

    if (!deps.mayManage(auth, bot, "tools")) return json(res, 403, { error: "forbidden: only the bot's owner or an admin can change its tool access" });
    if (grants && method === "GET") {
      const at = now();
      const rows = deps.grants.all()
        .filter((g) => g.subject.kind === "bot" && g.subject.id === bot.id)
        .map((g) => ({ ...g, state: g.revokedAt !== undefined ? "revoked" : g.expiresAt !== undefined && g.expiresAt <= at ? "expired" : "active" }));
      return json(res, 200, { grants: rows, mayGrantAdmin: deps.isAdmin(auth) });
    }
    if (grants && method === "POST") {
      const parsed = grantBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "scope <area>:<read|write|admin> required" });
      const { scope, expiresAt } = parsed.data;
      if (expiresAt !== undefined && expiresAt <= now()) return json(res, 400, { error: "expiresAt is in the past" });
      if (scope.endsWith(":admin")) {
        if (!deps.isAdmin(auth)) return json(res, 403, { error: "only an admin can grant admin access", code: "admin_tier_admin_only" });
        if (expiresAt === undefined || expiresAt - now() > MAX_ADMIN_DAYS * 86_400_000) {
          return json(res, 400, { error: `an admin grant needs an expiry within ${MAX_ADMIN_DAYS} days`, code: "admin_expiry" });
        }
      }
      const subject = { kind: "bot" as const, id: bot.id };
      const row = deps.grants.grant(subject, scope, actor(auth), expiresAt);
      deps.audit("tool_grants.grant", auth, req, { id: row.id, subject, scope, ...(expiresAt ? { expiresAt } : {}) });
      return json(res, 201, { grant: row });
    }
    if (revoke && method === "POST") {
      const grantId = revoke[2]!;
      const row = deps.grants.all().find((g) => g.id === grantId);
      // Another bot's or a person's grant is not reachable from this bot.
      if (!row || row.subject.kind !== "bot" || row.subject.id !== bot.id) return json(res, 404, { error: "no active grant with that id" });
      if (!deps.grants.revoke(grantId, actor(auth))) return json(res, 404, { error: "no active grant with that id" });
      deps.audit("tool_grants.revoke", auth, req, { id: grantId, subject: row.subject });
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: "method not allowed" });
  };
}
