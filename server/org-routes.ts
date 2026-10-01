// What a solo server answers on the organization routes (slice 8). The
// interim organization (an email sign-in list, invitation links and an
// owner) is gone: a person joins an organization by copying their bots into
// a Perspicax server (server/org-export.ts), and devices pair with a code.
//
//   GET          /api/org                   404 no_organization
//   POST, PATCH  /api/org                   410 interim_org_removed
//   *            /api/org/invites[/...]     410 interim_signin_removed
//   POST         /api/auth/email/start|verify
//                                           410 interim_signin_removed
//
// An organization server keeps refusing the email and invitation routes with
// 403 identity_perspicax (server/oidc-login.ts), and serves its own /api/org
// (server/perspicax-org-routes.ts).
import { INTERIM_SIGNIN_REFUSAL, isInterimSignInRoute } from "./oidc-login.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export const INTERIM_SIGNIN_REMOVED = {
  error: "Email sign-in was removed. Pair this device with a code from Settings > Devices.",
  code: "interim_signin_removed",
} as const;

export const INTERIM_ORG_REMOVED = {
  error: "Organizations on a personal Sagax were removed. Join a Perspicax server from Settings > Organization.",
  code: "interim_org_removed",
} as const;

export const NO_ORGANIZATION = {
  error: "This Sagax has no organization. Join a Perspicax server from Settings > Organization.",
  code: "no_organization",
} as const;

/** The retired email and invitation routes, answered before any
 * credential is checked: 403 on an organization server (unchanged), 410 on
 * a solo one. Null for any other route. */
export function interimRetiredRefusal(method: string, path: string, identity: "solo" | "perspicax"): { status: 403 | 410; body: { error: string; code: string } } | null {
  if (!isInterimSignInRoute(method, path)) return null;
  return identity === "perspicax" ? { status: 403, body: { ...INTERIM_SIGNIN_REFUSAL } } : { status: 410, body: { ...INTERIM_SIGNIN_REMOVED } };
}

/** The organization routes of a solo server (after the auth gate). */
export function createSoloOrgRoutes(): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (path === "/api/org") {
      if (method === "GET") return json(res, 404, { ...NO_ORGANIZATION });
      if (method === "POST" || method === "PATCH") return json(res, 410, { ...INTERIM_ORG_REMOVED });
      return json(res, 405, { error: "method not allowed" });
    }
    if (path === "/api/org/invites" || path.startsWith("/api/org/invites/")) return json(res, 410, { ...INTERIM_SIGNIN_REMOVED });
    return PASS;
  };
}
