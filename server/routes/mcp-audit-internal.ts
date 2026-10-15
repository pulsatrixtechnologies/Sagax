// POST /api/internal/mcp-audit: one permission audit record from the agents
// proxy (docs/mcp/permissions.md, Audit), written to the activity log. Only
// the whitelisted fields of mcpAuditRow are kept. Behind the agents
// capability (see internal-route.ts); the bot is the capability's.
import { mcpAuditRow, type McpAuditRecord } from "../mcp-permissions.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export interface McpAuditInternalDeps {
  append(row: ReturnType<typeof mcpAuditRow>): void;
}

const SCOPES = new Set(["self", "team", "org"]);

export function createMcpAuditInternalRoutes(deps: McpAuditInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (!(method === "POST" && path === "/api/internal/mcp-audit")) return PASS;
    const body = (await readBody()) as Partial<McpAuditRecord>;
    const valid = typeof body.tool === "string" && typeof body.permission === "string" && typeof body.reason === "string"
      && (body.decision === "allowed" || body.decision === "denied") && SCOPES.has(String(body.scope));
    if (!valid) return json(res, 400, { error: "bad audit record" });
    deps.append(mcpAuditRow(body as McpAuditRecord, capability.botId));
    return json(res, 200, { ok: true });
  };
}
