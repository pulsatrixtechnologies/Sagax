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
//     its environment descriptor so /pair offers only this button;
//   - keeps the provider's refresh token as the session's grant
//     (server/idp-session.ts) and answers POST
//     /api/auth/oidc/backchannel-logout (OpenID Connect Back-Channel Logout);
//   - signs the desktop app and the phones in through the system browser:
//     /auth/oidc/start?client=desktop|phone ends on an openmausbot:// link
//     carrying a two-minute, single-use pairing credential bound to the
//     person (slice 2).
//
// Configuration (environment only, read once at boot):
//   OMB_IDENTITY=perspicax
//   OMB_PERSPICAX_ISSUER   issuer URL, e.g. https://px.example.com
//   OMB_OIDC_CLIENT_ID     client id, default "pulsa-bot"
//   OMB_PUBLIC_URL         this server's public origin; the redirect URI is
//                          <OMB_PUBLIC_URL>/auth/oidc/callback and the login
//                          access token's resource is this origin.
//   OMB_PERSPICAX_INTERNAL_URL  optional origin (http or https, any host)
//                          where this server reaches Perspicax from inside
//                          the deployment: discovery, JWKS, token, revoke and
//                          directory calls go there (slice 3).
//
// Spec: docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md,
// sections 2, 3 and 10 (slice 1).
import type { IncomingMessage, ServerResponse } from "node:http";

import { OidcRelyingParty, validInternalBase, validIssuer, type OidcClientKind, type OidcIdentity } from "./oidc-rp.ts";
import type { Principal } from "./principals.ts";
import { cookieMaxAgeSeconds, type PublicSession, type Scope, type SessionRecord } from "./sessions.ts";
import { labelFromUserAgent, parseCookies, serializeSessionCookie } from "./request-auth.ts";

export const OIDC_START_PATH = "/auth/oidc/start";
export const OIDC_CALLBACK_PATH = "/auth/oidc/callback";
export const OIDC_BACKCHANNEL_LOGOUT_PATH = "/api/auth/oidc/backchannel-logout";
/** A desktop or phone sign-in's pairing credential lives this long. */
export const OIDC_NATIVE_PAIRING_TTL_MS = 120_000;
/** Its grant is revoked by the sweep this long after the credential expires. TTL + grace + the
 * sweep slack stays well under three minutes from the start of the flow (unredeemed grant). */
export const OIDC_NATIVE_BIND_GRACE_MS = 30_000;
export const BACKCHANNEL_MAX_BODY_BYTES = 16 * 1024;
const JTI_CACHE_MAX = 10_000;
const JTI_CACHE_EXTRA_MS = 60_000;
export const DEFAULT_OIDC_CLIENT_ID = "pulsa-bot";

export type IdentityConfig =
  | { kind: "solo" }
  | { kind: "perspicax"; issuer: string; clientId: string; publicOrigin: string; redirectUri: string; internalBase?: string };

/** What /.well-known/openmausbot/environment says about sign-in. */
export interface IdentityDescriptor {
  kind: "perspicax";
  protocol: "oidc";
  issuer: string;
  /** Same-origin path that starts the sign-in. */
  loginPath: string;
  /** The start path takes `?client=desktop|phone` and ends on an
   * openmausbot:// link (slice 2), so native apps may use the system browser. */
  nativeReturn: true;
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
  let internalBase: string | undefined;
  if (env.OMB_PERSPICAX_INTERNAL_URL?.trim()) {
    internalBase = validInternalBase(env.OMB_PERSPICAX_INTERNAL_URL) ?? undefined;
    if (!internalBase) throw new Error("OMB_PERSPICAX_INTERNAL_URL must be an http or https origin with no path, e.g. http://perspicax:8787.");
  }
  return { kind: "perspicax", issuer, clientId, publicOrigin, redirectUri: `${publicOrigin}${OIDC_CALLBACK_PATH}`, ...(internalBase ? { internalBase } : {}) };
}

