// The OpenID Connect relying party against a local fake provider: a real
// ES256 key from node:crypto, real discovery, JWKS and token endpoints over
// HTTP. Every refusal the spec lists (T10) is proven by bending one thing.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { OIDC_MAX_PENDING_FLOWS, OIDC_PENDING_FLOW_TTL_MS, OidcRelyingParty, validIssuer } from "./oidc-rp.ts";
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
    expect(outcome).toEqual({ ok: true, identity: expect.objectContaining({ iss: idp.issuer, sub: "01J0000000000000000000ADMN", email: "ada@example.test", name: "Ada Admin", preferredUsername: "ada", role: "admin" }) });
    // the verifier went to the token endpoint, never the browser
    expect(idp.lastTokenRequest?.code_verifier).toMatch(/^[\w-]{43}$/);
    expect(started.authorizationUrl).not.toContain(idp.lastTokenRequest!.code_verifier);
    expect(idp.lastTokenRequest).toMatchObject({ grant_type: "authorization_code", client_id: "pulsa-bot", redirect_uri: REDIRECT, resource: "http://127.0.0.1:9" });
    expect(party.pendingCount()).toBe(0);
    // slice 1 keeps no provider token: the refresh family is revoked at once
    await new Promise((r) => setTimeout(r, 100));
    expect(idp.revoked.at(-1)).toMatchObject({ token_type_hint: "refresh_token", client_id: "pulsa-bot", token: expect.stringMatching(/^pxlr1\./) });
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
