// Configuration and role mapping of "Sign in with Pulsatrix" (the routes
// themselves are proven through the real server in oidc-login.e2e.test.ts).
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { IDP_SWEEP_SLACK_MS, IdpGrantVault, IdpSessionManager } from "./idp-session.ts";
import { BACKCHANNEL_MAX_BODY_BYTES, OIDC_NATIVE_BIND_GRACE_MS, OIDC_NATIVE_PAIRING_TTL_MS, createOidcLoginRoutes, desktopReturnLink, identityConfigFromEnv, identityDescriptor, isInterimSignInRoute, orgRoleForRole, phoneReturnLink, scopesForRole } from "./oidc-login.ts";
import { RoutineConsents } from "./org-routine-consent.ts";
import { OidcRelyingParty } from "./oidc-rp.ts";
import { PrincipalRegistry } from "./principals.ts";
import { SessionRegistry } from "./sessions.ts";
import { startFakeOidcProvider, type FakeOidcProvider } from "./testing/fake-oidc-provider.ts";

describe("OMB_IDENTITY", () => {
  it("is solo unless set to perspicax", () => {
    expect(identityConfigFromEnv({})).toEqual({ kind: "solo" });
    expect(identityConfigFromEnv({ OMB_IDENTITY: "solo" })).toEqual({ kind: "solo" });
    expect(identityDescriptor({ kind: "solo" })).toBeUndefined();
    expect(() => identityConfigFromEnv({ OMB_IDENTITY: "okta" })).toThrow(/not supported/);
  });

  it("derives the redirect URI from the public origin and defaults the client id", () => {
    const config = identityConfigFromEnv({ OMB_IDENTITY: "perspicax", OMB_PERSPICAX_ISSUER: "https://px.example.test/", OMB_PUBLIC_URL: "https://bot.example.test/" });
    expect(config).toEqual({ kind: "perspicax", issuer: "https://px.example.test", clientId: "pulsa-bot", publicOrigin: "https://bot.example.test", redirectUri: "https://bot.example.test/auth/oidc/callback" });
    expect(identityDescriptor(config)).toEqual({ kind: "perspicax", protocol: "oidc", issuer: "https://px.example.test", loginPath: "/auth/oidc/start", nativeReturn: true });
    expect(identityConfigFromEnv({ OMB_IDENTITY: "perspicax", OMB_PERSPICAX_ISSUER: "http://localhost:18787", OMB_PUBLIC_URL: "http://localhost:18788", OMB_OIDC_CLIENT_ID: "other" }))
      .toMatchObject({ clientId: "other", redirectUri: "http://localhost:18788/auth/oidc/callback" });
  });

  it("refuses to start half configured or over plain http off this machine", () => {
    expect(() => identityConfigFromEnv({ OMB_IDENTITY: "perspicax", OMB_PUBLIC_URL: "https://bot.example.test" })).toThrow(/OMB_PERSPICAX_ISSUER/);
    expect(() => identityConfigFromEnv({ OMB_IDENTITY: "perspicax", OMB_PERSPICAX_ISSUER: "http://px.example.test", OMB_PUBLIC_URL: "https://bot.example.test" })).toThrow(/OMB_PERSPICAX_ISSUER/);
    expect(() => identityConfigFromEnv({ OMB_IDENTITY: "perspicax", OMB_PERSPICAX_ISSUER: "https://px.example.test" })).toThrow(/OMB_PUBLIC_URL/);
    expect(() => identityConfigFromEnv({ OMB_IDENTITY: "perspicax", OMB_PERSPICAX_ISSUER: "https://px.example.test", OMB_PUBLIC_URL: "http://bot.example.test" })).toThrow(/OMB_PUBLIC_URL/);
    expect(() => identityConfigFromEnv({ OMB_IDENTITY: "perspicax", OMB_PERSPICAX_ISSUER: "https://px.example.test", OMB_PUBLIC_URL: "https://bot.example.test/app" })).toThrow(/OMB_PUBLIC_URL/);
  });

  it("takes an optional internal origin for server-to-server calls (http allowed, no path)", () => {
    const base = { OMB_IDENTITY: "perspicax", OMB_PERSPICAX_ISSUER: "https://px.example.test", OMB_PUBLIC_URL: "https://bot.example.test" };
    expect(identityConfigFromEnv({ ...base, OMB_PERSPICAX_INTERNAL_URL: "http://perspicax:8787/" })).toMatchObject({ internalBase: "http://perspicax:8787" });
    expect(identityConfigFromEnv(base)).not.toHaveProperty("internalBase");
    expect(() => identityConfigFromEnv({ ...base, OMB_PERSPICAX_INTERNAL_URL: "http://perspicax:8787/api" })).toThrow(/OMB_PERSPICAX_INTERNAL_URL/);
    expect(() => identityConfigFromEnv({ ...base, OMB_PERSPICAX_INTERNAL_URL: "ftp://perspicax" })).toThrow(/OMB_PERSPICAX_INTERNAL_URL/);
  });
});