export function identityDescriptor(config: IdentityConfig): IdentityDescriptor | undefined {
  return config.kind === "perspicax" ? { kind: "perspicax", protocol: "oidc", issuer: config.issuer, loginPath: OIDC_START_PATH, nativeReturn: true } : undefined;
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

/** The grant side of a sign-in (server/idp-session.ts IdpSessionManager). */
export interface OidcGrantKeeper {
  unavailableReason(): string | null;
  createGrant(input: { iss: string; sub: string; refreshToken: string; bindBy: number }): string;
  bindSession(grantRef: string, sessionId: string): boolean;
  discard(grantRef: string): void;
  backchannelLogout(input: { iss: string; sub: string }): { sessions: number; pairings: number };
}

export interface OidcLoginDeps {
  config: Extract<IdentityConfig, { kind: "perspicax" }>;
  rp?: OidcRelyingParty;
  /** The Pulsa Bot session cookie name (server/request-auth.ts). */
  sessionCookie: string;
  forSubject: (input: { iss: string; sub: string; claims: { email?: string; name?: string; login?: string }; orgRole: "admin" | "member" }) => Principal;
  issueSession: (input: { label: string; scopes: Scope[]; email?: string; principalId: string; idp: NonNullable<SessionRecord["idp"]> }) => { token: string; session: PublicSession };
  /** Where each sign-in's refresh token is kept. */
  grants: OidcGrantKeeper;
  /** A principal-bound pairing credential for a desktop or phone sign-in. */
  openPairing: (input: { principalId: string; scopes: Scope[]; ttlMs: number; label: string; idp: NonNullable<SessionRecord["idp"]> }) => { credential: string; expiresAt: number };
  /** This server's name, for the phone's saved server. */
  serverName: () => string;
  now?: () => number;
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

function parseClient(value: string | null): OidcClientKind | null {
  if (value === null || value === "web") return "web";
  return value === "desktop" || value === "phone" ? value : null;
}

/** The link the desktop app receives from the system browser. */
export function desktopReturnLink(publicOrigin: string, outcome: { code: string } | { error: string }): string {
  const base = `openmausbot://auth?origin=${encodeURIComponent(publicOrigin)}`;
  return "code" in outcome ? `${base}#code=${outcome.code}` : `${base}#error=${encodeURIComponent(outcome.error)}`;
}

/** The link a phone's authentication sheet receives: the invite shape both
 * phone apps already parse (openmausbot://pair?address=&token=&name=). */
export function phoneReturnLink(publicOrigin: string, credential: string, serverName: string): string {
  return `openmausbot://pair?address=${encodeURIComponent(publicOrigin)}&token=${encodeURIComponent(credential)}&name=${encodeURIComponent(serverName)}`;
}

function jsonAnswer(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...extra });
  res.end(JSON.stringify(body));
}

/** The raw body up to `max` bytes, or null when it is larger. */
function readRawBody(req: IncomingMessage, max: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > max) {
        over = true;
        resolve(null);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!over) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

/** GET /auth/oidc/start and GET /auth/oidc/callback, and POST
 * /api/auth/oidc/backchannel-logout. Public, answered before the auth gate:
 * the pending flow's state, nonce, PKCE verifier and browser binding are the
 * authorization of the first two, the provider's signature that of the
 * third. Returns whether it answered. */
