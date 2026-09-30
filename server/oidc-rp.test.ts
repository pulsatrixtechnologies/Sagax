// The OpenID Connect relying party against a local fake provider: a real
// ES256 key from node:crypto, real discovery, JWKS and token endpoints over
// HTTP. Every refusal the spec lists (T10) is proven by bending one thing.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { OIDC_MAX_PENDING_FLOWS, OIDC_PENDING_FLOW_TTL_MS, OidcRelyingParty, parseTeamsClaim, validIssuer } from "./oidc-rp.ts";
import { startFakeOidcProvider, type FakeOidcProvider } from "./testing/fake-oidc-provider.ts";

const REDIRECT = "http://127.0.0.1:9/auth/oidc/callback";
let idp: FakeOidcProvider;

beforeAll(async () => {
  idp = await startFakeOidcProvider();
});
afterAll(async () => {
  await idp.close();
});
afterEach(() => {
  idp.tamper = {};
  idp.user = { sub: "01J0000000000000000000ADMN", email: "ada@example.test", name: "Ada Admin", preferred_username: "ada", role: "admin" };
});

function rp(now?: () => number) {
  return new OidcRelyingParty({ issuer: idp.issuer, clientId: "pulsa-bot", redirectUri: REDIRECT, resource: "http://127.0.0.1:9", ...(now ? { now } : {}) });
}

/** Start, follow the authorize redirect the way a browser would, and return
 * the callback query plus the binding cookie. */
async function authorize(party: OidcRelyingParty) {
  const started = await party.start();
  const res = await fetch(started.authorizationUrl, { redirect: "manual" });
  const location = res.headers.get("location");
  if (!location) throw new Error(`authorize answered ${res.status}`);
  const back = new URL(location);
  return { started, params: back.searchParams, back };
}

