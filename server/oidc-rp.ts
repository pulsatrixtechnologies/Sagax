// OpenID Connect relying party for the organization server (Backend for
// Frontend). The Pulsa Bot server is the OIDC client: it starts the
// authorization code flow with PKCE S256, a `state` and a `nonce`, exchanges
// the code at the token endpoint itself, and verifies the ES256 id_token
// against the issuer's JWKS with node:crypto. No token from the identity
// provider ever reaches a browser, the desktop app, a phone or an engine:
// they receive the ordinary Pulsa Bot session (server/sessions.ts).
//
// Pending flows live in memory only: ten minutes, single use, at most
// MAX_PENDING_FLOWS (the oldest is dropped). Each flow is also bound to the
// browser that started it by a random value in a short HttpOnly cookie, so a
// callback URL carrying someone else's code cannot sign a victim's browser in
// as the attacker (login CSRF).
//
// Spec: docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md,
// section 2 ("Flux de connexion", "Vérification de l'id_token") and T10.
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify as verifySignature, type JsonWebKeyInput, type KeyObject } from "node:crypto";

import { authorizationServerMetadataUrls, pkcePair, readBounded, safeEndpoint } from "./mcp-oauth.ts";

export const OIDC_PENDING_FLOW_TTL_MS = 10 * 60_000;
export const OIDC_MAX_PENDING_FLOWS = 20;
/** Clock tolerance on `exp` and `iat`, in seconds. */
export const OIDC_CLOCK_SKEW_SECONDS = 60;
const DISCOVERY_TTL_MS = 60 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_SUB_LENGTH = 255;

/** The claims Pulsa Bot reads from a verified id_token. Everything else in the
 * token is ignored; `email` is an attribute, never a key (Perspicax does not
 * verify addresses). */
export interface OidcIdentity {
  iss: string;
  sub: string;
  email?: string;
  name?: string;
  preferredUsername?: string;
  /** Perspicax role claim, verbatim: `admin`, `manager` or `employee`. */
  role?: string;
  authTime?: number;
}

export interface OidcDiscovery {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  /** RFC 9207: the authorization response carries `iss`. When advertised, a
   * callback without it is refused. */
  issParameterSupported: boolean;
  revocationEndpoint?: string;
}

export class OidcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OidcError";
    this.code = code;
  }
}

