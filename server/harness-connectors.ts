import type { AccessVia } from "./engine-credentials.ts";
// Connectors the engines already bring with the person's own account, so
// Sagax builds no GitHub, Outlook or Calendar integration of its own.
//
// Claude Code signed in with a claude.ai subscription mounts that account's
// claude.ai connectors (Microsoft 365 with Outlook mail and calendar, GitHub,
// Gmail, Google Calendar and so on) as MCP servers named "claude.ai <Service>",
// tools prefixed mcp__claude_ai_. Authentication stays with claude.ai.
// https://code.claude.com/docs/en/mcp ("Use MCP servers from Claude.ai")
//
//   - They load only on a claude.ai subscription login: never on an API key,
//     an auth token, apiKeyHelper, Bedrock/Vertex/Foundry or a
//     `claude setup-token` token.
//   - --strict-mcp-config drops them (measured on CLI 2.1.287, although the
//     docs say otherwise), so the Claude driver omits that flag for a turn
//     that keeps them and sets ENABLE_CLAUDEAI_MCP_SERVERS=false for every
//     other isolated turn. --setting-sources project stays either way.
//
// Speaker pays, speaker connects: a turn keeps the connectors only when it
// runs on the speaker's own subscription. On an organization server that is
// the `subscription` access (the owner speaking, from their own login
// directory); a member on someone else's bot runs on a key and has none. On
// a solo server the machine's Claude login is the operator's, so only the
// operator (and the operator's routines) get them.
//
// Codex: the ChatGPT apps (connectors) of `codex login` need Codex backend
// auth ("ChatGPT connectors require Codex backend auth" in codex-cli
// 0.153.0). Sagax's ChatGPT plan mode passes a token to a custom provider
// with an ephemeral credential store, and an API key has none, so Codex
// turns get no ChatGPT connectors; nothing here mounts them.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TurnSpeaker } from "./engine-access.ts";
import { resolveCli } from "./procs.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

/** How Claude Code names a claude.ai connector's server. */
export const CLAUDE_AI_SERVER_PREFIX = "claude.ai ";
/** The tool name prefix of every claude.ai connector tool. Keep it out of
 * any engine tool denial: those block host shell, file and fetch built-ins,
 * never a person's connectors (their calls ride the approval flow). */
export const CLAUDE_AI_CONNECTOR_TOOL_PREFIX = "mcp__claude_ai_";
/** Where a person adds, signs in to and removes their connectors. */
export const CLAUDE_AI_CONNECTORS_URL = "https://claude.ai/customize/connectors";

export const HARNESS_CONNECTORS_PATH = "/api/me/harness-connectors";
export const HARNESS_CONNECTORS_SETTINGS_PATH = "/api/harness-connectors/settings";

// ── whose connectors a turn uses ─────────────────────────────────────────

export interface ConnectorPrincipalInput {
  identity: "solo" | "perspicax";
  speaker: TurnSpeaker;
  /** The bot's owner (a routine uses the owner's connections). */
  ownerPrincipalId: string;
  /** The operator at this computer. */
  localPrincipalId: string;
}

/** The person whose connections a turn uses, "" for nobody: a conversation
 * uses its speaker's, a routine its bot owner's, an unknown person nobody's
 * (on a solo server an unnamed person is the operator). */
export function connectorPrincipalFor(input: ConnectorPrincipalInput): string {
  const solo = input.identity === "solo";
  const fallback = solo ? input.localPrincipalId : "";
  const normalize = (value: string | undefined) => value?.trim().toLowerCase() ?? "";
  switch (input.speaker.origin) {
    case "operator": return normalize(input.localPrincipalId);
    case "owner-routine": return normalize(input.ownerPrincipalId);
    case "person":
    case "peer": return normalize(input.speaker.principalId) || normalize(fallback);
  }
}

export interface ClaudeAiTurnInput extends ConnectorPrincipalInput {
  /** The server setting (on unless an admin turned it off). */
  enabled: boolean;
  /** An enrolled desktop whose organization restricts MCP servers. */
  restrictedByPolicy: boolean;
  driver: string;
  /** Organization server: how this turn's credentials were chosen. */
  via?: AccessVia;
}

/** Whether a Claude turn keeps the claude.ai connectors of the account it
 * runs on: only when that account is the speaker's own. */
export function claudeAiConnectorsForTurn(input: ClaudeAiTurnInput): boolean {
  if (!input.enabled || input.restrictedByPolicy || input.driver !== "claudeAgent") return false;
  if (input.identity === "perspicax") return input.via === "subscription";
  const principal = connectorPrincipalFor(input);
  return Boolean(principal) && principal === input.localPrincipalId.trim().toLowerCase();
}

