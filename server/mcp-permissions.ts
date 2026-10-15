// Granular permissions for the Sagax MCP tools: one permission per action,
// named resource:verb, scoped self < team < org, deny by default, one audit
// record per call (allowed and denied). Spec: docs/mcp/permissions.md; the
// capability inventory: docs/mcp/coverage.md.
//
// Pure data and functions: no environment, no I/O except the audit hook the
// caller hands in. The agents proxy (server/drivers/agents-proxy.ts) wraps
// its tool dispatch with guardToolCall.

export const MCP_SCOPES = ["self", "team", "org"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const MCP_ROLES = ["viewer", "member", "operator", "admin", "service"] as const;
export type McpRole = (typeof MCP_ROLES)[number];

/** read: changes nothing. own: the caller's own work. dispatch: puts other
 * bots, people or routines to work. admin: settings, pairing, credentials,
 * anything lasting for the organization. claim: holds on shared work. */
export type PermissionTier = "read" | "own" | "dispatch" | "claim" | "admin";

export interface McpPermission {
  /** resource:verb, e.g. memory:save. Stable: retire, never rename. */
  key: string;
  tier: PermissionTier;
  /** The MCP tool that carries it today; null while the capability is a gap. */
  tool: string | null;
  /** Where the capability lives (see docs/mcp/coverage.md). */
  source: "sagax" | "perspicax";
}

const p = (key: string, tier: PermissionTier, tool: string | null, source: "sagax" | "perspicax" = "sagax"): McpPermission => ({ key, tier, tool, source });

export const MCP_PERMISSIONS: readonly McpPermission[] = [
  // Reads
  p("bots:list", "read", "list_bots"),
  p("rooms:list", "read", "list_rooms"),
  p("rooms:targets", "read", "list_room_targets"),
  p("threads:list", "read", "list_threads"),
  p("teamsetup:list", "read", "list_team_setup"),
  p("computers:list", "read", "list_shared_computers"),
  p("terminal:list", "read", "list_terminal_resources"),
  p("delegation:check", "read", "check_delegation"),
  p("delegation:wait", "read", "wait_delegation"),
  p("sessions:search", "read", "session_search"),
  p("sessions:read", "read", "session_read"),
  p("toolresult:read", "read", "tool_result_read"),
  p("routines:list", "read", "list_routines"),
  p("skills:list", "read", "skills_list"),
  p("workspace:read", "read", "workspace_read"),
  p("workspace:search", "read", "workspace_search"),
  p("agents:list", "read", "list_agents"),
  p("agents:find", "read", "find_agents"),
  p("agents:await", "read", "await_turn"),
  p("transcript:read", "read", "read_transcript"),
  p("transcript:page", "read", "read_transcript_page"),
  p("transcript:latest", "read", "read_latest_page"),
  p("transcript:latest.threads", "read", "read_latest_page_with_threads"),
  p("transcript:cold", "read", "read_transcript_cold"),
  p("cloudagents:list", "read", "list_cloud_agents"),
  p("cloudagents:get", "read", "get_cloud_agent"),
  p("cloudagents:find", "read", "find_cloud_agent_by_pr"),
  p("cloudagents:transcript", "read", "cloud_agent_transcript"),
  p("cloudagents:artifacts", "read", "list_cloud_agent_artifacts"),
  // Own work
  p("memory:save", "own", "memory_update"),
  p("memory:log", "own", "memory_log"),
  p("groupmemory:save", "own", "group_memory_update"),
  p("files:attach", "own", "attach_file"),
  p("widgets:show", "own", "show_widget"),
  p("widgets:update", "own", "update_widget"),
  p("cards:options", "own", "create_options_card"),
  p("rooms:react", "own", "react_to_message"),
  p("rooms:unreact", "own", "remove_reaction"),
  p("rooms:post", "own", "post_to_room"),
  p("threads:close", "own", "close_thread"),
  p("voice:note", "own", "send_voice_note"),
  p("voice:end", "own", "end_call"),
  p("skills:manage", "own", "skill_manage"),
  p("profile:propose", "own", "propose_profile"),
  p("model:propose", "own", "propose_model"),
  p("routines:propose", "own", "propose_routine"),
  p("routines:propose.action", "own", "propose_routine_action"),
  p("terminal:offer", "own", "offer_shell_terminal"),
  // Dispatch
  p("bots:ask", "dispatch", "ask_bot"),
  p("bots:delegate", "dispatch", "delegate_bot"),
  p("bots:send", "dispatch", "send_to_bot"),
  p("bots:coordinate", "dispatch", "coordinate_bots"),
  p("agents:send", "dispatch", "send_prompt"),
  p("threads:start", "dispatch", "start_thread"),
  p("threads:retry", "dispatch", "retry_thread"),
  p("cloudagents:launch", "dispatch", "launch_cloud_agent"),
  p("cloudagents:followup", "dispatch", "cloud_agent_follow_up"),
  p("cloudagents:cancel", "dispatch", "cancel_cloud_agent"),
  p("cloudagents:archive", "dispatch", "archive_cloud_agent"),
  // Admin
  p("bots:create", "admin", "create_bot"),
  p("bots:delete.propose", "admin", "propose_bot_deletion"),
  p("agents:create", "admin", "create_agent"),
  p("rooms:create", "admin", "create_room"),
  p("rooms:manage", "admin", "manage_room"),
  p("teamsetup:propose", "admin", "propose_team_setup"),
  p("teammemory:propose", "admin", "propose_team_memory"),
  p("rules:update", "admin", "rules_update"),
  p("docs:update", "admin", "docs_update"),
  p("mcp:add", "admin", "add_mcp_server"),
  p("credentials:request", "admin", "request_credential"),
  p("computers:select", "admin", "select_computer"),
  p("computers:use", "admin", "shared_computer"),
  p("vm:exec", "admin", "vm_exec"),
  p("actions:invoke", "admin", "act"),
  // Gaps: capabilities with no MCP tool yet (docs/mcp/coverage.md). The
  // permission exists so roles and the console can grant it ahead of the tool.
  p("claims:acquire", "claim", null),
  p("claims:renew", "claim", null),
  p("claims:release", "claim", null),
  p("claims:list", "read", null),
  p("memory:search", "read", "memory_find", "perspicax"),
  p("memory:recall", "read", null, "perspicax"),
  p("memory:write", "own", "memory_save", "perspicax"),
  p("memory:forget", "own", "memory_remove", "perspicax"),
  p("memory:feedback", "own", null, "perspicax"),
  p("memory:promote", "admin", null, "perspicax"),
  p("memory:propose", "own", "memory_suggestions", "perspicax"),
  p("memory:review", "admin", null, "perspicax"),
  p("approvals:answer", "dispatch", "answer_approval"),
  p("routines:run", "dispatch", "run_routine"),
  p("people:nudge", "dispatch", "nudge_person"),
  p("api:list", "read", "api_list", "perspicax"),
  p("api:search", "read", "api_search", "perspicax"),
  p("api:describe", "read", "api_describe", "perspicax"),
  p("api:lookup", "read", "api_lookup", "perspicax"),
  p("api:plan", "read", "api_plan", "perspicax"),
  p("api:resultquery", "read", "api_resultquery", "perspicax"),
  p("api:upload", "own", "api_upload", "perspicax"),
  p("api:reload", "admin", "api_reload", "perspicax"),
  p("identity:search", "read", "identity_search", "perspicax"),
  p("api:query", "read", "api_query", "perspicax"),
  p("api:write", "dispatch", "api_write", "perspicax"),
  p("api:action", "dispatch", "api_action", "perspicax"),
  p("flow:action", "dispatch", "flow_action", "perspicax"),
  p("review:write", "admin", "review_write", "perspicax"),
  p("pairing:manage", "admin", "manage_pairing"),
  p("settings:manage", "admin", "manage_settings"),
];

const BY_TOOL = new Map<string, McpPermission>(MCP_PERMISSIONS.filter((x) => x.tool).map((x) => [x.tool as string, x]));
const BY_KEY = new Map<string, McpPermission>(MCP_PERMISSIONS.map((x) => [x.key, x]));

export const permissionForTool = (tool: string): McpPermission | undefined => BY_TOOL.get(tool);
export const permissionByKey = (key: string): McpPermission | undefined => BY_KEY.get(key);

type TierScopes = Partial<Record<PermissionTier, McpScope>>;

/** The widest scope each role holds per tier. A missing tier is denied. */
export const ROLE_TIER_SCOPES: Record<McpRole, TierScopes> = {
  viewer: { read: "team" },
  member: { read: "team", own: "self", dispatch: "self", claim: "self" },
  operator: { read: "team", own: "team", dispatch: "team", claim: "team" },
  admin: { read: "org", own: "org", dispatch: "org", claim: "org", admin: "org" },
  service: { read: "team", own: "self", dispatch: "self", claim: "self" },
};

/** Per-role exceptions, applied before the tier rule. A key set to null is
 * denied; a scope replaces the tier's. */
export const ROLE_OVERRIDES: Partial<Record<McpRole, Record<string, McpScope | null>>> = {
  // A member may start a bot of their own, nothing wider.
  member: { "bots:create": "self", "bots:delete.propose": "self", "rooms:create": "self", "rooms:manage": "self" },
  // Automation never creates bots, widens access or runs host commands.
  service: { "vm:exec": null, "actions:invoke": null },
};

const rank = (scope: McpScope) => MCP_SCOPES.indexOf(scope);

export interface McpPrincipal {
  id: string;
  role: string;
  /** Teams the principal acts for; "team" scope is judged against these. */
  teamIds?: readonly string[];
}

export interface McpDecision {
  allowed: boolean;
  /** The permission key, or the tool name when none is registered. */
  permission: string;
  requiredScope: McpScope;
  grantedScope: McpScope | null;
  reason: "ok" | "unknown_tool" | "unknown_role" | "not_granted" | "scope_too_narrow" | "resource_denied";
}

export function decide(principal: McpPrincipal, tool: string, target: McpScope = "self"): McpDecision {
  const perm = permissionForTool(tool);
  if (!perm) return { allowed: false, permission: tool, requiredScope: target, grantedScope: null, reason: "unknown_tool" };
  if (!(MCP_ROLES as readonly string[]).includes(principal.role)) {
    return { allowed: false, permission: perm.key, requiredScope: target, grantedScope: null, reason: "unknown_role" };
  }
  const role = principal.role as McpRole;
  const overrides = ROLE_OVERRIDES[role];
  const granted = overrides && perm.key in overrides ? overrides[perm.key] : ROLE_TIER_SCOPES[role][perm.tier];
  if (!granted) return { allowed: false, permission: perm.key, requiredScope: target, grantedScope: null, reason: "not_granted" };
  if (rank(target) > rank(granted)) return { allowed: false, permission: perm.key, requiredScope: target, grantedScope: granted, reason: "scope_too_narrow" };
  return { allowed: true, permission: perm.key, requiredScope: target, grantedScope: granted, reason: "ok" };
}

/** The scope a call reaches, read from its arguments. Anything naming a bot
 * other than the caller, a room or a team is team; an explicit org scope or
 * an all-organization flag is org. Otherwise self. Conservative on purpose:
 * a wider guess only ever needs a wider grant. */
export function scopeForCall(args: Record<string, unknown> | undefined, ownBotId: string): McpScope {
  if (!args) return "self";
  if (args.scope === "org" || args.all === true || args.organization === true) return "org";
  if (args.scope === "team") return "team";
  for (const key of ["bot_id", "for_bot_id", "agent_id", "to_bot_id", "target_bot_id"]) {
    const value = args[key];
    if (typeof value === "string" && value && value !== ownBotId) return "team";
  }
  for (const key of ["room_id", "group_id", "team_id", "section"]) {
    if (typeof args[key] === "string" && args[key]) return "team";
  }
  return "self";
}

const SEGMENT = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const API_TOOL_VERB: Record<string, string | undefined> = { api_query: "read", api_write: undefined, api_action: undefined };

/** What the Perspicax catalog knows: api slug to its resource names. */
export type ApiCatalog = ReadonlyMap<string, ReadonlySet<string>>;

/** The per-resource key of an api_query, api_write or api_action call
 * (`cw:ticket.update`), read from its arguments. Null when the call is not
 * one of those, names no api, or names a segment that is not a plain slug.
 * With a catalog, an api or resource it does not list gives null, so a made
 * up name can never match a grant or a deny. */
export function resourceKeyForCall(tool: string, args: Record<string, unknown> | undefined, catalog?: ApiCatalog): string | null {
  if (!(tool in API_TOOL_VERB) || !args) return null;
  const clean = (v: unknown) => (typeof v === "string" && SEGMENT.test(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null);
  const api = clean(args.api);
  const resource = clean(args.resource);
  const verb = API_TOOL_VERB[tool] ?? clean(tool === "api_action" ? args.action : args.verb);
  if (!api || !resource || !verb) return null;
  if (catalog) {
    const known = catalog.get(api);
    if (!known || !known.has(resource)) return null;
  }
  return `${api}:${resource}.${verb}`;
}

/** Deny rules for resource keys: exact (`cw:ticket.update`), `cw:ticket.*`
 * or `cw:*`. Read from SAGAX_MCP_DENY, comma separated. */
export function resourceDenied(key: string, rules: readonly string[]): boolean {
  return rules.some((rule) => {
    if (rule === key) return true;
    if (rule.endsWith(".*")) return key.startsWith(rule.slice(0, -1));
    if (rule.endsWith(":*")) return key.startsWith(rule.slice(0, -1));
    return false;
  });
}

export const deniedResourcesFromEnv = (env: NodeJS.ProcessEnv): string[] => (env.SAGAX_MCP_DENY || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export type McpPermissionMode = "off" | "shadow" | "enforce";

/** off skips the check, shadow audits a denial and lets the call through,
 * enforce refuses it. Unset or unreadable is shadow. */
export function permissionModeFromEnv(env: NodeJS.ProcessEnv): McpPermissionMode {
  const value = (env.SAGAX_MCP_PERMISSIONS ?? "").trim().toLowerCase();
  return value === "off" || value === "enforce" ? value : "shadow";
}

export function principalFromEnv(env: NodeJS.ProcessEnv): McpPrincipal {
  return {
    id: env.SAGAX_MCP_PRINCIPAL || env.SAGAX_BOT_ID || "unknown",
    role: (env.SAGAX_MCP_ROLE || "member").trim().toLowerCase(),
    teamIds: (env.SAGAX_MCP_TEAMS || "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

/** One row per call. Never carries arguments, text or results. */
export interface McpAuditRecord {
  at: string;
  principal: string;
  role: string;
  tool: string;
  permission: string;
  scope: McpScope;
  decision: "allowed" | "denied";
  reason: McpDecision["reason"];
  /** The per-resource key for an api_* call, when one applies. */
  resource?: string;
  /** False when the denial was only recorded (shadow mode). */
  enforced: boolean;
}

export type McpAuditHook = (record: McpAuditRecord) => void;

export interface GuardOptions {
  principal: McpPrincipal;
  mode: McpPermissionMode;
  ownBotId: string;
  audit: McpAuditHook;
  /** Resource deny rules (see resourceDenied) and the catalog that vets names. */
  deniedResources?: readonly string[];
  catalog?: ApiCatalog;
  now?: () => Date;
}

export interface GuardedResult {
  text: string;
  isError?: boolean;
  passthrough?: unknown;
}

export const permissionDeniedText = (d: McpDecision): string =>
  `Permission denied: ${d.permission} (${d.reason.replace(/_/g, " ")}, needs ${d.requiredScope} scope). Ask an administrator to grant it.`;

/** Wraps one tool call. The audit hook never throws into the call. */
export async function guardToolCall<R extends GuardedResult>(options: GuardOptions, tool: string, args: Record<string, unknown> | undefined, run: () => Promise<R>): Promise<R | GuardedResult> {
  if (options.mode === "off") return run();
  const scope = scopeForCall(args, options.ownBotId);
  let decision = decide(options.principal, tool, scope);
  const resource = resourceKeyForCall(tool, args, options.catalog) ?? undefined;
  if (decision.allowed && resource && resourceDenied(resource, options.deniedResources ?? [])) {
    decision = { ...decision, allowed: false, permission: resource, reason: "resource_denied" };
  }
  const enforced = options.mode === "enforce";
  const blocked = !decision.allowed && enforced;
  try {
    options.audit({
      at: (options.now?.() ?? new Date()).toISOString(),
      principal: options.principal.id,
      role: options.principal.role,
      tool,
      permission: decision.permission,
      scope,
      decision: decision.allowed ? "allowed" : "denied",
      reason: decision.reason,
      ...(resource ? { resource } : {}),
      enforced: !decision.allowed && enforced,
    });
  } catch {
    // A broken sink must not decide the call; a denial still stands.
  }
  if (blocked) return { text: permissionDeniedText(decision), isError: true };
  return run();
}

/** The identity variables the harness gives the proxy (docs/mcp/permissions.md,
 * rule 5). A turn with no person speaking (a routine, a webhook) is a
 * service; the Perspicax role maps admin to admin, manager to operator,
 * anyone else to member. Nothing here is a credential. */
export function mcpIdentityEnv(input: { botId: string; principalId?: string; perspicaxRole?: string; teamIds?: readonly string[] }): Record<string, string> {
  const role: McpRole = !input.principalId ? "service" : input.perspicaxRole === "admin" ? "admin" : input.perspicaxRole === "manager" ? "operator" : "member";
  return {
    SAGAX_MCP_ROLE: role,
    SAGAX_MCP_PRINCIPAL: input.principalId || input.botId,
    SAGAX_MCP_TEAMS: (input.teamIds ?? []).filter((id) => /^[\w.:-]{1,128}$/.test(id)).join(","),
  };
}

/** The activity-log row of one audit record. Fields are copied one by one:
 * nothing else a proxy sends is kept. */
export function mcpAuditRow(record: McpAuditRecord, botId: string) {
  return {
    category: "security" as const,
    action: record.decision === "denied" ? (record.enforced ? "mcp.deny" : "mcp.shadow") : "mcp.call",
    target: { kind: "bot", id: botId },
    after: {
      tool: String(record.tool).slice(0, 100),
      permission: String(record.permission).slice(0, 100),
      scope: record.scope,
      role: String(record.role).slice(0, 40),
      reason: record.reason,
      enforced: record.enforced === true,
      ...(record.resource ? { resource: String(record.resource).slice(0, 160) } : {}),
    },
    at: record.at,
  };
}
