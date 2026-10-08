// The organization admin API the Perspicax console reads through its proxy
// (slice 7, spec section 8 "/api/org/admin/*"):
//
//   GET  /api/org/admin/bots                     manager, admin
//   GET  /api/org/admin/usage?from&to            manager, admin
//   GET  /api/org/admin/approvals                any role
//   POST /api/org/admin/approvals/{t}/{r}        any role, { decision }
//   GET  /api/org/admin/audit?from&to&limit&before  admin
//   GET  /api/org/admin/files/{bot}/roots|list|stat|read|download
//                                                manager, admin (org-admin-files.ts)
//
// Answered before the auth gate and before loopback trust: the only
// credential is a console assertion Perspicax signs per request (typ
// `pulsabot-console+jwt`, server/oidc-rp.ts verifyConsoleAssertion). A
// session cookie is ignored here, and a loopback request without an
// assertion is 401, never "the owner at this computer".
//
// Every answer is metadata: no message text, no instructions, no memory, no
// routine prompt, no credential (decision T7: admins administer without
// reading private Directs). The one exception is the files routes
// (org-admin-files.ts, JC 2026-10-08: "access to all features of every bot,
// view their files"): a bot's files, for managers in reach and admins, each
// read and download written to the admin activity log.
import type { IncomingMessage, ServerResponse } from "node:http";

import { aggregateOrgUsage, ORG_USAGE_MAX_ROWS, parseOrgUsageRange, type OrgUsageAggregate, type UsageRow } from "./usage-ledger.ts";
import type { ConsoleAssertion, OidcTeamClaim } from "./oidc-rp.ts";
import type { IdentifiedAdminAction } from "./admin-activity.ts";
import { ADMIN_FILES_ROUTE, answerBotFiles, type OrgAdminFilesDeps } from "./org-admin-files.ts";

export const ORG_ADMIN_PREFIX = "/api/org/admin/";
export const ORG_ADMIN_JTI_MAX = 10_000;
/** A seen assertion id is kept until its exp plus this. */
export const ORG_ADMIN_JTI_GRACE_MS = 60_000;
export const ORG_ADMIN_MAX_BOTS = 2_000;
export const ORG_ADMIN_MAX_APPROVALS = 200;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_TOKEN_CHARS = 8_192;
const CARD_ID = /^[A-Za-z0-9_-]{1,128}$/;
const AUDIT_CURSOR = /^\d{4}-\d{2}-\d{1,9}$/;

export type ConsoleRole = "admin" | "manager" | "employee";

/** A person as the console reads one. */
export interface AdminPerson {
  principalId: string;
  /** The Perspicax user id; null for a local or interim principal. */
  sub: string | null;
  name: string;
}

/** Who the assertion names, as the admin API sees them. */
export interface OrgAdminViewer {
  principalId: string;
  sub: string;
  name: string;
  role: ConsoleRole;
  orgAdmin: boolean;
  teams: OidcTeamClaim[];
}

export type AccessKind = "subscription" | "owner-key" | "speaker-key" | "org-key" | "server" | "none";

export interface AdminBot {
  id: string;
  name: string;
  owner: AdminPerson;
  ownerRole: "admin" | "member";
  engine: { instanceId: string; driverKind: string; installed: boolean };
  model: string | null;
  access: AccessKind;
  mcpProfiles: Array<{ id: string; name: string }>;
  grants: Array<{ target: string; kind: "user" | "team"; label: string; level: "use" | "run" | "edit" | "manage"; disabled?: true }>;
  sections: Array<{ id: string; name: string; defaultLevel: "use" | "run"; members: number }>;
  routines: number;
  createdAt: number | null;
  lastActivityAt: number | null;
}

/** What a manager's reach is checked against for one bot. */
export interface AdminBotReach {
  ownerPrincipalId: string;
  /** `user:<pid>` / `team:<id>` of its grants. */
  grantTargets: string[];
  /** Member targets of the shared sections it sits in. */
  sectionMemberTargets: string[];
}