describe("the role claim", () => {
  it("maps admin to admin scopes, manager and employee (or no claim) to client, anything else to nothing", () => {
    expect(scopesForRole("admin")).toEqual(["admin", "client"]);
    expect(orgRoleForRole("admin")).toBe("admin");
    for (const role of ["manager", "employee", undefined]) {
      expect(scopesForRole(role)).toEqual(["client"]);
      expect(orgRoleForRole(role)).toBe("member");
    }
    expect(scopesForRole("service")).toBeNull();
    expect(orgRoleForRole("owner")).toBeNull();
  });
});

describe("interim sign-in routes on an organization server", () => {
  it("covers email codes and every invitation path, nothing else", () => {
    expect(isInterimSignInRoute("POST", "/api/auth/email/start")).toBe(true);
    expect(isInterimSignInRoute("POST", "/api/auth/email/verify")).toBe(true);
    expect(isInterimSignInRoute("POST", "/api/org/invites")).toBe(true);
    expect(isInterimSignInRoute("GET", "/api/org/invites/abc/preview")).toBe(true);
    expect(isInterimSignInRoute("POST", "/api/org/invites/abc/join")).toBe(true);
    expect(isInterimSignInRoute("GET", "/api/org")).toBe(false);
    expect(isInterimSignInRoute("POST", "/api/auth/pair")).toBe(false);
    expect(isInterimSignInRoute("GET", "/api/org/invitesx")).toBe(false);
  });
});

// ── the routes in process (slice 2): native returns and back-channel logout ──

