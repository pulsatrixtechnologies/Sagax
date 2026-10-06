// Who reaches /api/org/routine-delegation (slice 6, fix 2 contract item 5).
// The auth gate answers first (403 for a session-less local request under
// service trust, 401 for a session that expired or was revoked; see
// server/org-routines.e2e.test.ts); this is what the route itself answers.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { decideBotAct } from "../shared/bot-act.ts";
import { OrgGithubTokens } from "./org-github-tokens.ts";
import { createPerspicaxOrgRoutes } from "./perspicax-org-routes.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteContext } from "./routes/table.ts";
import type { SessionRecord } from "./sessions.ts";

function answer(auth: RequestAuth, method = "GET") {
  const out: { status?: number; body?: unknown } = {};
  const routes = createPerspicaxOrgRoutes({
    issuer: "https://px.example.test",
    orgName: "Acme",
    directory: () => null,
    bySubject: () => null,
    viewerRole: () => "member",
    settings: () => ({ orgKeyConfigured: false, allowFullAccess: true }),
    pendingAdminApprovals: () => [],
    routineDelegation: {
      status: () => ({ state: "none" }),
      suspendedCount: () => 0,
      start: async () => ({ ok: true, authorizationUrl: "https://px.example.test/oauth/authorize", cookie: "c=1" }),
      revoke: () => true,
    },
  });
  const res = { setHeader: () => {}, headersSent: false, writableEnded: false };
  const ctx = {
    req: {}, res, url: new URL("http://127.0.0.1/api/org/routine-delegation"), path: "/api/org/routine-delegation", method, auth,
    json: (_res: unknown, status: number, body: unknown) => { out.status = status; out.body = body; },
    readBody: async () => ({}),
  } as unknown as RouteContext;
  return routes(ctx).then((result) => ({ ...out, passed: result === PASS }));
}

const session = (overrides: Partial<SessionRecord> = {}): RequestAuth => ({
  kind: "session",
  via: "cookie",
  scopes: ["client"],
  session: { id: "s1", label: "web", scopes: ["client"], createdAt: 1, lastSeenAt: 1, ...overrides } as SessionRecord,
});

describe("/api/org/routine-delegation", () => {
  it("answers 401 session_required to a local request under SAGAX_LOOPBACK_TRUST=owner", async () => {
    for (const method of ["GET", "POST", "DELETE"]) {
      expect(await answer({ kind: "loopback", scopes: ["admin", "client"] }, method)).toMatchObject({ status: 401, body: { code: "session_required" } });
    }
  });

  it("answers 403 identity_perspicax to a session without a principal or a provider account", async () => {
    for (const method of ["GET", "POST", "DELETE"]) {
      expect(await answer(session(), method)).toMatchObject({ status: 403, body: { code: "identity_perspicax" } });
      expect(await answer(session({ principalId: "pr_alice" }), method)).toMatchObject({ status: 403, body: { code: "identity_perspicax" } });
    }
  });

  it("serves a person signed in with Pulsatrix, and DELETE keeps answering {revoked:true}", async () => {
    const alice = session({ principalId: "pr_alice", idp: { iss: "https://px.example.test", sub: "A1", grantRef: "g1" } } as Partial<SessionRecord>);
    expect(await answer(alice)).toMatchObject({ status: 200, body: { state: "none", suspended: 0 } });
    // where the person revokes it: their own access page in the Perspicax console
    expect((await answer(alice)).body).toMatchObject({ manageUrl: "https://px.example.test/console/me/access#sagax", principalId: "pr_alice" });
    expect(await answer(alice, "DELETE")).toMatchObject({ status: 200, body: { revoked: true } });
  });
});