export function createOidcLoginRoutes(deps: OidcLoginDeps) {
  const rp = deps.rp ?? new OidcRelyingParty({
    issuer: deps.config.issuer,
    clientId: deps.config.clientId,
    redirectUri: deps.config.redirectUri,
    resource: deps.config.publicOrigin,
    ...(deps.config.internalBase ? { internalBase: deps.config.internalBase } : {}),
  });
  const secure = deps.config.redirectUri.startsWith("https://");
  const bindingCookie = `${deps.sessionCookie}_oidc`;
  const bindingAttributes = `Path=/auth/oidc; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  const clearBinding = `${bindingCookie}=; ${bindingAttributes}; Max-Age=0`;
  const log = deps.log ?? ((line: string) => console.warn(line));
  const now = deps.now ?? Date.now;
  const origin = deps.config.publicOrigin;
  const fail = (res: ServerResponse, code: string, cookies: string[] = [], client: OidcClientKind = "web") =>
    redirect(res, client === "desktop" ? desktopReturnLink(origin, { error: code }) : `/pair#signin_error=${encodeURIComponent(code)}`, cookies);
  /** Logout token ids already honoured, until they expire (+60 s). */
  const seenJti = new Map<string, number>();

  const backchannel = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const refuse = (reason: string) => {
      log(`oidc back-channel logout refused: ${reason}`);
      jsonAnswer(res, 400, { error: "invalid_request" });
    };
    const type = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/x-www-form-urlencoded") {
      req.resume();
      return refuse("not a form post");
    }
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > BACKCHANNEL_MAX_BODY_BYTES) {
      req.resume();
      return refuse("body too large");
    }
    let raw: string | null;
    try {
      raw = await readRawBody(req, BACKCHANNEL_MAX_BODY_BYTES);
    } catch {
      return refuse("body could not be read");
    }
    if (raw === null) return refuse("body too large");
    const token = new URLSearchParams(raw).get("logout_token");
    if (!token) return refuse("no logout_token");
    let claims;
    try {
      claims = await rp.verifyLogoutToken(token);
    } catch (error) {
      return refuse(error instanceof Error ? error.message : String(error));
    }
    const at = now();
    for (const [jti, until] of seenJti) if (until <= at) seenJti.delete(jti);
    if (seenJti.has(claims.jti)) return refuse("replayed logout token");
    while (seenJti.size >= JTI_CACHE_MAX) {
      const oldest = seenJti.keys().next().value;
      if (oldest === undefined) break;
      seenJti.delete(oldest);
    }
    seenJti.set(claims.jti, claims.exp * 1000 + JTI_CACHE_EXTRA_MS);
    const done = deps.grants.backchannelLogout({ iss: claims.iss, sub: claims.sub });
    log(`oidc back-channel logout: subject ${claims.sub.slice(0, 64)}, ${done.sessions} session(s) revoked, ${done.pairings} pairing code(s) cancelled`);
    jsonAnswer(res, 200, {});
  };

  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const path = url.pathname;
    if (path === OIDC_BACKCHANNEL_LOGOUT_PATH) {
      if (req.method !== "POST") {
        req.resume();
        jsonAnswer(res, 405, { error: "method_not_allowed" }, { allow: "POST" });
        return true;
      }
      await backchannel(req, res);
      return true;
    }
    if (path !== OIDC_START_PATH && path !== OIDC_CALLBACK_PATH) return false;
    if (req.method !== "GET") {
      res.writeHead(405, { allow: "GET", "content-type": "application/json" });
      res.end(JSON.stringify({ error: "method_not_allowed" }));
      return true;
    }
    if (path === OIDC_START_PATH) {
      const client = parseClient(url.searchParams.get("client"));
      if (!client) {
        fail(res, "client");
        return true;
      }
      const unavailable = deps.grants.unavailableReason();
      if (unavailable) {
        log(`oidc sign-in could not start: ${unavailable}`);
        fail(res, "unavailable", [], client);
        return true;
      }
      let started;
      try {
        started = await rp.start({ client });
      } catch (error) {
        log(`oidc sign-in could not start: ${error instanceof Error ? error.message : String(error)}`);
        fail(res, "unavailable", [], client);
        return true;
      }
      redirect(res, started.authorizationUrl, [`${bindingCookie}=${started.binding}; ${bindingAttributes}; Max-Age=600`]);
      return true;
    }
    const binding = parseCookies(req.headers.cookie).get(bindingCookie);
    const outcome = await rp.callback(url.searchParams, binding);
    if (!outcome.ok) {
      log(`oidc sign-in refused (${outcome.code}): ${outcome.error}`);
      fail(res, outcome.code, [clearBinding], outcome.client);
      return true;
    }
    const identity: OidcIdentity = outcome.identity;
    const client = outcome.client;
    const refreshToken = outcome.grant.refreshToken;
    const refuse = (code: string, why: string) => {
      log(`oidc sign-in refused (${code}): ${why}`);
      if (refreshToken) void rp.revokeToken(refreshToken, "refresh_token");
      fail(res, code, [clearBinding], client);
    };
    const scopes = scopesForRole(identity.role);
    const orgRole = orgRoleForRole(identity.role);
    if (!scopes || !orgRole) {
      refuse("role", `subject ${identity.sub.slice(0, 64)} has no person role`);
      return true;
    }
    // Never a session without its grant: the grant is how the provider ends it.
    if (!refreshToken) {
      refuse("grant", "the identity provider returned no refresh token (is offline_access allowed for this client?)");
      return true;
    }
    const unavailable = deps.grants.unavailableReason();
    if (unavailable) {
      refuse("unavailable", unavailable);
      return true;
    }
    const principal = deps.forSubject({
      iss: identity.iss,
      sub: identity.sub,
      claims: { email: identity.email, name: identity.name, login: identity.preferredUsername },
      orgRole,
    });
    const native = client === "desktop" || client === "phone";
    let grantRef: string;
    try {
      grantRef = deps.grants.createGrant({
        iss: identity.iss,
        sub: identity.sub,
        refreshToken,
        bindBy: now() + (native ? OIDC_NATIVE_PAIRING_TTL_MS + OIDC_NATIVE_BIND_GRACE_MS : 60_000),
      });
    } catch (error) {
      refuse("unavailable", error instanceof Error ? error.message : String(error));
      return true;
    }
    const idp = { iss: identity.iss, sub: identity.sub, ...(identity.role ? { role: identity.role } : {}), grantRef };
    if (native) {
      const pairing = deps.openPairing({
        principalId: principal.id,
        scopes,
        ttlMs: OIDC_NATIVE_PAIRING_TTL_MS,
        label: client === "desktop" ? "Pulsa Bot desktop" : "Pulsa Bot phone",
        idp,
      });
      redirect(res, client === "desktop"
        ? desktopReturnLink(origin, { code: pairing.credential })
        : phoneReturnLink(origin, pairing.credential, deps.serverName()), [clearBinding]);
      return true;
    }
    const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined;
    let issued;
    try {
      issued = deps.issueSession({
        label: labelFromUserAgent(userAgent) || "Pulsatrix sign-in",
        scopes,
        ...(principal.email ? { email: principal.email } : {}),
        principalId: principal.id,
        idp,
      });
    } catch (error) {
      deps.grants.discard(grantRef);
      throw error;
    }
    deps.grants.bindSession(grantRef, issued.session.id);
    redirect(res, "/", [
      serializeSessionCookie(deps.sessionCookie, issued.token, { secure, maxAgeSeconds: cookieMaxAgeSeconds(issued.session) }),
      clearBinding,
    ]);
    return true;
  };
}