describe("the sign-in routes (in process)", () => {
  const USER = { sub: "01J9ROUTES0000000000000000", email: "ada@example.test", name: "Ada", preferred_username: "ada", role: "employee" };
  let provider: FakeOidcProvider;
  let server: Server;
  let base = "";
  let dir = "";
  let sessions: SessionRegistry;
  let principals: PrincipalRegistry;
  let manager: IdpSessionManager;
  let vaultOk = true;
  const createdGrants: Array<{ bindBy: number; at: number }> = [];
  let rp: OidcRelyingParty;
  let consents: RoutineConsents;

  beforeAll(async () => {
    provider = await startFakeOidcProvider({ user: USER });
    dir = mkdtempSync(join(tmpdir(), "omb-oidc-routes-"));
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const config = { kind: "perspicax" as const, issuer: provider.issuer, clientId: "pulsa-bot", publicOrigin: base, redirectUri: `${base}/auth/oidc/callback` };
    rp = new OidcRelyingParty({ issuer: config.issuer, clientId: config.clientId, redirectUri: config.redirectUri, resource: base });
    sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
    principals = new PrincipalRegistry({ path: join(dir, "principals.json") });
    const vault = new IdpGrantVault(dir, () => vaultOk ? { kind: "key", key: Buffer.alloc(32, 7) } : { kind: "unavailable", reason: "no key" });
    manager = new IdpSessionManager({ vault, rp, sessions, principals, log: () => {} });
    consents = new RoutineConsents({ vault, rp, principals, log: () => {} });
    sessions.onExchanged((session) => { if (session.idp?.grantRef) manager.bindSession(session.idp.grantRef, session.id); });
    const routes = createOidcLoginRoutes({
      config, rp, sessionCookie: "omb_session_test",
      forSubject: (input) => principals.forSubject(input),
      issueSession: (input) => sessions.issue(input),
      grants: {
        unavailableReason: () => vaultOk ? null : "no key",
        createGrant: (input) => { createdGrants.push({ bindBy: input.bindBy, at: Date.now() }); return manager.createGrant(input); },
        bindSession: (ref, id) => manager.bindSession(ref, id),
        discard: (ref) => manager.discard(ref),
        backchannelLogout: (input) => manager.backchannelLogout(input),
        createRoutineDelegation: (input) => consents.create(input),
        sessionPrincipal: (id) => sessions.byId(id)?.principalId ?? null,
      },
      openPairing: (input) => sessions.openPairing(input),
      serverName: () => "Acme & Co bots",
      log: () => {},
    });
    server.on("request", (req, res) => {
      void routes(req, res, new URL(req.url ?? "/", base)).then((handled) => {
        if (!handled) { res.writeHead(404); res.end(); }
      });
    });
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await provider.close();
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    vaultOk = true;
    provider.user = { ...USER };
  });

  async function walk(client?: string, options: { binding?: string } = {}) {
    const start = await fetch(`${base}/auth/oidc/start${client ? `?client=${client}` : ""}`, { redirect: "manual" });
    const location = start.headers.get("location") ?? "";
    if (!location.startsWith(provider.issuer)) return { start, callback: null as Response | null, location };
    const bindingCookie = start.headers.getSetCookie().find((c) => c.includes("_oidc="))!.split(";")[0]!;
    const authorize = await fetch(location, { redirect: "manual" });
    const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: options.binding ?? bindingCookie } });
    return { start, callback, location: callback.headers.get("location") ?? "" };
  }

  it("refuses an unknown client, and a start while grants cannot be kept", async () => {
    const bad = await walk("tablet");
    expect(bad.start.status).toBe(303);
    expect(bad.location).toBe("/pair#signin_error=client");
    vaultOk = false;
    expect((await walk()).location).toBe("/pair#signin_error=unavailable");
    expect((await walk("desktop")).location).toBe(`openmausbot://auth?origin=${encodeURIComponent(base)}#error=unavailable`);
  });

  it("ends a desktop sign-in on openmausbot://auth with a person-bound, single-use pairing credential", async () => {
    const { callback, location } = await walk("desktop");
    expect(callback!.status).toBe(303);
    expect(callback!.headers.get("cache-control")).toBe("no-store");
    expect(callback!.headers.get("referrer-policy")).toBe("no-referrer");
    expect(callback!.headers.getSetCookie().some((c) => c.startsWith("omb_session_test="))).toBe(false);
    const match = /^openmausbot:\/\/auth\?origin=([^#&]+)#code=(omb_pair_[A-Za-z0-9_-]{43})$/.exec(location);
    expect(match, location).not.toBeNull();
    expect(decodeURIComponent(match![1]!)).toBe(base);
    expect(location).toBe(desktopReturnLink(base, { code: match![2]! }));
    const exchanged = sessions.exchange({ code: match![2]!, label: "My Mac", source: "10.0.0.1" });
    expect(exchanged.ok).toBe(true);
    if (!exchanged.ok) return;
    const record = sessions.byId(exchanged.session.id)!;
    const person = principals.bySubject(provider.issuer, USER.sub)!;
    expect(record).toMatchObject({ principalId: person.id, scopes: ["client"], idp: { iss: provider.issuer, sub: USER.sub, role: "employee", grantRef: expect.any(String) } });
    expect(manager.mustRefuse(record)).toBeNull();
    expect(sessions.exchange({ code: match![2]!, label: "again", source: "10.0.0.1" }).ok).toBe(false);
  });

  it("revokes an unredeemed native grant within three minutes of the flow start, after its credential has expired", async () => {
    expect(OIDC_NATIVE_PAIRING_TTL_MS + OIDC_NATIVE_BIND_GRACE_MS + IDP_SWEEP_SLACK_MS).toBeLessThanOrEqual(170_000);
    for (const client of ["desktop", "phone"]) {
      createdGrants.length = 0;
      const flowStart = Date.now();
      await walk(client);
      expect(createdGrants).toHaveLength(1);
      const { bindBy, at } = createdGrants[0]!;
      expect(bindBy).toBeGreaterThanOrEqual(at + OIDC_NATIVE_PAIRING_TTL_MS);
      expect(bindBy + IDP_SWEEP_SLACK_MS - flowStart).toBeLessThan(180_000);
    }
  });

  it("ends a phone sign-in on the invite link both phone apps already parse", async () => {
    const { location } = await walk("phone");
    const url = new URL(location);
    expect(url.protocol).toBe("openmausbot:");
    expect(url.host).toBe("pair");
    expect(url.searchParams.get("address")).toBe(base);
    expect(url.searchParams.get("name")).toBe("Acme & Co bots");
    const token = url.searchParams.get("token")!;
    expect(token).toMatch(/^omb_pair_[A-Za-z0-9_-]{43}$/);
    expect(location).toBe(phoneReturnLink(base, token, "Acme & Co bots"));
  });

  it("sends desktop errors back to the app, phone and web errors to /pair", async () => {
    expect((await walk("desktop", { binding: "omb_session_test_oidc=wrong" })).location).toBe(`openmausbot://auth?origin=${encodeURIComponent(base)}#error=binding`);
    expect((await walk("phone", { binding: "omb_session_test_oidc=wrong" })).location).toBe("/pair#signin_error=binding");
    provider.user = { ...USER, sub: "01J9SERVICE", role: "service" };
    const revokedBefore = provider.revoked.length;
    expect((await walk("desktop")).location).toBe(`openmausbot://auth?origin=${encodeURIComponent(base)}#error=role`);
    await new Promise((r) => setTimeout(r, 100));
    expect(provider.revoked.length).toBe(revokedBefore + 1); // the refused sign-in's grant is revoked
  });

  /** Slice 6: sign in on the web, then walk a routine delegation flow the
   * way POST /api/org/routine-delegation starts it. */
  async function delegate(options: { as?: typeof USER; sessionGone?: boolean; binding?: string; failToken?: number } = {}) {
    const { callback } = await walk();
    const cookie = callback!.headers.getSetCookie().find((c) => c.startsWith("omb_session_test="))!;
    const record = sessions.authenticate(decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!))!;
    const started = await rp.start({ purpose: "routines", principalId: record.principalId!, subject: { iss: provider.issuer, sub: record.idp!.sub }, sessionId: record.id });
    if (options.as) provider.user = { ...options.as };
    if (options.sessionGone) {
      sessions.revokeWhere((session) => session.id === record.id);
      manager.release(record.id, { revokeAtIdp: true });
    }
    const authorize = await fetch(started.authorizationUrl, { redirect: "manual" });
    if (options.failToken) provider.failNextToken(options.failToken);
    const back = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: options.binding ?? `omb_session_test_oidc=${started.binding}` } });
    return { back, location: back.headers.get("location") ?? "", principalId: record.principalId! };
  }

  it("keeps a routine delegation and lands on #routine-delegation=ok (slice 6)", async () => {
    const { back, location, principalId } = await delegate();
    expect(back.status).toBe(303);
    expect(location).toBe("/#routine-delegation=ok");
    expect(back.headers.getSetCookie().some((c) => c.startsWith("omb_session_test_oidc=;") && c.includes("Max-Age=0"))).toBe(true);
    expect(back.headers.getSetCookie().some((c) => c.startsWith("omb_session_test="))).toBe(false);
    expect(consents.status(principalId).state).toBe("active");
    expect(provider.delegationOf(USER.sub)).not.toBeNull();
    consents.revoke(principalId);
  });

  it("refuses another subject, a gone session, a missing marker and a wrong binding, and revokes (slice 6)", async () => {
    const other = { ...USER, sub: "01J9OTHER00000000000000000", email: "eve@example.test" };
    let revokedBefore = provider.revoked.length;
    const wrong = await delegate({ as: other });
    expect(wrong.location).toBe("/#routine-delegation-error=routines_subject");
    await new Promise((r) => setTimeout(r, 100));
    expect(provider.revoked.length).toBeGreaterThan(revokedBefore);
    // the family the other account got is dead at the provider
    expect(provider.delegationOf(other.sub)).toBeNull();
    expect(consents.status(wrong.principalId).state).toBe("none");
    provider.user = { ...USER };
    revokedBefore = provider.revoked.length;
    const gone = await delegate({ sessionGone: true });
    expect(gone.location).toBe("/#routine-delegation-error=routines_session");
    await new Promise((r) => setTimeout(r, 100));
    expect(provider.revoked.length).toBeGreaterThan(revokedBefore);
    expect(provider.delegationOf(USER.sub)).toBeNull();
    provider.tamper = { omitRoutinesMarker: true };
    try {
      expect((await delegate()).location).toBe("/#routine-delegation-error=routines_scope");
    } finally {
      provider.tamper = {};
    }
    expect((await delegate({ binding: "omb_session_test_oidc=wrong" })).location).toBe("/#routine-delegation-error=binding");
    expect(consents.principalsWithConsent()).toEqual([]);
  });

  it("names its person in login_hint, so another account signing in keeps its own delegation (slice 6, S6-12)", async () => {
    const bob = { ...USER, sub: "01J9BOB0000000000000000000", email: "bob@example.test" };
    provider.user = { ...bob };
    const own = await delegate();
    expect(own.location).toBe("/#routine-delegation=ok");
    expect(provider.lastAuthorize?.login_hint).toBe(bob.sub);
    const bobsDelegation = provider.delegationOf(bob.sub);
    expect(bobsDelegation).not.toBeNull();
    try {
      // Alice starts, Bob signs in at Perspicax
      provider.user = { ...USER };
      const revokedBefore = provider.revoked.length;
      const wrong = await delegate({ as: bob });
      expect(provider.lastAuthorize?.login_hint).toBe(USER.sub);
      // the subject is checked before the scope (the marker was dropped)
      expect(wrong.location).toBe("/#routine-delegation-error=routines_subject");
      await new Promise((r) => setTimeout(r, 100));
      expect(provider.revoked.length).toBeGreaterThan(revokedBefore);
      expect(provider.delegationOf(bob.sub)).toEqual(bobsDelegation);
      expect(consents.status(own.principalId).state).toBe("active");
      expect(consents.status(wrong.principalId).state).toBe("none");
    } finally {
      provider.user = { ...USER };
      consents.revoke(own.principalId);
    }
  });

  it("binds a web sign-in's grant to its session at once", async () => {
    const { location, callback } = await walk();
    expect(location).toBe("/");
    const cookie = callback!.headers.getSetCookie().find((c) => c.startsWith("omb_session_test="))!;
    const token = decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!);
    const record = sessions.authenticate(token)!;
    expect(record.idp?.grantRef).toBeTruthy();
    expect(manager.mustRefuse(record)).toBeNull();
    expect(manager.sweep()).toBe(0);
  });

  it("passes a rate-limited code exchange back as rate_limited, for a sign-in and a delegation (fix 2)", async () => {
    const start = await fetch(`${base}/auth/oidc/start`, { redirect: "manual" });
    const bindingCookie = start.headers.getSetCookie().find((c) => c.includes("_oidc="))!.split(";")[0]!;
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    provider.failNextToken(429);
    const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: bindingCookie } });
    expect(callback.headers.get("location")).toBe("/pair#signin_error=rate_limited");
    const delegated = await delegate({ failToken: 429 });
    expect(delegated.location).toBe("/#routine-delegation-error=rate_limited");
    expect(consents.status(delegated.principalId).state).toBe("none");
  });

  describe("POST /api/auth/oidc/backchannel-logout", () => {
    const post = (body: string, type = "application/x-www-form-urlencoded") =>
      fetch(`${base}/api/auth/oidc/backchannel-logout`, { method: "POST", headers: { "content-type": type }, body });

    it("answers 405 to other methods, 400 to another content type or an oversized body", async () => {
      const get = await fetch(`${base}/api/auth/oidc/backchannel-logout`);
      expect(get.status).toBe(405);
      const token = provider.logoutToken({ sub: USER.sub });
      const json = await post(JSON.stringify({ logout_token: token }), "application/json");
      expect(json.status).toBe(400);
      expect(await json.json()).toEqual({ error: "invalid_request" });
      const big = await post(`logout_token=${token}&pad=${"x".repeat(BACKCHANNEL_MAX_BODY_BYTES)}`);
      expect(big.status).toBe(400);
      expect((await post("")).status).toBe(400);
    });

    it.each([
      ["another key", { strayKey: true }],
      ["alg none", { header: (h: Record<string, unknown>) => ({ ...h, alg: "none" }) }],
      ["another audience", { claims: (c: Record<string, unknown>) => ({ ...c, aud: "other" }) }],
      ["another issuer", { claims: (c: Record<string, unknown>) => ({ ...c, iss: "https://evil.example" }) }],
      ["an expired token", { claims: (c: Record<string, unknown>) => ({ ...c, exp: Math.floor(Date.now() / 1000) - 120 }) }],
      ["no events", { claims: (c: Record<string, unknown>) => { const { events: _e, ...rest } = c; return rest; } }],
      ["a nonce", { claims: (c: Record<string, unknown>) => ({ ...c, nonce: "n" }) }],
      ["no subject", { claims: (c: Record<string, unknown>) => { const { sub: _s, ...rest } = c; return rest; } }],
    ])("refuses %s with 400 and leaves the sessions alone", async (_what, tamper) => {
      const { callback } = await walk();
      const cookie = callback!.headers.getSetCookie().find((c) => c.startsWith("omb_session_test="))!;
      const token = decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!);
      const res = await post(`logout_token=${provider.logoutToken({ sub: USER.sub, ...tamper })}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
      expect(sessions.authenticate(token)).not.toBeNull();
    });

    it("honours a valid token once: 200 {} no-store, the person's sessions end; a replay is 400", async () => {
      const { callback } = await walk();
      const cookie = callback!.headers.getSetCookie().find((c) => c.startsWith("omb_session_test="))!;
      const token = decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!);
      const logout = provider.logoutToken({ sub: USER.sub });
      const res = await post(`logout_token=${encodeURIComponent(logout)}`, "application/x-www-form-urlencoded; charset=utf-8");
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({});
      expect(sessions.authenticate(token)).toBeNull();
      expect(principals.bySubject(provider.issuer, USER.sub)?.disabledAt).toBeTypeOf("number");
      const replay = await post(`logout_token=${encodeURIComponent(logout)}`);
      expect(replay.status).toBe(400);
      // an unknown subject verifies and does nothing
      expect((await post(`logout_token=${provider.logoutToken({ sub: "nobody-here" })}`)).status).toBe(200);
    });
  });
});
