// The organization routes of a server signed in with Perspicax (slice 3):
//
//   GET   /api/org            the organization, the link to Perspicax, the
//                             viewer's role and the settings (no people, no
//                             invitations: Perspicax owns both)
//   GET   /api/org/directory  the people a bot owner may share with (client)
//   PATCH /api/org/settings   { memberBotsUseOrgKey } (organization admin)
//   GET   /api/org/approvals  approvals waiting for an organization admin
//                             (server commands of members' bots)
//   GET, POST, DELETE /api/org/routine-delegation
//                             the caller's own routine delegation (slice 6):
//                             status, start the Perspicax consent, revoke
//
// Registered before the interim organization routes, which answer only in
// solo mode (server/org-routes.ts).
import type { DirectoryPerson, DirectoryState } from "./perspicax-link.ts";
import type { Principal } from "./principals.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export interface OrgSettings {
  /** Let turns that are not an admin owner's own use the organization's key
   * (the workspace key in Settings > Connections) on key-backed engines. */
  memberBotsUseOrgKey: boolean;
  /** Slice 8: the window to attach people from before Perspicax. `until`
   * is null when it never opened or is closed; `people` still waiting. */
  interimAttach?: { until: number | null; people: number };
}

export interface OrgDirectoryEntry {
  principalId: string;
  name: string;
  login: string;
  email?: string;
  role: "admin" | "member";
  disabled: boolean;
  /** Slice 4: the teams this person is in. */
  teams?: { id: string; manager: boolean }[];
}

export interface OrgDirectoryTeam {
  id: string;
  name: string;
  managers: string[];
  members: string[];
}

export interface OrgDirectoryViewer {
  principalId: string | null;
  orgRole: "admin" | "member";
  perspicaxRole?: "admin" | "manager" | "employee";
  managedTeamIds: string[];
}

export interface PendingAdminApproval {
  botId: string;
  botName: string;
  threadId: string;
  requestId: string;
  ownerPrincipalId: string;
  tool?: string;
  summary?: string;
  at: number;
}

export interface PerspicaxOrgRouteDeps {
  issuer: string;
  orgName: string;
  /** The directory's state and people, or null when no link file is set. */
  directory(): { state(): DirectoryState; people(): DirectoryPerson[]; serverId(): string | undefined } | null;
  bySubject(iss: string, sub: string): Principal | null;
  viewerRole(auth: RequestAuth): "admin" | "member";
  settings(): OrgSettings;
  /** Saves the settings; throws when they could not be written. */
  saveSettings(next: OrgSettings, auth: RequestAuth): void;
  /** Slice 8: set the interim attach window (0..90 days from when it
   * opened; 0 closes it now); throws when it could not be written. */
  saveInterimAttachDays?(days: number, auth: RequestAuth): void;
  pendingAdminApprovals(): PendingAdminApproval[];
  /** Slice 4: the teams with their people (principal ids). */
  teams?(): OrgDirectoryTeam[];
  /** Slice 4: who is asking. */
  viewer?(auth: RequestAuth): OrgDirectoryViewer;
  /** Slice 6: the caller's routine delegation. */
  routineDelegation?: RoutineDelegationRouteDeps;
}

export interface RoutineDelegationRouteDeps {
  status(principalId: string): { state: "active"; consentedAt: number; renewedAt: number; expiresAt: number } | { state: "none" };
  /** The caller's enabled routines that are suspended now. */
  suspendedCount(principalId: string): number;
  /** Start the consent at Perspicax: the authorization URL and the flow
   * binding cookie, or why it cannot start. */
  start(input: { principalId: string; sessionId: string }): Promise<{ ok: true; authorizationUrl: string; cookie: string } | { ok: false; status: number; error: string; code: string }>;
  revoke(principalId: string): boolean;
}

/** The directory as principals, sorted by name then login. Only people the
 * directory lists are returned; each carries the principal it upserted. */
export function orgDirectoryEntries(issuer: string, people: DirectoryPerson[], bySubject: (iss: string, sub: string) => Principal | null): OrgDirectoryEntry[] {
  const entries: OrgDirectoryEntry[] = [];
  for (const person of people) {
    const principal = bySubject(issuer, person.sub);
    if (!principal) continue;
    const email = principal.email ?? person.email ?? undefined;
    entries.push({
      principalId: principal.id,
      name: person.name || person.login,
      login: person.login,
      ...(email ? { email } : {}),
      role: person.role === "admin" ? "admin" : "member",
      disabled: person.status === "disabled",
      teams: (principal.teams ?? []).map((team) => ({ id: team.id, manager: team.manager })),
    });
  }
  const text = (value: string) => value.toLocaleLowerCase();
  return entries.sort((a, b) => text(a.name).localeCompare(text(b.name)) || text(a.login).localeCompare(text(b.login)) || a.principalId.localeCompare(b.principalId));
}