describe("/api/org/directory manageUrl (person panel)", () => {
  async function directoryAs(role: "admin" | "member") {
    const out: { body?: { people: { principalId: string; manageUrl?: string }[] } } = {};
    const routes = createPerspicaxOrgRoutes({
      issuer: "https://px.example.test/",
      orgName: "Acme",
      directory: () => ({
        people: () => [{ sub: "u 1", login: "ada", name: "Ada Example", email: "ada@example.test", role: "employee", status: "active" }],
        state: () => ({ state: "ok" }),
        serverId: () => undefined,
      }) as never,
      bySubject: () => ({ id: "pr_ada" }) as never,
      viewerRole: () => role,
      settings: () => ({ orgKeyConfigured: false, allowFullAccess: true }),
      pendingAdminApprovals: () => [],
    });
    const ctx = {
      req: {}, res: { setHeader: () => {} }, url: new URL("http://127.0.0.1/api/org/directory"), path: "/api/org/directory", method: "GET",
      auth: session({ principalId: "pr_viewer" }),
      json: (_res: unknown, _status: number, body: unknown) => { out.body = body as typeof out.body; },
      readBody: async () => ({}),
    } as unknown as RouteContext;
    await routes(ctx);
    return out.body!.people;
  }

  it("gives an admin each person's Perspicax console page", async () => {
    expect((await directoryAs("admin"))[0]).toMatchObject({ principalId: "pr_ada", manageUrl: "https://px.example.test/console/users/u%201" });
  });

  it("never sends the console page to a member", async () => {
    expect((await directoryAs("member"))[0]).not.toHaveProperty("manageUrl");
  });
});

describe("/api/org/settings githubClientId", () => {
  async function patchGithub(opts: {
    role: "admin" | "member";
    body: unknown;
    save?: (clientId: string | null) => void;
    omitSave?: boolean;
  }) {
    const out: { status?: number; body?: unknown } = {};
    const saved: Array<string | null> = [];
    const routes = createPerspicaxOrgRoutes({
      issuer: "https://px.example.test",
      orgName: "Acme",
      directory: () => null,
      bySubject: () => null,
      viewerRole: () => opts.role,
      settings: () => ({
        orgKeyConfigured: false,
        allowFullAccess: true,
        github: { clientId: saved.at(-1) ?? null, fromEnvironment: false },
      }),
      pendingAdminApprovals: () => [],
      ...(opts.omitSave
        ? {}
        : {
            saveGithubClientId: (clientId: string | null) => {
              saved.push(clientId);
              opts.save?.(clientId);
            },
          }),
    });
    const ctx = {
      req: {},
      res: { setHeader: () => {}, headersSent: false, writableEnded: false },
      url: new URL("http://127.0.0.1/api/org/settings"),
      path: "/api/org/settings",
      method: "PATCH",
      auth: session({ principalId: "pr_admin" }),
      json: (_res: unknown, status: number, body: unknown) => {
        out.status = status;
        out.body = body;
      },
      readBody: async () => opts.body,
    } as unknown as RouteContext;
    await routes(ctx);
    return { ...out, saved };
  }

  it("lets an admin save a trimmed id and clear it with null", async () => {
    const set = await patchGithub({ role: "admin", body: { githubClientId: "  Iv1.acme  " } });
    expect(set).toMatchObject({ status: 200, saved: ["Iv1.acme"] });
    expect(set.body).toMatchObject({ settings: { github: { clientId: "Iv1.acme" } } });
    const cleared = await patchGithub({ role: "admin", body: { githubClientId: null } });
    expect(cleared).toMatchObject({ status: 200, saved: [null] });
  });

  it("refuses a member, a missing saver and a value that is not printable ASCII 1 to 128", async () => {
    expect(await patchGithub({ role: "member", body: { githubClientId: "Iv1.acme" } })).toMatchObject({ status: 403 });
    expect(await patchGithub({ role: "admin", body: { githubClientId: "Iv1.acme" }, omitSave: true })).toMatchObject({ status: 400 });
    for (const githubClientId of ["", "   ", "bad\nid", "a".repeat(129)]) {
      expect(await patchGithub({ role: "admin", body: { githubClientId } })).toMatchObject({ status: 400, saved: [] });
    }
  });
});