describe("OIDC relying party", () => {
  it("signs a person in: PKCE S256, state, nonce and resource go out; an ES256 id_token comes back verified", async () => {
    const party = rp();
    const { started, params, back } = await authorize(party);
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
    const sent = idp.lastAuthorize!;
    expect(sent).toMatchObject({ client_id: "pulsa-bot", redirect_uri: REDIRECT, response_type: "code", code_challenge_method: "S256", resource: "http://127.0.0.1:9" });
    expect(sent.scope.split(" ")).toContain("openid");
    expect(sent.state).toBe(started.state);
    expect(sent.nonce).toMatch(/^[\w-]{43}$/);
    const outcome = await party.callback(params, started.binding);
    expect(outcome).toEqual({
      ok: true,
      client: "web",
      grant: { refreshToken: expect.stringMatching(/^pxlr1\./) },
      identity: expect.objectContaining({ iss: idp.issuer, sub: "01J0000000000000000000ADMN", email: "ada@example.test", name: "Ada Admin", preferredUsername: "ada", role: "admin" }),
    });
    expect(sent.scope.split(" ")).toEqual(["openid", "profile", "email", "offline_access"]);
    // the verifier went to the token endpoint, never the browser
    expect(idp.lastTokenRequest?.code_verifier).toMatch(/^[\w-]{43}$/);
    expect(started.authorizationUrl).not.toContain(idp.lastTokenRequest!.code_verifier);
    expect(idp.lastTokenRequest).toMatchObject({ grant_type: "authorization_code", client_id: "pulsa-bot", redirect_uri: REDIRECT, resource: "http://127.0.0.1:9" });
    expect(party.pendingCount()).toBe(0);
    // slice 2 keeps the grant: nothing is revoked after a good sign-in
    const revokedBefore = idp.revoked.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(idp.revoked.length).toBe(revokedBefore);
  });

  it("refuses a state it did not issue, and a state used twice", async () => {
    const party = rp();
    const { started, params } = await authorize(party);
    const forged = new URLSearchParams(params);
    forged.set("state", "not-a-state");
    expect(await party.callback(forged, started.binding)).toMatchObject({ ok: false, code: "state" });
    expect((await party.callback(params, started.binding)).ok).toBe(true);
    expect(await party.callback(params, started.binding)).toMatchObject({ ok: false, code: "state" });
  });

  it("refuses a callback from another browser (no or wrong binding) and burns the flow", async () => {
    const party = rp();
    const { params } = await authorize(party);
    expect(await party.callback(params, "someone-elses-cookie")).toMatchObject({ ok: false, code: "binding" });
    const again = await authorize(party);
    expect(await party.callback(again.params, undefined)).toMatchObject({ ok: false, code: "binding" });
  });

  it("proves PKCE: a code redeemed with the wrong verifier is refused by the provider", async () => {
    const party = rp();
    const { started, params } = await authorize(party);
    // Swap the pending flow's verifier for another: the provider's S256 check fails.
    const pending = (party as unknown as { pending: Map<string, { verifier: string }> }).pending;
    pending.get(started.state)!.verifier = "x".repeat(43);
    expect(await party.callback(params, started.binding)).toMatchObject({ ok: false, code: "token" });
    expect(idp.lastTokenRequest?.code_verifier).toBe("x".repeat(43));
  });

  it("refuses a bad signature, a key the JWKS does not publish, and alg none", async () => {
    const party = rp();
    idp.tamper = { strayKey: true };
    let flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_signature" });

    // A token signed by the real key whose payload is changed afterwards.
    idp.tamper = { afterSigning: (c) => ({ ...c, role: "admin", sub: "01J00000000000000000MALLORY" }) };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_signature" });

    idp.tamper = { header: (h) => ({ ...h, kid: "unknown-kid" }) };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_kid" });

    idp.tamper = { header: (h) => ({ ...h, alg: "none" }) };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_alg" });

    idp.tamper = { header: (h) => ({ ...h, alg: "HS256" }) };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_alg" });
  });

  it("refuses a wrong audience, a wrong issuer, an extra audience without azp", async () => {
    const party = rp();
    idp.tamper = { claims: (c) => ({ ...c, aud: "another-client" }) };
    let flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_aud" });

    idp.tamper = { claims: (c) => { const { azp: _azp, ...rest } = c; return { ...rest, aud: ["pulsa-bot", "other"] }; } };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_aud" });

    idp.tamper = { claims: (c) => ({ ...c, azp: "other" }) };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_aud" });

    idp.tamper = { claims: (c) => ({ ...c, iss: "https://evil.example" }) };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_iss" });
  });

  it("refuses an authorization response from another issuer (RFC 9207), or without iss when the provider promises it", async () => {
    const party = rp();
    idp.tamper = { issParam: "https://evil.example" };
    let flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "iss" });
    idp.tamper = { dropIssParam: true };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "iss" });
  });

  it("refuses an expired id_token and one issued in the future, within 60 s of tolerance", async () => {
    const party = rp();
    const now = Math.floor(Date.now() / 1000);
    idp.tamper = { claims: (c) => ({ ...c, exp: now - 120 }) };
    let flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_exp" });

    idp.tamper = { claims: (c) => ({ ...c, exp: now - 30 }) }; // inside the tolerance
    flow = await authorize(party);
    expect((await party.callback(flow.params, flow.started.binding)).ok).toBe(true);

    idp.tamper = { claims: (c) => ({ ...c, iat: now + 600 }) };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_iat" });
  });

  it("refuses a nonce that is not this sign-in's", async () => {
    const party = rp();
    idp.tamper = { claims: (c) => ({ ...c, nonce: "replayed-nonce" }) };
    let flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_nonce" });
    idp.tamper = { claims: (c) => { const { nonce: _nonce, ...rest } = c; return rest; } };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_nonce" });
  });

  it("refuses a token response without an id_token, and an authorize error", async () => {
    const party = rp();
    idp.tamper = { noIdToken: true };
    let flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "id_token_missing" });
    idp.tamper = { authorizeError: "access_denied" };
    flow = await authorize(party);
    expect(await party.callback(flow.params, flow.started.binding)).toMatchObject({ ok: false, code: "provider" });
  });

  it("caches the JWKS and refetches once on an unknown kid (key rotation)", async () => {
    const party = rp();
    const before = idp.jwksFetches;
    let flow = await authorize(party);
    expect((await party.callback(flow.params, flow.started.binding)).ok).toBe(true);
    flow = await authorize(party);
    expect((await party.callback(flow.params, flow.started.binding)).ok).toBe(true);
    expect(idp.jwksFetches - before).toBe(1);
    idp.rotateKey();
    flow = await authorize(party);
    expect((await party.callback(flow.params, flow.started.binding)).ok).toBe(true);
    expect(idp.jwksFetches - before).toBe(2);
  });

  it("forgets flows after ten minutes and keeps at most twenty", async () => {
    let clock = Date.now();
    const party = rp(() => clock);
    const { started, params } = await authorize(party);
    clock += OIDC_PENDING_FLOW_TTL_MS;
    expect(await party.callback(params, started.binding)).toMatchObject({ ok: false, code: "state" });
    for (let i = 0; i < OIDC_MAX_PENDING_FLOWS + 5; i++) await party.start();
    expect(party.pendingCount()).toBe(OIDC_MAX_PENDING_FLOWS);
  });

  it("refuses discovery that names another issuer, and insecure configuration", async () => {
    const party = new OidcRelyingParty({ issuer: `${idp.issuer}/`, clientId: "pulsa-bot", redirectUri: REDIRECT });
    // a lone trailing slash is the same issuer
    expect(party.issuer).toBe(idp.issuer);
    expect(validIssuer("http://px.example.com")).toBeNull();
    expect(validIssuer("https://px.example.com/")).toBe("https://px.example.com");
    expect(() => new OidcRelyingParty({ issuer: "http://px.example.com", clientId: "pulsa-bot", redirectUri: REDIRECT })).toThrow(/https/);
    const other = await startFakeOidcProvider();
    try {
      const lying = new OidcRelyingParty({ issuer: other.issuer, clientId: "pulsa-bot", redirectUri: REDIRECT, fetch: (input, init) => {
        const url = String(input).replace(other.issuer, idp.issuer);
        return fetch(url, init);
      } });
      await expect(lying.start()).rejects.toThrow(/another issuer/);
    } finally {
      await other.close();
    }
  });
});

