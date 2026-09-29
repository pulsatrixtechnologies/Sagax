// A local OpenID Connect provider shaped like Perspicax slice 1, for tests:
// discovery, a JWKS with one ES256 key (rotatable), an authorize endpoint
// that signs the configured person in at once (no page), and a token
// endpoint that checks the code, client, redirect URI and PKCE S256 before
// returning an ES256 id_token. `tamper` bends one thing at a time so a test
// can prove the relying party refuses it. In-process only; imported by tests.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeOidcUser {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  role?: string;
}

export interface FakeOidcTamper {
  /** Edit the id_token claims before signing. */
  claims?: (claims: Record<string, unknown>) => Record<string, unknown>;
  /** Edit the id_token header before signing. */
  header?: (header: Record<string, unknown>) => Record<string, unknown>;
  /** Sign with a key the JWKS does not publish (same kid). */
  strayKey?: boolean;
  /** Change the claims after signing (the signature no longer matches). */
  afterSigning?: (claims: Record<string, unknown>) => Record<string, unknown>;
  /** Leave `iss` off the authorization response. */
  dropIssParam?: boolean;
  /** Put this `iss` on the authorization response instead. */
  issParam?: string;
  /** Answer the authorize request with this OAuth error. */
  authorizeError?: string;
  /** Return no id_token. */
  noIdToken?: boolean;
}

interface Key { kid: string; privateKey: KeyObject; publicJwk: Record<string, unknown> }

function newKey(): Key {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kid = randomBytes(8).toString("hex");
  const jwk = publicKey.export({ format: "jwk" });
  return { kid, privateKey, publicJwk: { ...jwk, kid, use: "sig", alg: "ES256" } };
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export interface FakeOidcProvider {
  issuer: string;
  clientId: string;
  user: FakeOidcUser;
  tamper: FakeOidcTamper;
  /** Every JWKS fetch, for the cache and refetch tests. */
  jwksFetches: number;
  /** The last token request's form fields. */
  lastTokenRequest: Record<string, string> | null;
  /** Every revocation request's form fields. */
  revoked: Array<Record<string, string>>;
  /** The last authorize request's query. */
  lastAuthorize: Record<string, string> | null;
  /** Replace the signing key (the old one leaves the JWKS). */
  rotateKey(): void;
  close(): Promise<void>;
}

export async function startFakeOidcProvider(options: { clientId?: string; user?: FakeOidcUser } = {}): Promise<FakeOidcProvider> {
  const clientId = options.clientId ?? "pulsa-bot";
  let key = newKey();
  const stray = newKey();
  const codes = new Map<string, { clientId: string; redirectUri: string; challenge: string; nonce: string; user: FakeOidcUser }>();
  let server: Server | null = null;

  const provider: FakeOidcProvider = {
    issuer: "",
    clientId,
    user: options.user ?? { sub: "01J0000000000000000000ADMN", email: "ada@example.test", name: "Ada Admin", preferred_username: "ada", role: "admin" },
    tamper: {},
    jwksFetches: 0,
    lastTokenRequest: null,
    lastAuthorize: null,
    revoked: [],
    rotateKey() {
      key = newKey();
    },
    close: () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
  };

  const send = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  const idToken = (user: FakeOidcUser, nonce: string): string => {
    const now = Math.floor(Date.now() / 1000);
    let claims: Record<string, unknown> = {
      iss: provider.issuer, sub: user.sub, aud: clientId, azp: clientId, exp: now + 600, iat: now, auth_time: now, nonce,
      amr: ["pwd", "otp"], email_verified: false,
      ...(user.email ? { email: user.email } : {}),
      ...(user.name ? { name: user.name } : {}),
      ...(user.preferred_username ? { preferred_username: user.preferred_username } : {}),
      ...(user.role ? { role: user.role } : {}),
    };
    if (provider.tamper.claims) claims = provider.tamper.claims(claims);
    let header: Record<string, unknown> = { alg: "ES256", typ: "JWT", kid: key.kid };
    if (provider.tamper.header) header = provider.tamper.header(header);
    const input = `${b64(header)}.${b64(claims)}`;
    const signer = provider.tamper.strayKey ? stray.privateKey : key.privateKey;
    const signature = sign("sha256", Buffer.from(input), { key: signer, dsaEncoding: "ieee-p1363" }).toString("base64url");
    const payload = provider.tamper.afterSigning ? b64(provider.tamper.afterSigning(claims)) : b64(claims);
    return `${b64(header)}.${payload}.${signature}`;
  };

  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", provider.issuer || "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      return send(res, 200, {
        issuer: provider.issuer,
        authorization_endpoint: `${provider.issuer}/oauth/authorize`,
        token_endpoint: `${provider.issuer}/oauth/token`,
        jwks_uri: `${provider.issuer}/oauth/jwks`,
        revocation_endpoint: `${provider.issuer}/oauth/revoke`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        id_token_signing_alg_values_supported: ["ES256"],
        subject_types_supported: ["public"],
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (req.method === "GET" && url.pathname === "/oauth/jwks") {
      provider.jwksFetches += 1;
      return send(res, 200, { keys: [key.publicJwk] });
    }
    if (req.method === "GET" && url.pathname === "/oauth/authorize") {
      const q = Object.fromEntries(url.searchParams);
      provider.lastAuthorize = q;
      if (q.client_id !== clientId || !q.redirect_uri || q.response_type !== "code" || q.code_challenge_method !== "S256" || !q.code_challenge) {
        return send(res, 400, { error: "invalid_request" });
      }
      const back = new URL(q.redirect_uri);
      if (q.state) back.searchParams.set("state", q.state);
      if (!provider.tamper.dropIssParam) back.searchParams.set("iss", provider.tamper.issParam ?? provider.issuer);
      if (provider.tamper.authorizeError) {
        back.searchParams.set("error", provider.tamper.authorizeError);
      } else {
        const code = randomBytes(24).toString("base64url");
        codes.set(code, { clientId: q.client_id, redirectUri: q.redirect_uri, challenge: q.code_challenge, nonce: q.nonce ?? "", user: { ...provider.user } });
        back.searchParams.set("code", code);
      }
      res.writeHead(302, { location: back.toString() });
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/oauth/token") {
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (raw += chunk));
      req.on("end", () => {
        const form = Object.fromEntries(new URLSearchParams(raw));
        provider.lastTokenRequest = form;
        const grant = form.code ? codes.get(form.code) : undefined;
        if (form.code) codes.delete(form.code); // single use
        if (form.grant_type !== "authorization_code" || !grant) return send(res, 400, { error: "invalid_grant" });
        if (form.client_id !== grant.clientId || form.redirect_uri !== grant.redirectUri) return send(res, 400, { error: "invalid_grant" });
        const challenge = createHash("sha256").update(form.code_verifier ?? "").digest("base64url");
        if (challenge !== grant.challenge) return send(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" });
        return send(res, 200, {
          access_token: `pxlo1.${randomBytes(16).toString("hex")}`,
          refresh_token: `pxlr1.${randomBytes(16).toString("hex")}`,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid profile email",
          ...(provider.tamper.noIdToken ? {} : { id_token: idToken(grant.user, grant.nonce) }),
        });
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/oauth/revoke") {
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (raw += chunk));
      req.on("end", () => {
        provider.revoked.push(Object.fromEntries(new URLSearchParams(raw)));
        send(res, 200, {});
      });
      return;
    }
    send(res, 404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
  provider.issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return provider;
}
