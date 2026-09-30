// The organization routes of a server signed in with Perspicax (slice 3):
//
//   GET   /api/org            the organization, the link to Perspicax, the
//                             viewer's role and the settings (no people, no
//                             invitations: Perspicax owns both)
//   GET   /api/org/directory  the people a bot owner may share with (client)
//   PATCH /api/org/settings   { memberBotsUseOrgKey } (organization admin)
//   GET   /api/org/approvals  approvals waiting for an organization admin
//                             (server commands of members' bots)
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
}

export interface OrgDirectoryEntry {
  principalId: string;
  name: string;
  login: string;
  email?: string;
  role: "admin" | "member";
  disabled: boolean;
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
  pendingAdminApprovals(): PendingAdminApproval[];
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
      return json(res, 200, { people: directory ? orgDirectoryEntries(deps.issuer, directory.people(), deps.bySubject) : [] });
    }
    if (method === "PATCH" && path === "/api/org/settings") {
      if (deps.viewerRole(auth) !== "admin") return json(res, 403, { error: "Only an organization admin can change these settings." });
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "memberBotsUseOrgKey") || typeof body.memberBotsUseOrgKey !== "boolean") {
        return json(res, 400, { error: "send { memberBotsUseOrgKey: true | false }" });
      }
      const next: OrgSettings = { ...deps.settings(), memberBotsUseOrgKey: body.memberBotsUseOrgKey };
      try {
        deps.saveSettings(next, auth);
      } catch (error) {
        return json(res, 500, { error: `the organization settings could not be saved: ${error instanceof Error ? error.message : String(error)}` });
      }
      return json(res, 200, { settings: next });
    }
    if (method === "GET" && path === "/api/org/approvals") {
      if (deps.viewerRole(auth) !== "admin") return json(res, 403, { error: "Only an organization admin can answer these approvals." });
      res.setHeader("cache-control", "no-store");
      return json(res, 200, { approvals: deps.pendingAdminApprovals() });
    }
    // The interim invitation and creation routes do not exist here.
    if (path === "/api/org" || path.startsWith("/api/org/invites")) {
      return json(res, 403, { error: "This server signs people in with Pulsatrix; the organization is managed in Perspicax.", code: "identity_perspicax" });
    }
    return json(res, 404, { error: "not found" });
  };
}
