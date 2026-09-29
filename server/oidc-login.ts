// "Sign in with Pulsatrix": the organization server's OpenID Connect login.
//
// OMB_IDENTITY=perspicax turns it on. The server then:
//   - answers GET /auth/oidc/start (302 to the Perspicax authorize page) and
//     GET /auth/oidc/callback (code exchange and id_token check in
//     server/oidc-rp.ts, then a Pulsa Bot session cookie and 302 to /);
//   - resolves the person by (iss, sub) through PrincipalRegistry.forSubject;
//   - maps the `role` claim: admin -> scopes ["admin", "client"] and the
//     organization role "admin"; manager and employee -> ["client"] and
//     "member"; anything else (a service account, no claim) cannot sign in;
//   - refuses the interim email codes and invitation links, and says so in
//     its environment descriptor so /pair offers only this button.
//
// Configuration (environment only, read once at boot):
//   OMB_IDENTITY=perspicax
//   OMB_PERSPICAX_ISSUER   issuer URL, e.g. https://px.example.com
//   OMB_OIDC_CLIENT_ID     client id, default "pulsa-bot"
//   OMB_PUBLIC_URL         this server's public origin; the redirect URI is
//                          <OMB_PUBLIC_URL>/auth/oidc/callback and the login
//                          access token's resource is this origin.
//
// Spec: docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md,
// sections 2, 3 and 10 (slice 1).
import type { IncomingMessage, ServerResponse } from "node:http";

import { OidcRelyingParty, validIssuer, type OidcIdentity } from "./oidc-rp.ts";
import type { Principal } from "./principals.ts";
import { cookieMaxAgeSeconds, type PublicSession, type Scope, type SessionRecord } from "./sessions.ts";
import { labelFromUserAgent, parseCookies, serializeSessionCookie } from "./request-auth.ts";

export const OIDC_START_PATH = "/auth/oidc/start";
export const OIDC_CALLBACK_PATH = "/auth/oidc/callback";
export const DEFAULT_OIDC_CLIENT_ID = "pulsa-bot";

export type IdentityConfig =
  | { kind: "solo" }
  | { kind: "perspicax"; issuer: string; clientId: string; publicOrigin: string; redirectUri: string };

/** What /.well-known/openmausbot/environment says about sign-in. */
export interface IdentityDescriptor {
  kind: "perspicax";
  protocol: "oidc";
  issuer: string;
  /** Same-origin path that starts the sign-in. */
  loginPath: string;
}

/** Read the identity mode from the environment. A half-configured
 * organization server refuses to start rather than fall back to email codes. */
export function identityConfigFromEnv(env: NodeJS.ProcessEnv = process.env): IdentityConfig {
  const mode = env.OMB_IDENTITY?.trim().toLowerCase();
  if (!mode || mode === "solo") return { kind: "solo" };
  if (mode !== "perspicax") throw new Error(`OMB_IDENTITY="${mode.replace(/[^\w.-]/g, "").slice(0, 40)}" is not supported; use perspicax or leave it unset.`);
  const issuer = validIssuer(env.OMB_PERSPICAX_ISSUER ?? "");
  if (!issuer) throw new Error("OMB_IDENTITY=perspicax needs OMB_PERSPICAX_ISSUER: the Perspicax https URL (http only on this machine).");
  const publicUrl = env.OMB_PUBLIC_URL?.trim().replace(/\/+$/, "");
  let publicOrigin: string;
  try {
    const url = new URL(publicUrl ?? "");
    const loopback = url.hostname === "localhost" || url.hostname.startsWith("127.") || url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("scheme");
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("path");
    publicOrigin = url.origin;
  } catch {
    throw new Error("OMB_IDENTITY=perspicax needs OMB_PUBLIC_URL: this server's public https origin (http only on this machine), with no path.");
  }
  const clientId = env.OMB_OIDC_CLIENT_ID?.trim() || DEFAULT_OIDC_CLIENT_ID;
  return { kind: "perspicax", issuer, clientId, publicOrigin, redirectUri: `${publicOrigin}${OIDC_CALLBACK_PATH}` };
}

export function identityDescriptor(config: IdentityConfig): IdentityDescriptor | undefined {
  return config.kind === "perspicax" ? { kind: "perspicax", protocol: "oidc", issuer: config.issuer, loginPath: OIDC_START_PATH } : undefined;
}

/** Session scopes for a Perspicax role (spec section 3). No claim is an
 * employee: Perspicax in file mode has one kind of account and sends none.
 * Any other value (a role this build does not know) cannot sign in. */
export function scopesForRole(role: string | undefined): Scope[] | null {
  if (role === "admin") return ["admin", "client"];
  if (role === undefined || role === "manager" || role === "employee") return ["client"];
  return null;
}

/** The Pulsa Bot organization role for a Perspicax role. */
export function orgRoleForRole(role: string | undefined): "admin" | "member" | null {
  if (role === "admin") return "admin";
  if (role === undefined || role === "manager" || role === "employee") return "member";
  return null;
}

/** The interim sign-in paths an organization server refuses: email codes
 * and every invitation route (issue, revoke, accept, preview, join). */
