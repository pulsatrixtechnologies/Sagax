// Connections, Logs and Settings (console design 4.6, 4.8, 4.9 and section
// 5): engines, people's connections, MCP servers, Composio, marketplaces and
// the skills library, with a Test per line; the server log tail and the
// incidents; the organization's policies. Never a key, a token, an env
// value or a header value: providers and names only.
import type { AdminPerson } from "./org-admin-routes.ts";
import {
  badRequest,
  enumParam,
  isAnswer,
  notImplemented,
  objectBody,
  ok,
  onlyKeys,
  pageOf,
  parsePage,
  type ConsoleContext,
  type ConsoleRoute,
} from "./org-admin-console.ts";
import type { EngineVia } from "./org-admin-people.ts";
import { INCIDENT_KINDS, reasonLabel, type ProblemKind, type ProblemRow } from "./org-problem-log.ts";
import { LOG_LEVELS, type LogLevel, type LogLine } from "./server-log-ring.ts";

export interface ConnectionsView {
  engines: Array<{ id: string; name: string; installed: boolean; version: string | null; orgKey: boolean; people: number }>;
  people: Array<{ person: AdminPerson; engines: Array<{ id: string; via: EngineVia; ok: boolean | null; checkedAt: number | null }>; mcpServers: number; composioApps: number }>;
  mcpServers: Array<{ id: string; name: string; scope: "org" | "person"; owner: AdminPerson | null; transport: "remote" | "stdio"; state: string }>;
  composio: { configured: boolean; apps: Array<{ slug: string; name: string; people: number }> };
  marketplaces: Array<{ id: string; name: string; url: string; allowed: boolean; plugins: number }>;
  skills: Array<{ id: string; name: string; source: string | null; version: string | null; bots: number }>;
}

export type TestKind = "engine" | "mcp" | "marketplace" | "composio";
export interface TestResult { ok: boolean; reason: string | null; label: string | null }

export interface Policies {
  allowedMarketplaces: string[] | null;
  allowedEngines: string[] | null;
  defaults: { engine: string | null; model: string | null; approvalMode: string | null };
}

export interface OpsDeps {
  connections(): Promise<ConnectionsView>;
  /** One check; `null` when this kind of line cannot be tested here. */
  test(kind: TestKind, id: string, principalId: string | null): Promise<TestResult | null>;
  logs(input: { level: LogLevel | null; limit: number; before: number | null }): { lines: LogLine[]; next: number | null };
  problems(from: number): ProblemRow[];
  settings(): { org: unknown; policies: Policies; backup: { enabled: boolean; schedule: string | null; lastAt: number | null; ok: boolean | null } };
  /** Applies the changes; each setter audits its own row. Throws a
   * ConsoleRefusal for a value it refuses. */
  saveSettings(changes: SettingsChanges, adminPrincipalId: string): void;
  now(): number;
}

export interface SettingsChanges {
  allowFullAccess?: boolean;
  pluginMarketplaces?: { mode: "any" } | { mode: "list"; allow: string[] };
  allowedEngines?: string[] | null;
  defaults?: { engine?: string | null; model?: string | null; approvalMode?: string | null };
  interimAttachDays?: number;
}

const TEST_TIMEOUT_MS = 10_000;

