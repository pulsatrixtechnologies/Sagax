// Who reaches /api/org/routine-delegation (slice 6, fix 2 contract item 5).
// The auth gate answers first (403 for a session-less local request under
// service trust, 401 for a session that expired or was revoked; see
// server/org-routines.e2e.test.ts); this is what the route itself answers.
import { describe, expect, it } from "vitest";

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
      settings: () => ({}),
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