export function isInterimSignInRoute(method: string, path: string): boolean {
  if (method === "POST" && (path === "/api/auth/email/start" || path === "/api/auth/email/verify")) return true;
  return path === "/api/org/invites" || path.startsWith("/api/org/invites/");
}

export const INTERIM_SIGNIN_REFUSAL = {
  error: "This server signs people in with Pulsatrix. Email codes and invitation links are off; an admin creates accounts in Perspicax.",
  code: "identity_perspicax",
} as const;

/** Extra fields for GET /api/auth/session on a session from this sign-in. */
export function oidcSessionFields(session: SessionRecord, principal: Principal | null): Record<string, unknown> {
  if (!session.idp) return {};
  return {
    identity: "perspicax",
    ...(session.principalId ? { principalId: session.principalId } : {}),
    ...(principal?.email ? { email: principal.email } : {}),
    ...(principal?.name ? { name: principal.name } : {}),
    ...(principal?.login ? { login: principal.login } : {}),
    ...(session.idp.role ? { role: session.idp.role } : {}),
    ...(principal?.orgRole ? { orgRole: principal.orgRole } : {}),
  };
}

export interface OidcLoginDeps {
  config: Extract<IdentityConfig, { kind: "perspicax" }>;
  rp?: OidcRelyingParty;
  /** The Pulsa Bot session cookie name (server/request-auth.ts). */
  sessionCookie: string;
  forSubject: (input: { iss: string; sub: string; claims: { email?: string; name?: string; login?: string }; orgRole: "admin" | "member" }) => Principal;
  issueSession: (input: { label: string; scopes: Scope[]; email?: string; principalId: string; idp: NonNullable<SessionRecord["idp"]> }) => { token: string; session: PublicSession };
  log?: (line: string) => void;
}

function redirect(res: ServerResponse, location: string, cookies: string[]): void {
  res.writeHead(303, {
    location,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    ...(cookies.length ? { "set-cookie": cookies } : {}),
  });
  res.end();
}

/** GET /auth/oidc/start and GET /auth/oidc/callback. Public, answered before
 * the auth gate: the pending flow's state, nonce, PKCE verifier and browser
 * binding are the authorization. Returns whether it answered. */
export function createOidcLoginRoutes(deps: OidcLoginDeps) {
  const rp = deps.rp ?? new OidcRelyingParty({
    issuer: deps.config.issuer,
    clientId: deps.config.clientId,
    redirectUri: deps.config.redirectUri,
    resource: deps.config.publicOrigin,
  });
  const secure = deps.config.redirectUri.startsWith("https://");
  const bindingCookie = `${deps.sessionCookie}_oidc`;
  const bindingAttributes = `Path=/auth/oidc; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  const clearBinding = `${bindingCookie}=; ${bindingAttributes}; Max-Age=0`;
  const log = deps.log ?? ((line: string) => console.warn(line));
  const fail = (res: ServerResponse, code: string, cookies: string[] = []) => redirect(res, `/pair#signin_error=${encodeURIComponent(code)}`, cookies);

  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const path = url.pathname;
    if (path !== OIDC_START_PATH && path !== OIDC_CALLBACK_PATH) return false;
    if (req.method !== "GET") {
      res.writeHead(405, { allow: "GET", "content-type": "application/json" });
      res.end(JSON.stringify({ error: "method_not_allowed" }));
      return true;
    }
    if (path === OIDC_START_PATH) {
      let started;
      try {
        started = await rp.start();
      } catch (error) {
        log(`oidc sign-in could not start: ${error instanceof Error ? error.message : String(error)}`);
        fail(res, "unavailable");
        return true;
      }
      redirect(res, started.authorizationUrl, [`${bindingCookie}=${started.binding}; ${bindingAttributes}; Max-Age=600`]);
      return true;
    }
    const binding = parseCookies(req.headers.cookie).get(bindingCookie);
    const outcome = await rp.callback(url.searchParams, binding);
    if (!outcome.ok) {
      log(`oidc sign-in refused (${outcome.code}): ${outcome.error}`);
      fail(res, outcome.code, [clearBinding]);
      return true;
    }
    const identity: OidcIdentity = outcome.identity;
    const scopes = scopesForRole(identity.role);
    const orgRole = orgRoleForRole(identity.role);
    if (!scopes || !orgRole) {
      log(`oidc sign-in refused (role): subject ${identity.sub.slice(0, 64)} has no person role`);
      fail(res, "role", [clearBinding]);
      return true;
    }
    const principal = deps.forSubject({
      iss: identity.iss,
      sub: identity.sub,
      claims: { email: identity.email, name: identity.name, login: identity.preferredUsername },
      orgRole,
    });
    const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined;
    const issued = deps.issueSession({
      label: labelFromUserAgent(userAgent) || "Pulsatrix sign-in",
      scopes,
      ...(principal.email ? { email: principal.email } : {}),
      principalId: principal.id,
      idp: { iss: identity.iss, sub: identity.sub, ...(identity.role ? { role: identity.role } : {}) },
    });
    redirect(res, "/", [
      serializeSessionCookie(deps.sessionCookie, issued.token, { secure, maxAgeSeconds: cookieMaxAgeSeconds(issued.session) }),
      clearBinding,
    ]);
    return true;
  };
}