export interface OidcRelyingPartyOptions {
  issuer: string;
  clientId: string;
  redirectUri: string;
  /** Space-separated. Slice 1 asks for the identity only; `offline_access`
   * arrives with session refresh in slice 2. */
  scope?: string;
  /** RFC 8707 resource for the login access token: the Pulsa Bot public
   * origin, so that token is worthless on the identity provider's /mcp. */
  resource?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

interface PendingFlow {
  state: string;
  nonce: string;
  verifier: string;
  /** sha256 of the browser binding cookie value. */
  bindingHash: string;
  createdAt: number;
}

export interface StartedFlow {
  /** Where to send the browser. */
  authorizationUrl: string;
  /** Value of the browser binding cookie (never logged). */
  binding: string;
  state: string;
}

export type CallbackOutcome =
  | { ok: true; identity: OidcIdentity }
  | { ok: false; code: string; error: string };

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function stringClaim(value: unknown, max = 512): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

function decodeSegment(segment: string, what: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new OidcError("id_token_malformed", `The id_token ${what} is not base64url.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new OidcError("id_token_malformed", `The id_token ${what} is not JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new OidcError("id_token_malformed", `The id_token ${what} is not an object.`);
  return parsed as Record<string, unknown>;
}

/** A P-256 signing key from a JWKS entry, or null when the entry is not one. */
function es256Key(jwk: Record<string, unknown>): KeyObject | null {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") return null;
  if (jwk.use !== undefined && jwk.use !== "sig") return null;
  if (jwk.alg !== undefined && jwk.alg !== "ES256") return null;
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string" || jwk.d !== undefined) return null;
  try {
    const input: JsonWebKeyInput = { key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" };
    return createPublicKey(input);
  } catch {
    return null;
  }
}

export interface VerifyIdTokenInput {
  token: string;
  issuer: string;
  audience: string;
  nonce: string;
  /** Looks a key up by `kid`; may refetch the JWKS once. */
  keyFor: (kid: string) => Promise<KeyObject | null>;
  nowSeconds: number;
  skewSeconds?: number;
}

/** Verify a compact JWS id_token: alg exactly ES256 (never `none`), a kid the
 * JWKS knows, a valid P-256 signature, then iss, aud (and azp when there are
 * several audiences), exp, iat and nonce. Throws OidcError on any failure. */
export async function verifyIdToken(input: VerifyIdTokenInput): Promise<OidcIdentity> {
  const skew = input.skewSeconds ?? OIDC_CLOCK_SKEW_SECONDS;
  const parts = input.token.split(".");
  if (parts.length !== 3) throw new OidcError("id_token_malformed", "The id_token is not a compact JWS.");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = decodeSegment(headerPart, "header");
  if (header.alg !== "ES256") throw new OidcError("id_token_alg", `The id_token algorithm must be ES256, not ${String(header.alg).slice(0, 20)}.`);
  if (header.crit !== undefined) throw new OidcError("id_token_malformed", "The id_token carries critical header parameters.");
  const kid = stringClaim(header.kid, 256);
  if (!kid) throw new OidcError("id_token_kid", "The id_token has no key id.");
  const key = await input.keyFor(kid);
  if (!key) throw new OidcError("id_token_kid", "The id_token was signed with a key the issuer does not publish.");
  if (!/^[A-Za-z0-9_-]+$/.test(signaturePart)) throw new OidcError("id_token_signature", "The id_token signature is not base64url.");
  const signature = Buffer.from(signaturePart, "base64url");
  if (signature.length !== 64) throw new OidcError("id_token_signature", "The id_token signature has the wrong length.");
  const valid = verifySignature("sha256", Buffer.from(`${headerPart}.${payloadPart}`), { key, dsaEncoding: "ieee-p1363" }, signature);
  if (!valid) throw new OidcError("id_token_signature", "The id_token signature does not verify.");

  const claims = decodeSegment(payloadPart, "payload");
  if (claims.iss !== input.issuer) throw new OidcError("id_token_iss", "The id_token was issued by another issuer.");
  const aud = claims.aud;
  const audiences = typeof aud === "string" ? [aud] : Array.isArray(aud) ? aud.filter((v): v is string => typeof v === "string") : [];
  if (!audiences.includes(input.audience)) throw new OidcError("id_token_aud", "The id_token is meant for another client.");
  if (audiences.length > 1 && claims.azp !== input.audience) throw new OidcError("id_token_aud", "The id_token names several audiences without this client as its party.");
  if (claims.azp !== undefined && claims.azp !== input.audience) throw new OidcError("id_token_aud", "The id_token was issued to another client.");
  const exp = claims.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) throw new OidcError("id_token_exp", "The id_token has no expiry.");
  if (exp + skew <= input.nowSeconds) throw new OidcError("id_token_exp", "The id_token has expired.");
  const iat = claims.iat;
  if (typeof iat !== "number" || !Number.isFinite(iat)) throw new OidcError("id_token_iat", "The id_token has no issue time.");
  if (iat - skew > input.nowSeconds) throw new OidcError("id_token_iat", "The id_token was issued in the future.");
  if (typeof claims.nonce !== "string" || !sameText(claims.nonce, input.nonce)) throw new OidcError("id_token_nonce", "The id_token nonce does not match this sign-in.");
  const sub = stringClaim(claims.sub, MAX_SUB_LENGTH);
  if (!sub) throw new OidcError("id_token_sub", "The id_token has no subject.");

  const identity: OidcIdentity = { iss: input.issuer, sub };
  const email = stringClaim(claims.email, 320);
  if (email) identity.email = email;
  const name = stringClaim(claims.name, 200);
  if (name) identity.name = name;
  const login = stringClaim(claims.preferred_username, 200);
  if (login) identity.preferredUsername = login;
  const role = stringClaim(claims.role, 40);
  if (role) identity.role = role;
  if (typeof claims.auth_time === "number" && Number.isFinite(claims.auth_time)) identity.authTime = claims.auth_time;
  return identity;
}

/** An issuer URL the server may talk to: https, or http on this machine
 * (tests and a local compose). */
export function validIssuer(value: string): string | null {
  const trimmed = value.trim();
  if (!safeEndpoint(trimmed)) return null;
  const url = new URL(trimmed);
  if (url.search || url.hash) return null;
  // The issuer is compared byte for byte with `iss`: keep it as configured,
  // minus a lone trailing slash on a bare origin.
  return url.pathname === "/" ? trimmed.replace(/\/$/, "") : trimmed;
}

export class OidcRelyingParty {
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
  private readonly scope: string;
  private readonly resource: string | undefined;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly pending = new Map<string, PendingFlow>();
  private discovery: { value: OidcDiscovery; at: number } | null = null;
  private discovering: Promise<OidcDiscovery> | null = null;
  private keys = new Map<string, KeyObject>();
  private keysFetched = false;
  private refetching: Promise<void> | null = null;

  constructor(options: OidcRelyingPartyOptions) {
    const issuer = validIssuer(options.issuer);
    if (!issuer) throw new OidcError("config", "The OIDC issuer must be an https URL (http only on this machine).");
    const redirect = safeEndpoint(options.redirectUri);
    if (!redirect) throw new OidcError("config", "The OIDC redirect URI must be an https URL (http only on this machine).");
    if (!options.clientId.trim()) throw new OidcError("config", "The OIDC client id is required.");
    this.issuer = issuer;
    this.clientId = options.clientId.trim();
    this.redirectUri = options.redirectUri.trim();
    this.scope = options.scope?.trim() || "openid profile email";
    this.resource = options.resource;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /** Pending flows, for tests and diagnostics (never the secrets). */
  pendingCount(): number {
    this.prune();
    return this.pending.size;
  }

  private prune(): void {
    const now = this.now();
    for (const [state, flow] of this.pending) if (now - flow.createdAt >= OIDC_PENDING_FLOW_TTL_MS) this.pending.delete(state);
  }

  private async getJson(url: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> | null }> {
    let response: Response;
    try {
      response = await this.fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "application/json", ...init?.headers } });
    } catch (error) {
      throw new OidcError("unreachable", `The identity provider could not be reached: ${error instanceof Error ? error.message : String(error)}`);
    }
    let body: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(await readBounded(response));
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  /** The issuer's metadata, cached for an hour. The document's `issuer` must
   * equal the configured one exactly, and every endpoint must be https (or
   * http on this machine). */
  async discover(force = false): Promise<OidcDiscovery> {
    if (!force && this.discovery && this.now() - this.discovery.at < DISCOVERY_TTL_MS) return this.discovery.value;
    this.discovering ??= (async () => {
      try {
        let lastError = "no discovery document";
        // OpenID Connect Discovery first: this is an OIDC client.
        const urls = authorizationServerMetadataUrls(this.issuer);
        const ordered = [...urls.filter((u) => u.includes("openid-configuration")), ...urls.filter((u) => !u.includes("openid-configuration"))];
        for (const url of ordered) {
          let got: { status: number; body: Record<string, unknown> | null };
          try {
            got = await this.getJson(url);
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            continue;
          }
          if (got.status !== 200 || !got.body) {
            lastError = `${url} answered ${got.status}`;
            continue;
          }
          const doc = got.body;
          if (doc.issuer !== this.issuer) throw new OidcError("discovery", "The identity provider's metadata names another issuer.");
          const authorizationEndpoint = safeEndpoint(doc.authorization_endpoint);
          const tokenEndpoint = safeEndpoint(doc.token_endpoint);
          const jwksUri = safeEndpoint(doc.jwks_uri);
          if (!authorizationEndpoint || !tokenEndpoint || !jwksUri) {
            throw new OidcError("discovery", "The identity provider's metadata lacks an https authorization, token or JWKS endpoint.");
          }
          const algs = doc.id_token_signing_alg_values_supported;
          if (Array.isArray(algs) && !algs.includes("ES256")) throw new OidcError("discovery", "The identity provider does not sign id_tokens with ES256.");
          const value: OidcDiscovery = {
            issuer: this.issuer,
            authorizationEndpoint,
            tokenEndpoint,
            jwksUri,
            issParameterSupported: doc.authorization_response_iss_parameter_supported === true,
            ...(safeEndpoint(doc.revocation_endpoint) ? { revocationEndpoint: safeEndpoint(doc.revocation_endpoint) } : {}),
          };
          if (this.discovery?.value.jwksUri !== value.jwksUri) {
            this.keys = new Map();
            this.keysFetched = false;
          }
          this.discovery = { value, at: this.now() };
          return value;
        }
        throw new OidcError("discovery", `The identity provider's metadata could not be read (${lastError}).`);
      } finally {
        this.discovering = null;
      }
    })();
    return this.discovering;
  }

  private async fetchKeys(): Promise<void> {
    const { jwksUri } = await this.discover();
    const got = await this.getJson(jwksUri);
    if (got.status !== 200 || !got.body || !Array.isArray(got.body.keys)) throw new OidcError("jwks", "The identity provider's JWKS could not be read.");
    const next = new Map<string, KeyObject>();
    for (const entry of got.body.keys) {
      if (!entry || typeof entry !== "object") continue;
      const jwk = entry as Record<string, unknown>;
      const kid = stringClaim(jwk.kid, 256);
      const key = kid ? es256Key(jwk) : null;
      if (kid && key) next.set(kid, key);
    }
    this.keys = next;
    this.keysFetched = true;
  }

  /** A signing key by kid: from the cache, else after one JWKS refetch
   * (single flight), so a rotated key is picked up without a restart. */
  private async keyFor(kid: string): Promise<KeyObject | null> {
    const cached = this.keysFetched ? this.keys.get(kid) : undefined;
    if (cached) return cached;
    this.refetching ??= this.fetchKeys().finally(() => { this.refetching = null; });
    await this.refetching;
    return this.keys.get(kid) ?? null;
  }

  /** Begin a sign-in: remember state, nonce and PKCE verifier, and return
   * the authorization URL and the browser binding. */
  async start(): Promise<StartedFlow> {
    const discovery = await this.discover();
    this.prune();
    while (this.pending.size >= OIDC_MAX_PENDING_FLOWS) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
    const state = randomToken();
    const nonce = randomToken();
    const binding = randomToken();
    const { verifier, challenge } = pkcePair();
    this.pending.set(state, { state, nonce, verifier, bindingHash: sha256Hex(binding), createdAt: this.now() });
    const url = new URL(discovery.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("scope", this.scope);
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (this.resource) url.searchParams.set("resource", this.resource);
    return { authorizationUrl: url.toString(), binding, state };
  }

  /** Finish a sign-in from the callback's query and the browser binding
   * cookie. The pending flow is consumed whatever the outcome. */
  async callback(params: URLSearchParams, binding: string | undefined): Promise<CallbackOutcome> {
    try {
      return { ok: true, identity: await this.finish(params, binding) };
    } catch (error) {
      if (error instanceof OidcError) return { ok: false, code: error.code, error: error.message };
      return { ok: false, code: "internal", error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async finish(params: URLSearchParams, binding: string | undefined): Promise<OidcIdentity> {
    this.prune();
    const state = params.get("state") ?? "";
    const flow = state ? this.pending.get(state) : undefined;
    if (!flow) throw new OidcError("state", "This sign-in link is unknown, already used or expired. Start again.");
    this.pending.delete(state); // single use, whatever happens next
    if (!binding || !sameText(sha256Hex(binding), flow.bindingHash)) {
      throw new OidcError("binding", "This sign-in was started in another browser. Start again here.");
    }
    const discovery = await this.discover();
    const iss = params.get("iss");
    if (iss !== null ? iss !== this.issuer : discovery.issParameterSupported) {
      throw new OidcError("iss", "The sign-in response came from another issuer.");
    }
    const providerError = params.get("error");
    if (providerError) {
      const description = params.get("error_description");
      throw new OidcError("provider", `The identity provider refused the sign-in (${providerError.slice(0, 64)}${description ? `: ${description.slice(0, 200)}` : ""}).`);
    }
    const code = params.get("code");
    if (!code) throw new OidcError("code", "The sign-in response carries no code.");

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      code_verifier: flow.verifier,
    });
    if (this.resource) form.set("resource", this.resource);
    const got = await this.getJson(discovery.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (got.status !== 200 || !got.body) {
      const reason = typeof got.body?.error === "string" ? got.body.error.slice(0, 64) : `HTTP ${got.status}`;
      throw new OidcError("token", `The identity provider refused the code exchange (${reason}).`);
    }
    const idToken = got.body.id_token;
    if (typeof idToken !== "string" || !idToken) throw new OidcError("id_token_missing", "The identity provider returned no id_token; is `openid` allowed for this client?");
    try {
      return await verifyIdToken({
        token: idToken,
        issuer: this.issuer,
        audience: this.clientId,
        nonce: flow.nonce,
        keyFor: (kid) => this.keyFor(kid),
        nowSeconds: Math.floor(this.now() / 1000),
      });
    } finally {
      // Slice 1 keeps no provider token: the Pulsa Bot session stands on its
      // own. Rather than leave a live refresh family at the provider, revoke
      // it now (RFC 7009; revoking the refresh token also ends its access
      // tokens). Session refresh arrives with slice 2 (server/idp-session.ts).
      const refresh = typeof got.body.refresh_token === "string" ? got.body.refresh_token : undefined;
      const access = typeof got.body.access_token === "string" ? got.body.access_token : undefined;
      if (discovery.revocationEndpoint && (refresh || access)) {
        this.revoke(discovery.revocationEndpoint, refresh ?? access!, refresh ? "refresh_token" : "access_token");
      }
    }
  }

  /** Fire and forget: a revocation that fails leaves a token that expires on
   * its own (access 1 h, refresh 30 days idle); it is logged, never thrown. */
  private revoke(endpoint: string, token: string, hint: "refresh_token" | "access_token"): void {
    const body = new URLSearchParams({ token, token_type_hint: hint, client_id: this.clientId }).toString();
    void this.fetcher(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
    }).then(
      (response) => { void response.body?.cancel().catch(() => {}); if (!response.ok) console.warn(`oidc: token revocation answered ${response.status}`); },
      (error: unknown) => console.warn(`oidc: token revocation failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  }
}