/** The system note for a turn that keeps them: what they are and whose. */
export function claudeAiConnectorsPrompt(enabled: boolean): string {
  if (!enabled) return "";
  return "\nThis turn runs on the speaker's own Claude account, so its claude.ai connectors (for example Microsoft 365 for Outlook mail and calendar, or GitHub) may be mounted as MCP servers named \"claude.ai <Service>\", with tools prefixed mcp__claude_ai_. They act as that person, with that person's access: use them for that person's own mail, calendar, repositories and files when asked, never for anyone else. If one is missing or answers that it needs authentication, tell the person to connect it at https://claude.ai/customize/connectors.";
}

// ── what the person has ──────────────────────────────────────────────────

export type ClaudeAiConnectorStatus = "connected" | "needs_auth" | "failed" | "unknown";
export interface ClaudeAiConnector {
  name: string;
  status: ClaudeAiConnectorStatus;
}

/** The claude.ai connectors in `claude mcp list` output. Other servers (a
 * user-scope server, a project's .mcp.json) are not this person's account
 * and are left out; so is the URL. */
export function parseClaudeMcpList(stdout: string): ClaudeAiConnector[] {
  const out: ClaudeAiConnector[] = [];
  const seen = new Set<string>();
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(CLAUDE_AI_SERVER_PREFIX)) continue;
    const colon = line.indexOf(": ");
    if (colon <= CLAUDE_AI_SERVER_PREFIX.length) continue;
    const name = line.slice(CLAUDE_AI_SERVER_PREFIX.length, colon).trim();
    if (!name || name.length > 80 || /[\p{Cc}]/u.test(name) || seen.has(name)) continue;
    seen.add(name);
    const tail = line.slice(colon).toLowerCase();
    const status: ClaudeAiConnectorStatus = /\bconnected\b/.test(tail) && !/\bnot connected\b/.test(tail) ? "connected"
      : /needs authentication|needs auth/.test(tail) ? "needs_auth"
        : /failed|error/.test(tail) ? "failed"
          : "unknown";
    out.push({ name, status });
  }
  return out;
}

export type ClaudeAuthMethod = "subscription" | "key" | "none" | "unknown";

/** `claude auth status --json`: a claude.ai login is the only one that
 * brings connectors. Only the method is read; email and organization stay
 * out of everything this module returns. */