describe("/api/org/settings github access tokens", () => {
  const ALPHA = "fake-alpha-token-1111";
  const BRAVO = "fake-bravo-token-2222";
  const CHARLIE = "fake-charlie-token-3333";
  const CHARLIE_NEXT = "fake-charlie-token-4444";
  const SECRETS = [ALPHA, BRAVO, CHARLIE, CHARLIE_NEXT];
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function apiFor(unavailable = false) {
    const dir = mkdtempSync(join(tmpdir(), "sagax-org-gh-route-"));
    dirs.push(dir);
    const store = new OrgGithubTokens(dir, () => unavailable
      ? { kind: "unavailable", reason: "The encrypted credential store could not be read on this launch." }
      : { kind: "key", key: Buffer.alloc(32, 11) });
    async function call(input: { role: "admin" | "member"; method?: "GET" | "PATCH"; body?: unknown }) {
      const method = input.method ?? "PATCH";
      const path = method === "GET" ? "/api/org" : "/api/org/settings";
      const out: { status?: number; body?: { settings?: { githubTokens?: { id: string; label: string; hint: string }[]; githubTokensUnavailable?: boolean } } } = {};
      const routes = createPerspicaxOrgRoutes({
        issuer: "https://px.example.test",
        orgName: "Acme",
        directory: () => null,
        bySubject: () => null,
        viewerRole: () => input.role,
        settings: () => ({
          orgKeyConfigured: false,
          allowFullAccess: true,
          github: { clientId: null, fromEnvironment: false },
          pluginMarketplaces: { mode: "any" as const },
        }),
        pendingAdminApprovals: () => [],
        saveGithubClientId: () => {},
        githubTokens: {
          list: () => store.list(),
          change: (change) => { store.change(change); },
        },
      });
      const ctx = {
        req: {},
        res: { setHeader: () => {}, headersSent: false, writableEnded: false },
        url: new URL(`http://127.0.0.1${path}`),
        path,
        method,
        auth: session({ principalId: "pr_admin" }),
        json: (_res: unknown, status: number, body: unknown) => {
          out.status = status;
          out.body = body as typeof out.body;
        },
        readBody: async () => input.body ?? {},
      } as unknown as RouteContext;
      await routes(ctx);
      return out;
    }
    return { store, call };
  }

  function assertNoSecret(body: unknown) {
    const text = JSON.stringify(body);
    for (const secret of SECRETS) expect(text.includes(secret)).toBe(false);
  }

  it("adds, lists redacted, removes one of several, and never returns the token", async () => {
    const { store, call } = apiFor();
    const first = await call({ role: "admin", body: { githubTokens: { op: "add", label: "Alpha org", token: `  ${ALPHA}  ` } } });
    expect(first.status).toBe(200);
    assertNoSecret(first.body);
    expect(first.body?.settings?.githubTokens).toEqual([
      { id: expect.stringMatching(/^gt_[0-9a-f]{16}$/), label: "Alpha org", hint: "1111" },
    ]);
    await call({ role: "admin", body: { githubTokens: { op: "add", label: "Bravo org", token: BRAVO } } });
    const added = await call({ role: "admin", body: { githubTokens: { op: "add", label: "Charlie org", token: CHARLIE } } });
    assertNoSecret(added.body);
    const listed = added.body!.settings!.githubTokens!;
    expect(listed.map((entry) => entry.label)).toEqual(["Alpha org", "Bravo org", "Charlie org"]);
    const bravo = listed[1]!;
    const removed = await call({ role: "admin", body: { githubTokens: { op: "remove", id: bravo.id } } });
    expect(removed.status).toBe(200);
    assertNoSecret(removed.body);
    expect(removed.body?.settings?.githubTokens?.map((entry) => entry.label)).toEqual(["Alpha org", "Charlie org"]);
    expect(store.tokenFor(listed[0]!.id)).toBe(ALPHA);
    expect(store.tokenFor(listed[2]!.id)).toBe(CHARLIE);
    expect(store.tokenFor(bravo.id)).toBeUndefined();

    const adminGet = await call({ role: "admin", method: "GET" });
    expect(adminGet.body?.settings?.githubTokens?.map((entry) => entry.hint)).toEqual(["1111", "3333"]);
    assertNoSecret(adminGet.body);
    const memberGet = await call({ role: "member", method: "GET" });
    expect(memberGet.body?.settings).not.toHaveProperty("githubTokens");
    assertNoSecret(memberGet.body);

    const memberPatch = await call({ role: "member", body: { githubTokens: { op: "remove", id: listed[0]!.id } } });
    expect(memberPatch.status).toBe(403);
    assertNoSecret(memberPatch.body);
    expect(store.list().map((entry) => entry.label)).toEqual(["Alpha org", "Charlie org"]);

    const wiped = await call({ role: "admin", body: { githubTokens: [{ op: "remove", id: listed[0]!.id }] } });
    expect(wiped.status).toBe(400);
    assertNoSecret(wiped.body);
    expect(store.list()).toHaveLength(2);

    const mixed = await call({ role: "admin", body: { githubTokens: { op: "rename", id: listed[0]!.id, label: "Alpha renamed", token: CHARLIE_NEXT } } });
    expect(mixed.status).toBe(400);
    assertNoSecret(mixed.body);
    expect(store.tokenFor(listed[0]!.id)).toBe(ALPHA);

    const renamed = await call({ role: "admin", body: { githubTokens: { op: "rename", id: listed[0]!.id, label: "Alpha renamed" } } });
    expect(renamed.status).toBe(200);
    expect(renamed.body?.settings?.githubTokens?.[0]).toMatchObject({ label: "Alpha renamed", hint: "1111" });
    expect(store.tokenFor(listed[0]!.id)).toBe(ALPHA);
    assertNoSecret(renamed.body);

    const replaced = await call({ role: "admin", body: { githubTokens: { op: "replace", id: listed[2]!.id, token: CHARLIE_NEXT } } });
    expect(replaced.status).toBe(200);
    expect(replaced.body?.settings?.githubTokens?.find((entry) => entry.id === listed[2]!.id)?.hint).toBe("4444");
    expect(store.tokenFor(listed[2]!.id)).toBe(CHARLIE_NEXT);
    expect(store.tokenFor(listed[0]!.id)).toBe(ALPHA);
    assertNoSecret(replaced.body);

    const echoed = await call({ role: "admin", body: { githubTokens: { op: "add", label: ALPHA, token: ALPHA } } });
    expect(echoed.status).toBe(400);
    assertNoSecret(echoed.body);
    expect(store.list()).toHaveLength(2);
  });

  it("answers 503 without the submitted secret when the vault cannot be read", async () => {
    const { call } = apiFor(true);
    const refused = await call({ role: "admin", body: { githubTokens: { op: "add", label: "Alpha org", token: ALPHA } } });
    expect(refused.status).toBe(503);
    assertNoSecret(refused.body);
    const listed = await call({ role: "admin", method: "GET" });
    expect(listed.body?.settings?.githubTokensUnavailable).toBe(true);
    expect(listed.body?.settings).not.toHaveProperty("githubTokens");
    assertNoSecret(listed.body);
  });

  it("lets a bot act list, add and remove only inside the person's permission, with no secret on the card", () => {
    const secret = ALPHA;
    const neededScope = (method: string) => (method === "GET" ? "client" as const : "admin" as const);
    const add = decideBotAct({
      raw: { method: "PATCH", path: "/api/org/settings", body: { githubTokens: { op: "add", label: "Alpha org", token: secret } } },
      mode: "ask",
      scopes: ["admin", "client"],
      neededScope,
    });
    expect(add).toMatchObject({ ok: true, effect: "hold", summary: "PATCH /api/org/settings" });
    if (add.ok) expect(add.summary.includes(secret)).toBe(false);
    const remove = decideBotAct({
      raw: { method: "PATCH", path: "/api/org/settings", body: { githubTokens: { op: "remove", id: "gt_0123456789abcdef" } } },
      mode: "ask",
      scopes: ["client"],
      neededScope,
    });
    expect(remove).toMatchObject({ ok: false, status: 403 });
    const list = decideBotAct({
      raw: { method: "GET", path: "/api/org" },
      mode: "ask",
      scopes: ["admin", "client"],
      neededScope,
    });
    expect(list).toMatchObject({ ok: true, effect: "run", summary: "GET /api/org" });
  });
});