export type ApprovalType = "tool" | "skill" | "routine" | "profile" | "model" | "team_setup" | "tightening" | "peer" | "other";

export interface AdminApproval {
  botId: string;
  botName: string;
  threadId: string;
  requestId: string;
  kind: "owner" | "admin";
  type: ApprovalType;
  tool?: string;
  summary?: string;
  requestedBy?: AdminPerson;
  owner: AdminPerson;
  at: number;
  decidable: boolean;
  link: string;
}

export type ApprovalAnswer =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404 | 409; code: "bad_request" | "not_found" | "card_not_pending" | "not_decidable" | "forbidden"; message: string };

export interface OrgAdminRouteDeps {
  /** Solo servers answer 403 identity_perspicax to everything here. */
  identity: "solo" | "perspicax";
  issuer: string;
  /** This server's public origin (SAGAX_PUBLIC_URL), the assertion audience. */
  publicOrigin(): string | null;
  /** The link file's server id, when a link is loaded. */
  linkServerId(): string | null;
  /** Throws (OidcError) on any failure. */
  verify(token: string, audienceOrigin: string, serverId: string | null): Promise<ConsoleAssertion>;
  /** The principal behind (issuer, sub). */
  principalFor(iss: string, sub: string): { id: string; name: string; disabled: boolean } | null;
  person(principalId: string): AdminPerson;
  /** Principal ids of the members and managers of these teams. */
  teamPeople(teamIds: readonly string[]): string[];
  bots(): Array<{ bot: AdminBot; reach: AdminBotReach }>;
  usageRows(range: { from: Date; to: Date }): UsageRow[];
  approvalsFor(viewer: OrgAdminViewer): AdminApproval[];
  answer(viewer: OrgAdminViewer, threadId: string, requestId: string, decision: "allow" | "deny"): Promise<ApprovalAnswer>;
  audit(input: { from?: number; to?: number; limit: number; before?: string | null }): { rows: IdentifiedAdminAction[]; next: string | null };
  /** The person rows of the audit actors (`nameOf`). */
  now?: () => number;
  /** A bot's files (read only, org-admin-files.ts) and what a manager's
   * reach is checked against for that bot; absent, every files path is 404. */
  files?: OrgAdminFilesDeps & { reach(botId: string): AdminBotReach | null };
}

/** Seen assertion ids: each kept until its exp plus a minute, pruned on each
 * call, at most 10,000 (the oldest goes first). In memory only: a restart
 * cannot replay a 60 s token beyond its life in practice. */
export class AssertionReplayCache {
  private readonly seen = new Map<string, number>();
  private readonly max: number;
  constructor(max = ORG_ADMIN_JTI_MAX) {
    this.max = max;
  }

  /** Records the id; false when it was already seen. */
  admit(jti: string, expMs: number, now: number): boolean {
    for (const [id, until] of this.seen) if (until <= now) this.seen.delete(id);
    if (this.seen.has(jti)) return false;
    while (this.seen.size >= this.max) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
    this.seen.set(jti, expMs + ORG_ADMIN_JTI_GRACE_MS);
    return true;
  }

  size(): number {
    return this.seen.size;
  }
}

/** The principals a manager reaches: themselves plus the members and
 * managers of every team their claim says they manage. Null for an admin
 * (everyone). */
export function managedReach(viewer: OrgAdminViewer, teamPeople: (teamIds: readonly string[]) => string[]): Set<string> | null {
  if (viewer.orgAdmin) return null;
  const managed = viewer.teams.filter((team) => team.manager).map((team) => team.id);
  return new Set([viewer.principalId, ...(managed.length ? teamPeople(managed) : [])]);
}

/** Whether a manager sees this bot: owner in reach, a grant to a managed
 * team or a person in reach, or a shared section with such a member. */