/** A full sign-in, returning the refresh token the provider issued. */
async function signedInGrant(party: OidcRelyingParty): Promise<string> {
  const { started, params } = await authorize(party);
  const outcome = await party.callback(params, started.binding);
  if (!outcome.ok || !outcome.grant.refreshToken) throw new Error(`sign-in failed: ${JSON.stringify(outcome)}`);
  return outcome.grant.refreshToken;
}

describe("OIDC relying party: refresh (slice 2)", () => {
  it("keeps the client kind of the flow it started", async () => {
    const party = rp();
    const started = await party.start({ client: "desktop" });
    const res = await fetch(started.authorizationUrl, { redirect: "manual" });
    const outcome = await party.callback(new URL(res.headers.get("location")!).searchParams, started.binding);
    expect(outcome).toMatchObject({ ok: true, client: "desktop" });
    const other = await party.start({ client: "phone" });
    const back = await fetch(other.authorizationUrl, { redirect: "manual" });
    expect(await party.callback(new URL(back.headers.get("location")!).searchParams, "wrong")).toMatchObject({ ok: false, code: "binding", client: "phone" });
  });

  it("rotates the refresh token, sends the resource, and verifies the refreshed id_token without a nonce", async () => {
    const party = rp();
    const first = await signedInGrant(party);
    const refreshed = await party.refresh(first, { sub: idp.user.sub });
    expect(refreshed).toMatchObject({ ok: true, refreshToken: expect.stringMatching(/^pxlr1\./), identity: expect.objectContaining({ sub: idp.user.sub, role: "admin" }) });
    expect(idp.lastTokenRequest).toMatchObject({ grant_type: "refresh_token", client_id: "pulsa-bot", resource: "http://127.0.0.1:9" });
    if (!refreshed.ok) throw new Error("unreachable");
    expect(refreshed.refreshToken).not.toBe(first);
    // the old token is dead after rotation
    expect(await party.refresh(first, { sub: idp.user.sub })).toMatchObject({ ok: false, kind: "rejected" });
    // and the new one works, carrying the current role
    idp.setRole(idp.user.sub, "employee");
    const again = await party.refresh(refreshed.refreshToken, { sub: idp.user.sub });
    expect(again).toMatchObject({ ok: true, identity: expect.objectContaining({ role: "employee" }) });
    idp.setRole(idp.user.sub, "admin");
  });

  it("accepts a refresh without an id_token", async () => {
    const party = rp();
    const token = await signedInGrant(party);
    idp.tamper = { noIdToken: true };
    const refreshed = await party.refresh(token, { sub: idp.user.sub });
    expect(refreshed.ok).toBe(true);
    expect(refreshed.ok && refreshed.identity).toBeUndefined();
  });

  it("rejects a refreshed id_token for another subject, one carrying a nonce, and a disabled person", async () => {
    const party = rp();
    let token = await signedInGrant(party);
    expect(await party.refresh(token, { sub: "someone-else" })).toMatchObject({ ok: false, kind: "rejected" });
    token = await signedInGrant(party);
    idp.tamper = { claims: (c) => ({ ...c, nonce: "n" }) };
    expect(await party.refresh(token, { sub: idp.user.sub })).toMatchObject({ ok: false, kind: "rejected", error: expect.stringMatching(/nonce/) });
    idp.tamper = {};
    token = await signedInGrant(party);
    idp.disable(idp.user.sub);
    try {
      expect(await party.refresh(token, { sub: idp.user.sub })).toMatchObject({ ok: false, kind: "rejected", error: expect.stringMatching(/invalid_grant/) });
    } finally {
      idp.enable(idp.user.sub);
    }
  });

  it("treats 5xx, 429 and an unreachable provider as transient", async () => {
    const party = rp();
    const token = await signedInGrant(party);
    idp.failNextToken(503);
    expect(await party.refresh(token, { sub: idp.user.sub })).toMatchObject({ ok: false, kind: "transient" });
    idp.failNextToken(429);
    expect(await party.refresh(token, { sub: idp.user.sub })).toMatchObject({ ok: false, kind: "transient" });
    // the token survived both
    expect((await party.refresh(token, { sub: idp.user.sub })).ok).toBe(true);
    const offline = new OidcRelyingParty({ issuer: idp.issuer, clientId: "pulsa-bot", redirectUri: REDIRECT, fetch: () => Promise.reject(new Error("ECONNREFUSED")) });
    expect(await offline.refresh("pxlr1.x", { sub: "s" })).toMatchObject({ ok: false, kind: "transient" });
  });

  it("revokes a token at the provider and never throws", async () => {
    const party = rp();
    const token = await signedInGrant(party);
    expect(await party.revokeToken(token)).toBe(true);
    expect(idp.revoked.at(-1)).toEqual({ token, token_type_hint: "refresh_token", client_id: "pulsa-bot" });
    expect(await party.refresh(token, { sub: idp.user.sub })).toMatchObject({ ok: false, kind: "rejected" });
    const offline = new OidcRelyingParty({ issuer: idp.issuer, clientId: "pulsa-bot", redirectUri: REDIRECT, fetch: () => Promise.reject(new Error("down")) });
    expect(await offline.revokeToken("x")).toBe(false);
  });
});

