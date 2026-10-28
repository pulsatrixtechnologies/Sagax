// Connect apps > Sources > GitHub: the one list of credentials
// (server/github-credentials.ts), 2026-10-28.
//
//   GET  /api/me/github/credentials
//        { credentials: [{ id, label, hint, owner: "mine" | "org", onlyWhereChosen?, chosenBy }],
//          canManageOrg, deviceFlow }
//   POST /api/me/github/credentials
//        { op: "add", label, token, scope?: "mine" | "org" } | { op: "remove", id }
//        | { op: "rename", id, label } | { op: "replace", id, token }
//
// A person manages their own credentials, with no admin (member scope,
// CLIENT_ALLOW). The organization's (scope "org") are shared with every
// member, so changing them stays with an organization admin, as before.
// When Perspicax says an admin manages this person's integrations, their
// changes answer 403 `org_integrations_admin_only` like their other
// connections. No answer carries a token: a label and the last 4 characters.
import type { GithubCredentialPublic } from "../../shared/github-credentials.ts";
import { GithubCredentialsError, ORG_OWNER, parseCredentialChange, type CredentialChange } from "../github-credentials.ts";
import { INTEGRATIONS_ADMIN_ONLY } from "../person-integrations.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface GithubCredentialRouteDeps {
  store: {
    list(viewer: string, options: { org: boolean }): GithubCredentialPublic[];
    ownerOf(id: string): string | undefined;
    change(owner: string, change: CredentialChange): void;
  };
  /** Whose list the caller's own credentials are in (principal id, or `local`
   * solo); null: nobody signed in. */
  owner: (auth: RequestAuth) => string | null;
  /** An organization server: the organization's credentials are listed. */
  organization: () => boolean;
  /** May change the organization's credentials (an organization admin). */
  canManageOrg: (auth: RequestAuth) => boolean;
  /** The GitHub OAuth App is configured (Connect GitHub runs the device flow). */
  deviceFlow: () => boolean;
  managedByAdmin?: (auth: RequestAuth) => boolean;
  /** Before any read: the former files are moved in. */
  ready?: () => void;
  /** One audit row for a change to the organization's list (never the token). */
  auditOrg?: (auth: RequestAuth, row: { op: CredentialChange["op"]; id?: string; label?: string; count: number }) => void;
}

const PATH = "/api/me/github/credentials";

export function createGithubCredentialRoutes(deps: GithubCredentialRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== PATH) return PASS;
    res.setHeader("cache-control", "private, no-store");
    const owner = deps.owner(auth);
    if (!owner) return json(res, 401, { error: "Sign in to keep your own credentials.", code: "not_signed_in" });
    deps.ready?.();
    const org = deps.organization();
    const canManageOrg = org && deps.canManageOrg(auth);
    const listing = () => ({
      credentials: deps.store.list(owner, { org }),
      canManageOrg,
      deviceFlow: deps.deviceFlow(),
      ...(deps.managedByAdmin?.(auth) ? { managedByAdmin: true } : {}),
    });
    try {
      if (method === "GET") return json(res, 200, listing());
      if (method !== "POST") return json(res, 405, { error: "GET or POST" });
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return json(res, 415, { error: "content-type must be application/json" });
      const { change, scope } = parseCredentialChange(await readBody(req));
      // whose list the change is in: the one named for an add, the
      // credential's own owner otherwise (another person's is not found)
      const target = change.op === "add" ? (scope === "org" ? ORG_OWNER : owner) : deps.store.ownerOf(change.id);
      if (!target || (target !== owner && target !== ORG_OWNER) || (target === ORG_OWNER && !org)) {
        return json(res, 404, { error: "No credential with that id.", code: "not_found" });
      }
      if (target === ORG_OWNER && !canManageOrg) {
        return json(res, 403, { error: "Only an organization admin can change the organization's credentials.", code: "org_credentials_admin_only" });
      }
      if (target !== ORG_OWNER && deps.managedByAdmin?.(auth)) return json(res, 403, { ...INTEGRATIONS_ADMIN_ONLY });
      const before = target === ORG_OWNER ? deps.store.list(ORG_OWNER, { org: false }) : [];
      deps.store.change(target, change);
      if (target === ORG_OWNER) {
        const after = deps.store.list(ORG_OWNER, { org: false });
        const added = change.op === "add" ? after.find((entry) => !before.some((previous) => previous.id === entry.id)) : undefined;
        const touched = added ?? (change.op === "add" ? undefined : after.find((entry) => entry.id === change.id));
        deps.auditOrg?.(auth, {
          op: change.op, count: after.length,
          ...(change.op !== "add" ? { id: change.id } : touched ? { id: touched.id } : {}),
          ...(touched ? { label: touched.label } : {}),
        });
      }
      return json(res, 200, listing());
    } catch (error) {
      if (error instanceof GithubCredentialsError) return json(res, error.status, { error: error.message, code: error.code });
      throw error;
    }
  };
}