export function botInReach(reach: Set<string> | null, managedTeams: ReadonlySet<string>, facts: AdminBotReach): boolean {
  if (!reach) return true;
  if (reach.has(facts.ownerPrincipalId)) return true;
  const hits = (target: string) => {
    if (target.startsWith("team:")) return managedTeams.has(target.slice(5));
    if (target.startsWith("user:")) return reach.has(target.slice(5));
    return false;
  };
  return facts.grantTargets.some(hits) || facts.sectionMemberTargets.some(hits);
}

const textKey = (value: string) => value.toLocaleLowerCase();

/** Sorted by owner name then bot name, at most 2,000. */
export function sortAdminBots(bots: AdminBot[], max = ORG_ADMIN_MAX_BOTS): { bots: AdminBot[]; truncated: boolean } {
  const sorted = [...bots].sort((a, b) =>
    textKey(a.owner.name).localeCompare(textKey(b.owner.name)) || textKey(a.name).localeCompare(textKey(b.name)) || a.id.localeCompare(b.id));
  return { bots: sorted.slice(0, max), truncated: sorted.length > max };
}

/** One aggregated usage row as the console reads it. */
export function wireUsageRow(row: OrgUsageAggregate, person: (principalId: string) => AdminPerson) {
  const speaker = row.speaker.kind === "person"
    ? { kind: "person" as const, ...person(row.speaker.principalId) }
    : row.speaker.kind === "routine"
      ? { kind: "routine" as const, routineId: row.speaker.routineId, runAs: row.speaker.runAsPrincipalId ? person(row.speaker.runAsPrincipalId) : null }
      : row.speaker.kind === "bot"
        ? { kind: "bot" as const, botId: row.speaker.botId }
        : { kind: "unattributed" as const };
  return {
    day: row.day,
    botId: row.botId,
    botName: row.botName,
    owner: row.ownerPrincipalId ? person(row.ownerPrincipalId) : null,
    speaker,
    turns: row.turns,
    input: row.input,
    output: row.output,
    cachedInput: row.cachedInput,
    costUsd: row.costUsd,
    estimatedUsd: row.estimatedUsd,
    access: row.access,
  };
}

/** A session row (written before every Sagax change named the person by
 * principal id): the person when its user id is a known principal, else the
 * device label. Never the email: the console shows none in org mode. */
function sessionPerson(actor: { userId?: string; label: string }, person: (principalId: string) => AdminPerson): AdminPerson {
  if (actor.userId) {
    const known = person(actor.userId);
    if (known.name !== actor.userId) return known;
  }
  return { principalId: "", sub: null, name: actor.label.includes("@") ? "Signed-in user" : actor.label };
}

/** One audit row as the console reads it. */
export function wireAuditRow(row: IdentifiedAdminAction, person: (principalId: string) => AdminPerson) {
  const actor = row.actor.kind === "person"
    ? { kind: "person" as const, ...person(row.actor.principalId), via: row.actor.via }
    : row.actor.kind === "session"
      ? { kind: "person" as const, ...sessionPerson(row.actor, person), via: "sagax" as const }
      : row.actor.kind === "loopback"
        ? { kind: "local" as const }
        : { kind: row.actor.kind };
  return {
    id: row.id,
    at: Date.parse(row.at),
    category: row.category,
    action: row.action,
    actor,
    target: row.target ?? { kind: "server" },
    ...(row.changed ? { changed: row.changed } : {}),
    ...(row.before ? { before: row.before } : {}),
    ...(row.after ? { after: row.after } : {}),
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "x-sagax-admin-api": "1", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function refuse(res: ServerResponse, status: number, code: string, message: string): void {
  send(res, status, { code, message, error: message });
}

function readSmallJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        over = true;
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (over) return;
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve(null);
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", () => resolve(undefined));
  });
}

const ROLE_RANK: Record<ConsoleRole, number> = { employee: 0, manager: 1, admin: 2 };