/** Runs `check` and times it; a throw is a failed test with its reason. */
export async function timed(check: () => Promise<TestResult | null>): Promise<{ result: TestResult | null; latencyMs: number }> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      check(),
      new Promise<TestResult>((resolve) => { timer = setTimeout(() => resolve({ ok: false, reason: "timeout", label: "The test did not answer within 10 seconds." }), TEST_TIMEOUT_MS); }),
    ]);
    return { result, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { result: { ok: false, reason: "error", label: error instanceof Error ? error.message.slice(0, 300) : "The test failed." }, latencyMs: Math.round(performance.now() - started) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function settingsChanges(body: Record<string, unknown>): SettingsChanges | string {
  const extra = onlyKeys(body, ["allowFullAccess", "pluginMarketplaces", "allowedEngines", "defaults", "interimAttachDays"]);
  if (extra) return extra;
  if (!Object.keys(body).length) return "Send at least one setting.";
  const out: SettingsChanges = {};
  if (body.allowFullAccess !== undefined) {
    if (typeof body.allowFullAccess !== "boolean") return "allowFullAccess is true or false.";
    out.allowFullAccess = body.allowFullAccess;
  }
  if (body.pluginMarketplaces !== undefined) {
    const value = objectBody(body.pluginMarketplaces);
    if (value?.mode === "any" && Object.keys(value).length === 1) out.pluginMarketplaces = { mode: "any" };
    else if (value?.mode === "list" && Array.isArray(value.allow) && value.allow.length <= 100 && value.allow.every((entry) => typeof entry === "string" && entry.trim() && entry.length <= 300) && Object.keys(value).length === 2) {
      out.pluginMarketplaces = { mode: "list", allow: (value.allow as string[]).map((entry) => entry.trim()) };
    } else return "pluginMarketplaces is { mode: \"any\" } or { mode: \"list\", allow: [owner/repo, owner/*, https addresses] }.";
  }
  if (body.allowedEngines !== undefined) {
    const value = body.allowedEngines;
    if (value !== null && (!Array.isArray(value) || value.length > 100 || value.some((entry) => typeof entry !== "string" || !/^[A-Za-z0-9_.:-]{1,80}$/.test(entry)))) return "allowedEngines is null (every engine) or a list of engine instance ids.";
    out.allowedEngines = value === null ? null : [...new Set(value as string[])];
  }
  if (body.defaults !== undefined) {
    const value = objectBody(body.defaults);
    const bad = !value || onlyKeys(value, ["engine", "model", "approvalMode"])
      || (value.engine !== undefined && value.engine !== null && (typeof value.engine !== "string" || !value.engine || value.engine.length > 80))
      || (value.model !== undefined && value.model !== null && (typeof value.model !== "string" || !value.model || value.model.length > 200))
      || (value.approvalMode !== undefined && value.approvalMode !== null && !["ask", "auto", "full", "custom"].includes(String(value.approvalMode)));
    if (bad) return "defaults is { engine?, model?, approvalMode?: ask, auto, full or custom }.";
    out.defaults = value as SettingsChanges["defaults"];
  }
  if (body.interimAttachDays !== undefined) {
    if (!Number.isInteger(body.interimAttachDays) || (body.interimAttachDays as number) < 0 || (body.interimAttachDays as number) > 90) return "interimAttachDays is a whole number from 0 to 90.";
    out.interimAttachDays = body.interimAttachDays as number;
  }
  return out;
}

export function opsRoutes(deps: OpsDeps): ConsoleRoute[] {
  return [
    {
      method: "GET",
      path: "connections",
      min: "admin",
      async handle() {
        return ok(await deps.connections());
      },
    },
    {
      method: "POST",
      path: "connections/test",
      min: "admin",
      async handle(ctx) {
        const body = objectBody(ctx.body);
        const kind = body?.kind;
        if (!body || onlyKeys(body, ["kind", "id", "principalId"]) || (kind !== "engine" && kind !== "mcp" && kind !== "marketplace" && kind !== "composio")
          || typeof body.id !== "string" || !body.id || body.id.length > 120 || (body.principalId !== undefined && (typeof body.principalId !== "string" || body.principalId.length > 160))) {
          return badRequest("Send { \"kind\": \"engine\", \"mcp\", \"marketplace\" or \"composio\", \"id\", \"principalId\"? }.");
        }
        const principalId = typeof body.principalId === "string" ? body.principalId : null;
        const { result, latencyMs } = await timed(() => deps.test(kind, body.id as string, principalId));
        if (!result) return notImplemented(kind === "mcp" ? "A server started by command (stdio) runs in its person's environment; Sagax cannot test it from here yet." : "This line cannot be tested from the console yet.");
        ctx.record({ category: kind === "engine" ? "engine" : kind === "mcp" ? "mcp" : "config", action: "connections.test", target: { kind, id: body.id as string }, after: { ok: result.ok, latencyMs, ...(principalId ? { principalId } : {}) } });
        return ok({ ok: result.ok, latencyMs, reason: result.reason, label: result.label });
      },
    },
    {
      method: "GET",
      path: "logs",
      min: "admin",
      handle(ctx) {
        const params = ctx.url.searchParams;
        const level = enumParam(params, "level", LOG_LEVELS);
        if (isAnswer(level)) return level;
        const rawLimit = params.get("limit");
        const limit = rawLimit ? Number(rawLimit) : 200;
        const rawBefore = params.get("before");
        const before = rawBefore ? Number(rawBefore) : null;
        if (!Number.isInteger(limit) || limit < 1 || limit > 500 || (before !== null && (!Number.isInteger(before) || before < 1))) {
          return badRequest("limit is 1 to 500, before the seq of a line this route gave.");
        }
        const page = deps.logs({ level, limit, before });
        return ok({ lines: page.lines.map(({ seq, at, level: lineLevel, area, message }) => ({ seq, at, level: lineLevel, area, message })), next: page.next });
      },
    },
    {
      method: "GET",
      path: "incidents",
      min: "admin",
      handle(ctx) {
        const page = parsePage(ctx.url.searchParams);
        if (isAnswer(page)) return page;
        const kind = enumParam(ctx.url.searchParams, "kind", INCIDENT_KINDS as readonly ProblemKind[]);
        if (isAnswer(kind)) return kind;
        const rows = deps.problems(ctx.now() - 90 * 24 * 60 * 60_000)
          .filter((row) => (INCIDENT_KINDS as readonly string[]).includes(row.kind) && (!kind || row.kind === kind))
          .filter((row) => !page.q || [row.botName, row.title, row.detail].some((text) => text?.toLocaleLowerCase().includes(page.q)))
          .map((row) => ({
            id: row.id, at: row.at, kind: row.kind, bot: { id: row.botId, name: row.botName }, threadId: row.threadId, title: row.title,
            reason: row.reason, label: reasonLabel(row.reason, ctx.locale), detail: row.detail, ...(row.routineId ? { routineId: row.routineId } : {}),
          }));
        return ok(pageOf(rows, page));
      },
    },
    {
      method: "GET",
      path: "settings",
      min: "admin",
      handle() {
        return ok(deps.settings());
      },
    },
    {
      method: "POST",
      path: "settings",
      min: "admin",
      handle(ctx: ConsoleContext) {
        const body = objectBody(ctx.body);
        if (!body) return badRequest("Send a JSON object.");
        const changes = settingsChanges(body);
        if (typeof changes === "string") return badRequest(changes);
        deps.saveSettings(changes, ctx.viewer.principalId);
        return ok({ settings: deps.settings() });
      },
    },
  ];
}