export function createPerspicaxOrgRoutes(deps: PerspicaxOrgRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/org" && !path.startsWith("/api/org/")) return PASS;
    const directory = deps.directory();
    if (method === "GET" && path === "/api/org") {
      const serverId = directory?.serverId();
      return json(res, 200, {
        org: { name: deps.orgName, identity: { kind: "perspicax", issuer: deps.issuer, ...(serverId ? { serverId } : {}) } },
        link: directory ? directory.state() : { state: "missing" },
        viewerRole: deps.viewerRole(auth),
        settings: deps.settings(),
      });
    }
    if (method === "GET" && path === "/api/org/directory") {
      res.setHeader("cache-control", "no-store");
      return json(res, 200, {
        people: directory ? orgDirectoryEntries(deps.issuer, directory.people(), deps.bySubject) : [],
        ...(deps.teams ? { teams: deps.teams() } : {}),
        ...(deps.viewer ? { viewer: deps.viewer(auth) } : {}),
      });
    }
    if (method === "PATCH" && path === "/api/org/settings") {
      if (deps.viewerRole(auth) !== "admin") return json(res, 403, { error: "Only an organization admin can change these settings." });
      const body = await readBody(req);
      const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : null;
      const hasKey = "memberBotsUseOrgKey" in (body ?? {});
      const hasDays = "interimAttachDays" in (body ?? {});
      if (!keys || !keys.length || keys.some((key) => key !== "memberBotsUseOrgKey" && key !== "interimAttachDays") ||
        (hasKey && typeof body.memberBotsUseOrgKey !== "boolean") ||
        (hasDays && (!deps.saveInterimAttachDays || !Number.isInteger(body.interimAttachDays) || body.interimAttachDays < 0 || body.interimAttachDays > 90))) {
        return json(res, 400, { error: "send { memberBotsUseOrgKey: true | false } and/or { interimAttachDays: 0 to 90 }" });
      }
      try {
        if (hasKey) deps.saveSettings({ ...deps.settings(), memberBotsUseOrgKey: body.memberBotsUseOrgKey }, auth);
        if (hasDays) deps.saveInterimAttachDays!(body.interimAttachDays, auth);
      } catch (error) {
        return json(res, 500, { error: `the organization settings could not be saved: ${error instanceof Error ? error.message : String(error)}` });
      }
      return json(res, 200, { settings: deps.settings() });
    }
    if (method === "GET" && path === "/api/org/approvals") {
      if (deps.viewerRole(auth) !== "admin") return json(res, 403, { error: "Only an organization admin can answer these approvals." });
      res.setHeader("cache-control", "no-store");
      return json(res, 200, { approvals: deps.pendingAdminApprovals() });
    }
    if (path === "/api/org/routine-delegation" && (method === "GET" || method === "POST" || method === "DELETE")) {
      res.setHeader("cache-control", "no-store");
      if (auth.kind !== "session") return json(res, 401, { error: "Sign in with Pulsatrix to allow your routines.", code: "session_required" });
      const principalId = auth.session.principalId?.trim();
      if (!principalId || !auth.session.idp || !deps.routineDelegation) {
        return json(res, 403, { error: "Routine delegation needs a person signed in with Pulsatrix.", code: "identity_perspicax" });
      }
      const routines = deps.routineDelegation;
      if (method === "GET") return json(res, 200, { ...routines.status(principalId), suspended: routines.suspendedCount(principalId) });
      if (method === "DELETE") return json(res, 200, { revoked: routines.revoke(principalId) });
      const started = await routines.start({ principalId, sessionId: auth.session.id });
      if (!started.ok) return json(res, started.status, { error: started.error, code: started.code });
      res.setHeader("set-cookie", started.cookie);
      return json(res, 200, { authorizationUrl: started.authorizationUrl });
    }
    // The interim invitation and creation routes do not exist here.
    if (path === "/api/org" || path.startsWith("/api/org/invites")) {
      return json(res, 403, { error: "This server signs people in with Pulsatrix; the organization is managed in Perspicax.", code: "identity_perspicax" });
    }
    return json(res, 404, { error: "not found" });
  };
}