/** The handler: true when the request was one of ours (answered). */
export function createOrgAdminRoutes(deps: OrgAdminRouteDeps): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean> {
  const replay = new AssertionReplayCache();
  const now = deps.now ?? Date.now;
  return async (req, res, url) => {
    const path = url.pathname;
    if (path !== "/api/org/admin" && !path.startsWith(ORG_ADMIN_PREFIX)) return false;
    const method = req.method ?? "GET";
    if (deps.identity !== "perspicax") {
      refuse(res, 403, "identity_perspicax", "This server does not sign people in with Pulsatrix.");
      return true;
    }
    // The assertion is the only credential: cookies and loopback are ignored.
    const header = req.headers.authorization;
    const bearer = typeof header === "string" ? /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1] : undefined;
    if (!bearer) {
      refuse(res, 401, "assertion_missing", "A console assertion is required.");
      return true;
    }
    const audience = deps.publicOrigin();
    if (!audience || bearer.length > MAX_TOKEN_CHARS) {
      refuse(res, 401, "assertion_invalid", audience ? "The console assertion is too long." : "This server has no public address to check the assertion against.");
      return true;
    }
    let assertion: ConsoleAssertion;
    try {
      assertion = await deps.verify(bearer, audience, deps.linkServerId());
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The console assertion does not verify.";
      refuse(res, 401, "assertion_invalid", reason.slice(0, 300));
      return true;
    }
    if (!replay.admit(assertion.jti, assertion.exp * 1000, now())) {
      refuse(res, 401, "assertion_replayed", "This console assertion was already used.");
      return true;
    }
    const principal = deps.principalFor(deps.issuer, assertion.sub);
    if (!principal) {
      refuse(res, 403, "unknown_person", "This person has not signed in to this server yet.");
      return true;
    }
    if (principal.disabled) {
      refuse(res, 403, "person_disabled", "This person is disabled on this server.");
      return true;
    }
    const viewer: OrgAdminViewer = {
      principalId: principal.id,
      sub: assertion.sub,
      name: principal.name,
      role: assertion.role,
      orgAdmin: assertion.role === "admin",
      teams: assertion.teams,
    };
    const sub = path.startsWith(ORG_ADMIN_PREFIX) ? path.slice(ORG_ADMIN_PREFIX.length) : "";
    const filesMatch = ADMIN_FILES_ROUTE.exec(sub);
    if (filesMatch) {
      if (!deps.files) {
        refuse(res, 404, "not_found", "No such admin route.");
        return true;
      }
      if (method !== "GET") {
        res.setHeader("allow", "GET");
        refuse(res, 405, "method_not_allowed", "Use GET here.");
        return true;
      }
      if (ROLE_RANK[viewer.role] < ROLE_RANK.manager) {
        refuse(res, 403, "forbidden_role", "This needs the manager role in Perspicax.");
        return true;
      }
      const botId = filesMatch[1]!;
      const facts = deps.files.reach(botId);
      const reach = managedReach(viewer, deps.teamPeople);
      const managedTeams = new Set(viewer.teams.filter((team) => team.manager).map((team) => team.id));
      // Out of a manager's reach reads as no such bot: the id says nothing.
      if (!facts || !botInReach(reach, managedTeams, facts)) {
        refuse(res, 404, "not_found", "No such bot.");
        return true;
      }
      await answerBotFiles({
        req, res, url, botId,
        action: filesMatch[2] as "roots" | "list" | "stat" | "read" | "download",
        principalId: viewer.principalId,
        deps: deps.files,
        send,
      });
      return true;
    }
    const answerMatch = /^approvals\/([^/]+)\/([^/]+)$/.exec(sub);
    const route = sub === "bots" || sub === "usage" || sub === "audit" || sub === "approvals"
      ? { name: sub, method: "GET", min: sub === "audit" ? "admin" as const : sub === "approvals" ? "employee" as const : "manager" as const }
      : answerMatch && CARD_ID.test(answerMatch[1]!) && CARD_ID.test(answerMatch[2]!)
        ? { name: "answer", method: "POST", min: "employee" as const }
        : null;
    if (!route) {
      refuse(res, 404, "not_found", "No such admin route.");
      return true;
    }
    if (method !== route.method) {
      res.setHeader("allow", route.method);
      refuse(res, 405, "method_not_allowed", `Use ${route.method} here.`);
      return true;
    }
    if (ROLE_RANK[viewer.role] < ROLE_RANK[route.min]) {
      refuse(res, 403, "forbidden_role", `This needs the ${route.min} role in Perspicax.`);
      return true;
    }
    const reach = managedReach(viewer, deps.teamPeople);
    const managedTeams = new Set(viewer.teams.filter((team) => team.manager).map((team) => team.id));
    const inReach = (principalId: string | null | undefined) => !reach || (principalId ? reach.has(principalId) : false);

    if (route.name === "bots") {
      const listed = deps.bots().filter((entry) => botInReach(reach, managedTeams, entry.reach)).map((entry) => entry.bot);
      send(res, 200, sortAdminBots(listed));
      return true;
    }
    if (route.name === "usage") {
      const range = parseOrgUsageRange(url.searchParams.get("from"), url.searchParams.get("to"), new Date(now()));
      if (!range) {
        refuse(res, 400, "bad_request", "from and to are YYYY-MM-DD, from before to, at most 92 days.");
        return true;
      }
      const { rows, truncated } = aggregateOrgUsage(deps.usageRows(range), ({ speaker, ownerPrincipalId }) => {
        if (!reach) return true;
        if (speaker.kind === "unattributed") return false;
        if (speaker.kind === "person" && inReach(speaker.principalId)) return true;
        if (speaker.kind === "routine" && inReach(speaker.runAsPrincipalId)) return true;
        return inReach(ownerPrincipalId);
      }, ORG_USAGE_MAX_ROWS);
      send(res, 200, { from: range.fromDay, to: range.toDay, rows: rows.map((row) => wireUsageRow(row, deps.person)), truncated });
      return true;
    }
    if (route.name === "approvals") {
      const approvals = deps.approvalsFor(viewer).sort((a, b) => a.at - b.at).slice(0, ORG_ADMIN_MAX_APPROVALS);
      send(res, 200, { approvals });
      return true;
    }
    if (route.name === "answer") {
      const body = await readSmallJson(req);
      const decision = body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 1
        ? (body as { decision?: unknown }).decision
        : undefined;
      if (decision !== "allow" && decision !== "deny") {
        refuse(res, 400, "bad_request", "Send { \"decision\": \"allow\" } or { \"decision\": \"deny\" }.");
        return true;
      }
      const outcome = await deps.answer(viewer, answerMatch![1]!, answerMatch![2]!, decision);
      if (!outcome.ok) {
        refuse(res, outcome.status, outcome.code, outcome.message);
        return true;
      }
      send(res, 200, { answered: true, decision });
      return true;
    }
    // audit (admin only, checked above)
    const params = url.searchParams;
    const int = (name: string) => {
      const value = params.get(name);
      if (value === null || value === "") return undefined;
      return /^\d{1,15}$/.test(value) ? Number(value) : Number.NaN;
    };
    const from = int("from");
    const to = int("to");
    const limitRaw = int("limit");
    const before = params.get("before");
    const limit = limitRaw ?? 200;
    if (Number.isNaN(from) || Number.isNaN(to) || Number.isNaN(limit) || limit < 1 || limit > 500 || (before !== null && before !== "" && !AUDIT_CURSOR.test(before)) || (from !== undefined && to !== undefined && from > to)) {
      refuse(res, 400, "bad_request", "from and to are milliseconds, limit 1 to 500, before an audit row id.");
      return true;
    }
    const page = deps.audit({ ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}), limit, before: before || null });
    send(res, 200, { rows: page.rows.map((row) => wireAuditRow(row, deps.person)), next: page.next });
    return true;
  };
}
