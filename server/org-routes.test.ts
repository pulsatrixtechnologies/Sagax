import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { parseStoredConfig } from "./config.ts";
import { json, readBody } from "./harness/http.ts";
import { signInListWithOpenInvites } from "./org-directory.ts";
import {
  acceptInviteRoute, createOrgRoute, createOrgRoutes, getOrgRoute, inviteMailMessage, issueInviteRoute, revokeInviteRoute,
  type OrgRouteDeps, type OrgState,
} from "./org-routes.ts";
import { requiredScope } from "./request-auth.ts";
import { dispatchRoutes } from "./routes/table.ts";

const JC = "pr_00000000-0000-4000-8000-00000000000a";

function emptyOrgState(): OrgState {
  return { org: null, invites: [], signIn: { admins: [], members: [] } };
}

function orgStateWithOwner(): OrgState {
  const state = emptyOrgState();
  createOrgRoute(state, { name: "GOX", ownerUserId: JC, host: { kind: "server", url: "https://pulsa.gox.ca" } });
  return state;
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

/** Boots the real route table over an actual HTTP server, the way
 * bot-presets.test.ts and the running server do, so `req` is a genuine
 * IncomingMessage and `requestOrigin(req)` sees real headers. */
async function serveOrgRoutes(deps: Partial<OrgRouteDeps> & { state: OrgState }): Promise<string> {
  const routes = [createOrgRoutes({ actorId: () => JC, actorEmail: () => "jc@gox.ca", ...deps })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, {
      req, res, url, path: url.pathname, method: req.method ?? "GET",
      auth: { kind: "loopback", scopes: ["admin", "client"] }, json, readBody,
    });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function postInvite(base: string, email = "zachary@example.test") {
  const res = await fetch(`${base}/api/org/invites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return { status: res.status, body: (await res.json()) as { invite?: { token: string; email: string }; mailed?: boolean } };
}

describe("org routes", () => {
  it("returns 404 when there is no organization", () => {
    expect(getOrgRoute(emptyOrgState())).toEqual({ status: 404 });
  });
  it("returns the stored org and people from signIn plus the owner", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: JC, host: { kind: "server", url: "https://pulsa.gox.ca" } });
    state.signIn.admins = ["ada@example.test"];
    state.signIn.members = ["zachary@example.test"];
    expect(getOrgRoute(state)).toEqual({
      status: 200,
      body: {
        org: { name: "GOX", ownerUserId: JC, host: { kind: "server", url: "https://pulsa.gox.ca" } },
        people: [
          { id: JC, role: "owner" },
          { id: "ada@example.test", role: "admin" },
          { id: "zachary@example.test", role: "member" },
        ],
        pendingInvites: [],
      },
    });
  });
  it("lists the owner once when their email is also in the sign-in lists", () => {
    const state = emptyOrgState();
    const owner = "pr_11111111-1111-4111-8111-111111111111";
    createOrgRoute(state, { name: "GOX", ownerUserId: owner, host: { kind: "server", url: "https://pulsa.gox.ca" } });
    state.signIn.admins = ["JC@gox.ca", "ada@example.test"];
    state.signIn.members = ["jc@gox.ca", "zachary@example.test"];
    expect(getOrgRoute(state, 1_000, "jc@gox.ca").body?.people).toEqual([
      { id: owner, role: "owner" },
      { id: "ada@example.test", role: "admin" },
      { id: "zachary@example.test", role: "member" },
    ]);
  });
  it("lists an open invite without treating it as a member", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: JC, host: { kind: "server", url: "https://pulsa.gox.ca" } });
    issueInviteRoute(state, { actorId: JC, email: "zachary@example.test", now: 1_000, token: "tok" });
    const body = getOrgRoute(state, 2_000).body;
    expect(body?.people).toEqual([{ id: JC, role: "owner" }]);
    expect(body?.pendingInvites).toEqual([{ email: "zachary@example.test", expiresAt: 1_000 + 7 * 24 * 60 * 60 * 1000 }]);
  });
  it("joins once and reports already-member the second time", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: JC, host: { kind: "server", url: "https://pulsa.gox.ca" } });
    const issued = issueInviteRoute(state, { actorId: JC, email: "zachary@example.test", now: 1, token: "tok" });
    expect(issued.status).toBe(200);
    const joined = acceptInviteRoute(state, { token: "tok", userId: "zachary@example.test", now: 2 });
    const used = acceptInviteRoute(state, { token: "tok", userId: "zachary@example.test", now: 3 });
    expect(joined.body?.status ?? joined.status).toBe("joined");
    expect(used.body?.status ?? used.status).toBe("used");
  });
  it("forbids a member from issuing invites", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: JC, host: { kind: "server", url: "https://pulsa.gox.ca" } });
    issueInviteRoute(state, { actorId: JC, email: "zachary@example.test", now: 1, token: "tok" });
    acceptInviteRoute(state, { token: "tok", userId: "zachary@example.test", now: 2 });
    expect(issueInviteRoute(state, { actorId: "zachary@example.test", email: "ada@example.test", now: 3, token: "tok-2" })).toEqual({ status: 403 });
  });
  it("refuses a mismatched userId and joins the invited email", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: JC, host: { kind: "server", url: "https://pulsa.gox.ca" } });
    issueInviteRoute(state, { actorId: JC, email: "zachary@example.test", now: 1, token: "tok" });
    expect(acceptInviteRoute(state, { token: "tok", userId: "stranger@example.test", now: 2 })).toEqual({ status: 403 });
    expect(state.signIn.members).toEqual([]);
    expect(state.invites[0]?.usedAt).toBeUndefined();
    const joined = acceptInviteRoute(state, { token: "tok", userId: "zachary@example.test", now: 3 });
    expect(joined.body?.status ?? joined.status).toBe("joined");
    expect(state.signIn.members).toEqual(["zachary@example.test"]);
  });
  it("lets a non-member accept an invite at client scope", () => {
    expect(requiredScope("POST", "/api/org/invites/tok/accept")).toBe("client");
    expect(requiredScope("GET", "/api/org")).toBe("client");
    expect(requiredScope("POST", "/api/org")).toBe("admin");
    expect(requiredScope("POST", "/api/org/invites")).toBe("admin");
    expect(requiredScope("POST", "/api/org/invites/tok/revoke")).toBe("admin");
  });
  it("adds the invited address on accept when they are not yet a member", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: JC, host: { kind: "server", url: "https://pulsa.gox.ca" } });
    issueInviteRoute(state, { actorId: JC, email: "Zachary@Example.test", now: 1, token: "tok" });
    expect(state.signIn.members).toEqual([]);
    const joined = acceptInviteRoute(state, { token: "tok", userId: "zachary@example.test", now: 2 });
    expect(joined.body?.status ?? joined.status).toBe("joined");
    expect(state.signIn.members).toEqual(["zachary@example.test"]);
    expect(signInListWithOpenInvites({
      admins: [],
      members: [],
      invites: state.invites,
      now: 3,
    }).members).toEqual([]);
  });
  it("lets an open invite sign in before accept adds the address", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: JC, host: { kind: "server", url: "https://pulsa.gox.ca" } });
    issueInviteRoute(state, { actorId: JC, email: "zachary@example.test", now: 1, token: "tok" });
    expect(state.signIn.members.includes("zachary@example.test")).toBe(false);
    expect(signInListWithOpenInvites({
      admins: state.signIn.admins,
      members: state.signIn.members,
      invites: state.invites,
      now: 1,
    }).members).toEqual(["zachary@example.test"]);
  });
  it("lets an owner or an admin revoke an open invite", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: JC, host: { kind: "server", url: "https://pulsa.gox.ca" } });
    issueInviteRoute(state, { actorId: JC, email: "zachary@example.test", now: 1, token: "tok" });
    state.signIn.admins = ["Ada@Example.test"];
    expect(revokeInviteRoute(state, { actorId: "zachary@example.test", token: "tok", now: 2 })).toEqual({ status: 403 });
    expect(state.invites[0]?.revokedAt).toBeUndefined();
    const revoked = revokeInviteRoute(state, { actorId: "ada@example.test", token: "tok", now: 3 });
    expect(revoked.status).toBe(200);
    if (revoked.status === 200) expect(revoked.body.status).toBe("revoked");
    expect(state.invites[0]?.revokedAt).toBe(3);
    issueInviteRoute(state, { actorId: JC, email: "ada@example.test", now: 5, token: "tok-2" });
    const byOwner = revokeInviteRoute(state, { actorId: JC.toUpperCase(), token: "tok-2", now: 6 });
    expect(byOwner.status).toBe(200);
    if (byOwner.status === 200) expect(byOwner.body.status).toBe("revoked");
    const again = acceptInviteRoute(state, { token: "tok", userId: "zachary@example.test", now: 4 });
    expect(again.status).toBe(200);
    if (again.status === 200 && again.body) expect(again.body.status).toBe("revoked");
    expect(state.signIn.members).toEqual([]);
  });
  it("reloads the same org from config", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: JC, host: { kind: "server", url: "https://pulsa.gox.ca" } });
    issueInviteRoute(state, { actorId: JC, email: "zachary@example.test", now: 1, token: "tok" });
    acceptInviteRoute(state, { token: "tok", userId: "zachary@example.test", now: 2 });
    const reloaded = parseStoredConfig(JSON.parse(JSON.stringify({
      org: state.org,
      invites: state.invites,
      signIn: state.signIn,
    })));
    expect(reloaded.org).toEqual({ name: "GOX", ownerUserId: JC, host: { kind: "server", url: "https://pulsa.gox.ca" } });
    expect(reloaded.invites).toEqual(state.invites);
    expect(reloaded.signIn?.members).toEqual(["zachary@example.test"]);
    expect(reloaded.org).not.toHaveProperty("members");
  });
  it("assigns the organization only once it is saved", () => {
    const state = emptyOrgState();
    const input = { name: "GOX", ownerUserId: JC, host: { kind: "server" as const, url: "https://pulsa.gox.ca" } };
    expect(() => createOrgRoute(state, input, () => { throw new Error("disk full"); })).toThrow(/disk full/);
    expect(state.org).toBeNull();
    const saved: unknown[] = [];
    createOrgRoute(state, input, (org) => { saved.push(org); expect(state.org).toBeNull(); });
    expect(saved).toEqual([state.org]);
  });
});

describe("invite mail", () => {
  it("reports mailed:true and persists when the hook sends", async () => {
    const state = orgStateWithOwner();
    let persisted = false;
    const base = await serveOrgRoutes({ state, persist: () => { persisted = true; }, mailInvite: async () => true });
    const { status, body } = await postInvite(base);
    expect(status).toBe(200);
    expect(body.mailed).toBe(true);
    expect(persisted).toBe(true);
    expect(state.invites).toHaveLength(1);
    expect(state.invites[0]?.email).toBe("zachary@example.test");
  });

  it("still returns 200 with mailed:false, and keeps the invite, when the hook resolves false", async () => {
    const state = orgStateWithOwner();
    const base = await serveOrgRoutes({ state, mailInvite: async () => false });
    const { status, body } = await postInvite(base);
    expect(status).toBe(200);
    expect(body.mailed).toBe(false);
    expect(state.invites).toHaveLength(1);
  });

  it("still returns 200 with mailed:false, and keeps the invite, when the hook throws", async () => {
    const state = orgStateWithOwner();
    const base = await serveOrgRoutes({ state, mailInvite: async () => { throw new Error("smtp exploded"); } });
    const { status, body } = await postInvite(base);
    expect(status).toBe(200);
    expect(body.mailed).toBe(false);
    expect(state.invites).toHaveLength(1);
  });

  it("reports mailed:false and still keeps the invite with no mailInvite hook at all", async () => {
    const state = orgStateWithOwner();
    const base = await serveOrgRoutes({ state });
    const { status, body } = await postInvite(base);
    expect(status).toBe(200);
    expect(body.mailed).toBe(false);
    expect(state.invites).toHaveLength(1);
  });

  it("passes the request's origin, the invite, and the inviter's email to the hook", async () => {
    const state = orgStateWithOwner();
    const seen: unknown[] = [];
    const base = await serveOrgRoutes({
      state,
      mailInvite: async (input) => { seen.push(input); return true; },
    });
    await postInvite(base, "zachary@example.test");
    expect(seen).toEqual([{ email: "zachary@example.test", token: expect.any(String), inviterEmail: "jc@gox.ca", origin: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/) }]);
  });
});

describe("invite mail text (inviteMailMessage)", () => {
  it("names the inviter and links the public URL when both are known", () => {
    expect(inviteMailMessage({ orgName: "GOX", inviterEmail: "jc@gox.ca", base: "https://pulsa.gox.ca" })).toEqual({
      subject: "You are invited to GOX on Pulsa Bot",
      text: "jc@gox.ca invited you to GOX. Sign in with this address at https://pulsa.gox.ca/pair within 7 days.",
    });
  });

  it("falls back to a generic greeting and drops the link clause when neither is known", () => {
    expect(inviteMailMessage({ orgName: "GOX", base: null })).toEqual({
      subject: "You are invited to GOX on Pulsa Bot",
      text: "You were invited to GOX. Sign in with this address on this server's sign-in page within 7 days.",
    });
  });
});