describe("OIDC relying party: back-channel logout tokens", () => {
  const sub = "01J0000000000000000000ADMN";

  it("verifies a good logout token (typ logout+jwt, JWT or absent)", async () => {
    const party = rp();
    const claims = await party.verifyLogoutToken(idp.logoutToken({ sub }));
    expect(claims).toMatchObject({ iss: idp.issuer, sub, jti: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
    await expect(party.verifyLogoutToken(idp.logoutToken({ sub, header: (h) => ({ ...h, typ: "JWT" }) }))).resolves.toMatchObject({ sub });
    await expect(party.verifyLogoutToken(idp.logoutToken({ sub, header: (h) => { const { typ: _typ, ...rest } = h; return rest; } }))).resolves.toMatchObject({ sub });
  });

  it.each([
    ["another key", { strayKey: true }, "logout_token_signature"],
    ["alg none", { header: (h: Record<string, unknown>) => ({ ...h, alg: "none" }) }, "logout_token_alg"],
    ["an unknown kid", { header: (h: Record<string, unknown>) => ({ ...h, kid: "nope" }) }, "logout_token_kid"],
    ["another typ", { header: (h: Record<string, unknown>) => ({ ...h, typ: "at+jwt" }) }, "logout_token_typ"],
    ["another audience", { claims: (c: Record<string, unknown>) => ({ ...c, aud: "other" }) }, "logout_token_aud"],
    ["another issuer", { claims: (c: Record<string, unknown>) => ({ ...c, iss: "https://evil.example" }) }, "logout_token_iss"],
    ["no expiry", { claims: (c: Record<string, unknown>) => { const { exp: _exp, ...rest } = c; return rest; } }, "logout_token_exp"],
    ["an expired token", { claims: (c: Record<string, unknown>) => ({ ...c, exp: Math.floor(Date.now() / 1000) - 120 }) }, "logout_token_exp"],
    ["an issue time in the future", { claims: (c: Record<string, unknown>) => ({ ...c, iat: Math.floor(Date.now() / 1000) + 600 }) }, "logout_token_iat"],
    ["no events", { claims: (c: Record<string, unknown>) => { const { events: _events, ...rest } = c; return rest; } }, "logout_token_events"],
    ["the wrong event", { claims: (c: Record<string, unknown>) => ({ ...c, events: { "http://example/other": {} } }) }, "logout_token_events"],
    ["an event that is not an object", { claims: (c: Record<string, unknown>) => ({ ...c, events: { "http://schemas.openid.net/event/backchannel-logout": true } }) }, "logout_token_events"],
    ["a nonce", { claims: (c: Record<string, unknown>) => ({ ...c, nonce: "n" }) }, "logout_token_nonce"],
    ["no jti", { claims: (c: Record<string, unknown>) => { const { jti: _jti, ...rest } = c; return rest; } }, "logout_token_jti"],
    ["a sid only", { claims: (c: Record<string, unknown>) => { const { sub: _sub, ...rest } = c; return { ...rest, sid: "s1" }; } }, "logout_token_sub"],
  ])("refuses %s", async (_what, tamper, code) => {
    const party = rp();
    await expect(party.verifyLogoutToken(idp.logoutToken({ sub, ...tamper }))).rejects.toMatchObject({ code });
  });

  it("never takes an id_token for a logout token, nor a logout token for an id_token", async () => {
    const party = rp();
    // an id_token carries a nonce and no events
    let captured = "";
    const spy = new OidcRelyingParty({ issuer: idp.issuer, clientId: "pulsa-bot", redirectUri: REDIRECT, resource: "http://127.0.0.1:9", fetch: async (input, init) => {
      const res = await fetch(input, init);
      if (String(input).endsWith("/oauth/token")) {
        const body = await res.clone().json() as { id_token?: string };
        captured = body.id_token ?? "";
      }
      return res;
    } });
    await signedInGrant(spy);
    expect(captured).toMatch(/^eyJ/);
    await expect(party.verifyLogoutToken(captured)).rejects.toMatchObject({ code: expect.stringMatching(/^logout_token_(nonce|events)$/) });
    // a logout token presented as a refreshed id_token is refused
    const { verifyIdToken } = await import("./oidc-rp.ts");
    await party.discover();
    await expect(verifyIdToken({
      token: idp.logoutToken({ sub }), issuer: idp.issuer, audience: "pulsa-bot", nonce: null,
      keyFor: async () => (party as unknown as { keys: Map<string, import("node:crypto").KeyObject> }).keys.values().next().value ?? null,
      nowSeconds: Math.floor(Date.now() / 1000),
    })).rejects.toMatchObject({ code: "id_token_typ" });
  });
});

describe("OIDC relying party: internal server-to-server base (slice 3, D17)", () => {
  const ISSUER = "https://px.example.test";
  const INTERNAL = "http://perspicax:8787";
  function stub(doc: Record<string, unknown>) {
    const seen: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      seen.push(url);
      if (url === `${INTERNAL}/.well-known/openid-configuration`) {
        return new Response(JSON.stringify(doc), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    return { seen, fetcher };
  }
  const metadata = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    jwks_uri: `${ISSUER}/oauth/jwks`,
    revocation_endpoint: `${ISSUER}/oauth/revoke`,
    id_token_signing_alg_values_supported: ["ES256"],
  };

  it("fetches discovery at the internal origin and moves every server endpoint there, never the authorize one", async () => {
    const { seen, fetcher } = stub(metadata);
    const party = new OidcRelyingParty({ issuer: ISSUER, clientId: "pulsa-bot", redirectUri: "https://bot.example.test/auth/oidc/callback", internalBase: INTERNAL, fetch: fetcher });
    const found = await party.discover();
    expect(seen[0]).toBe(`${INTERNAL}/.well-known/openid-configuration`);
    expect(found).toMatchObject({
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/oauth/authorize`,
      tokenEndpoint: `${INTERNAL}/oauth/token`,
      jwksUri: `${INTERNAL}/oauth/jwks`,
      revocationEndpoint: `${INTERNAL}/oauth/revoke`,
    });
    const started = await party.start();
    expect(started.authorizationUrl.startsWith(`${ISSUER}/oauth/authorize?`)).toBe(true);
    expect(party.serverOrigin()).toBe(INTERNAL);
  });

  it("still refuses metadata naming another issuer", async () => {
    const { fetcher } = stub({ ...metadata, issuer: "https://evil.example.test" });
    const party = new OidcRelyingParty({ issuer: ISSUER, clientId: "pulsa-bot", redirectUri: "https://bot.example.test/auth/oidc/callback", internalBase: INTERNAL, fetch: fetcher });
    await expect(party.discover()).rejects.toMatchObject({ code: "discovery" });
  });

  it("keeps an endpoint on another origin under the https rule, and refuses a bad internal base", async () => {
    const { fetcher } = stub({ ...metadata, token_endpoint: "http://elsewhere.example.test/token" });
    const party = new OidcRelyingParty({ issuer: ISSUER, clientId: "pulsa-bot", redirectUri: "https://bot.example.test/auth/oidc/callback", internalBase: INTERNAL, fetch: fetcher });
    await expect(party.discover()).rejects.toMatchObject({ code: "discovery" });
    expect(() => new OidcRelyingParty({ issuer: ISSUER, clientId: "pulsa-bot", redirectUri: "https://bot.example.test/auth/oidc/callback", internalBase: "http://perspicax:8787/path" })).toThrow();
    expect(new OidcRelyingParty({ issuer: ISSUER, clientId: "pulsa-bot", redirectUri: "https://bot.example.test/auth/oidc/callback" }).serverOrigin()).toBe(ISSUER);
  });
});

describe("OIDC relying party: the teams claim (slice 4)", () => {
  it("reads teams from the id_token and leaves identity.teams undefined when the claim is absent", async () => {
    idp.user = { ...idp.user, role: "employee", teams: [{ id: "01TEAMT", name: "T", manager: false }, { id: "01TEAMA", name: "A", manager: true }] };
    const party = rp();
    const { started, params } = await authorize(party);
    const outcome = await party.callback(params, started.binding);
    expect(outcome).toMatchObject({ ok: true, identity: { teams: [{ id: "01TEAMA", name: "A", manager: true }, { id: "01TEAMT", name: "T", manager: false }] } });
    idp.user = { ...idp.user, teams: undefined };
    const second = await authorize(party);
    const plain = await party.callback(second.params, second.started.binding);
    expect(plain.ok && plain.identity.teams).toBeUndefined();
    idp.user = { ...idp.user, teams: [] };
    const third = await authorize(party);
    const empty = await party.callback(third.params, third.started.binding);
    expect(empty.ok && empty.identity.teams).toEqual([]);
  });

  it("drops malformed entries, keeps one per id with manager winning, reads 1000 at most", () => {
    expect(parseTeamsClaim(undefined)).toBeUndefined();
    expect(parseTeamsClaim("T")).toBeUndefined();
    expect(parseTeamsClaim([
      { id: "B", name: "Bravo", manager: false },
      { id: "B", name: "Bravo", manager: true },
      { id: "bad id", name: "x", manager: false },
      { id: "C", name: "x".repeat(201), manager: false },
      { id: "D", name: "Delta", manager: "yes" },
      { id: "x".repeat(65), name: "long", manager: false },
      null,
      "E",
      { id: "A", name: "Alpha", manager: false },
    ])).toEqual([{ id: "A", name: "Alpha", manager: false }, { id: "B", name: "Bravo", manager: true }]);
    const many = Array.from({ length: 1200 }, (_, i) => ({ id: `T${i}`, name: `T${i}`, manager: false }));
    expect(parseTeamsClaim(many)).toHaveLength(1000);
  });
});