export function parseClaudeAuthStatus(stdout: string): ClaudeAuthMethod {
  try {
    const parsed = JSON.parse(stdout) as { loggedIn?: unknown; authMethod?: unknown };
    if (parsed.loggedIn === false) return "none";
    if (parsed.authMethod === "claude.ai") return "subscription";
    if (typeof parsed.authMethod === "string" && parsed.authMethod) return "key";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export interface ClaudeAiInventory {
  auth: ClaudeAuthMethod;
  connectors: ClaudeAiConnector[];
  at: number;
}

export interface ClaudeCliRun {
  (input: { cli: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string; timeoutMs: number }): Promise<string>;
}

/** Runs the Claude CLI once, bounded, and returns its stdout (never its
 * stderr, which may carry account details). */
export const runClaudeCli: ClaudeCliRun = ({ cli, args, env, cwd, timeoutMs }) => new Promise((resolve, reject) => {
  const resolved = resolveCli(cli, args, env);
  execFile(resolved.command, resolved.args, { env, cwd, timeout: timeoutMs, maxBuffer: 512 * 1024, windowsHide: true }, (error, stdout) => {
    if (error && !stdout) reject(new Error("claude cli failed"));
    else resolve(String(stdout));
  });
});

/** Reads one account's claude.ai connectors through its own CLI, cached a
 * few minutes per account (the health check opens every connector). Runs
 * in an empty folder so no project's .mcp.json joins the list. */
export class ClaudeAiConnectorInventory {
  private readonly cache = new Map<string, ClaudeAiInventory>();
  private readonly inflight = new Map<string, Promise<ClaudeAiInventory>>();
  private readonly run: ClaudeCliRun;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: { run: ClaudeCliRun; now?: () => number; ttlMs?: number }) {
    this.run = options.run;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
  }

  forget(key: string): void {
    this.cache.delete(key);
  }

  read(key: string, input: { cli: string; env: NodeJS.ProcessEnv }, force = false): Promise<ClaudeAiInventory> {
    const cached = this.cache.get(key);
    if (!force && cached && this.now() - cached.at < this.ttlMs) return Promise.resolve(cached);
    const running = this.inflight.get(key);
    if (running) return running;
    const work = (async (): Promise<ClaudeAiInventory> => {
      const cwd = mkdtempSync(join(tmpdir(), "omb-claude-connectors-"));
      try {
        const auth = parseClaudeAuthStatus(await this.run({ cli: input.cli, args: ["auth", "status", "--json"], env: input.env, cwd, timeoutMs: 15_000 }).catch(() => ""));
        const connectors = auth === "subscription"
          ? parseClaudeMcpList(await this.run({ cli: input.cli, args: ["mcp", "list"], env: input.env, cwd, timeoutMs: 45_000 }).catch(() => ""))
          : [];
        const result = { auth, connectors, at: this.now() };
        this.cache.set(key, result);
        return result;
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, work);
    return work;
  }
}

// ── routes ───────────────────────────────────────────────────────────────

/** Why a person's Claude connectors do not reach their turns. */
export type ClaudeAiUnavailable =
  | "disabled"          // an admin turned them off for this server
  | "managed_policy"    // the organization restricts MCP servers here
  | "no_engine"         // no Claude engine on this server
  | "not_signed_in"     // org: the person has no Claude sign-in of their own
  | "not_operator"      // solo: the machine's Claude login is the operator's
  | "key"               // the account is an API key, which has no connectors
  | "unknown";          // the CLI did not answer (missing, too old, timed out)

export interface HarnessConnectorRouteDeps {
  organization: boolean;
  /** The server setting; true unless an admin turned it off. */
  enabled(): boolean;
  setEnabled(next: boolean): void;
  restrictedByPolicy(): boolean;
  /** The caller as a principal, "" when not a known person. */
  principalFor(auth: RequestAuth): string;
  localPrincipalId(): string;
  isAdmin(auth: RequestAuth): boolean;
  /** The CLI and environment of the caller's own Claude account, or a
   * reason it has none. */
  claudeAccountFor(principalId: string): { cli: string; env: NodeJS.ProcessEnv; key: string } | { unavailable: "no_engine" | "not_signed_in" | "key" };
  inventory: Pick<ClaudeAiConnectorInventory, "read">;
}

function isAdminScope(auth: RequestAuth): boolean {
  if (auth.kind === "loopback" && auth.trust === "service") return false;
  return auth.scopes.includes("admin");
}

/** GET  /api/me/harness-connectors        the caller's own claude.ai connectors
 *  PUT  /api/harness-connectors/settings  admin: { claudeAi: boolean }
 * Nothing returned names the account (no email, no organization, no URL). */
export function createHarnessConnectorRoutes(deps: HarnessConnectorRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (path !== HARNESS_CONNECTORS_PATH && path !== HARNESS_CONNECTORS_SETTINGS_PATH) return PASS;
    res.setHeader("cache-control", "no-store");
    const admin = deps.isAdmin(auth) && isAdminScope(auth);
    if (path === HARNESS_CONNECTORS_SETTINGS_PATH) {
      if (method !== "PUT") return json(res, 405, { error: "method not allowed" });
      if (!admin) return json(res, 403, { error: "Only an administrator can change this." });
      if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const body = await readBody(req, 4096) as { claudeAi?: unknown } | null;
      if (!body || typeof body !== "object" || Object.keys(body).some((key) => key !== "claudeAi") || typeof body.claudeAi !== "boolean") {
        return json(res, 400, { error: "Send { \"claudeAi\": true | false }." });
      }
      deps.setEnabled(body.claudeAi);
      return json(res, 200, { claudeAi: deps.enabled() });
    }
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    const principalId = deps.principalFor(auth);
    if (!principalId) return json(res, 403, { error: "sign in as a person first" });
    const base = { manageUrl: CLAUDE_AI_CONNECTORS_URL, canManage: admin, enabled: deps.enabled() };
    const answer = (claude: { available: boolean; reason?: ClaudeAiUnavailable; connectors: ClaudeAiConnector[] }) =>
      json(res, 200, { ...base, claude, codex: { available: false, reason: "not_supported" } });
    if (!deps.enabled()) return answer({ available: false, reason: "disabled", connectors: [] });
    if (deps.restrictedByPolicy()) return answer({ available: false, reason: "managed_policy", connectors: [] });
    if (!deps.organization && principalId !== deps.localPrincipalId().trim().toLowerCase()) {
      return answer({ available: false, reason: "not_operator", connectors: [] });
    }
    const account = deps.claudeAccountFor(principalId);
    if ("unavailable" in account) return answer({ available: false, reason: account.unavailable, connectors: [] });
    const inventory = await deps.inventory.read(account.key, { cli: account.cli, env: account.env }, url.searchParams.get("refresh") === "1");
    if (inventory.auth === "none") return answer({ available: false, reason: "not_signed_in", connectors: [] });
    if (inventory.auth === "key") return answer({ available: false, reason: "key", connectors: [] });
    if (inventory.auth === "unknown") return answer({ available: false, reason: "unknown", connectors: [] });
    return answer({ available: true, connectors: inventory.connectors });
  };
}
