import { describe, expect, it } from "vitest";
import { parseStoredConfig } from "./config.ts";
import { ownerUserIdAfterProfileEmail, roleOf, signInListWithOpenInvites } from "./org-directory.ts";
import { acceptInviteRoute, createOrgRoute, getOrgRoute, issueInviteRoute, revokeInviteRoute, type OrgState } from "./org-routes.ts";
import { requiredScope } from "./request-auth.ts";

function emptyOrgState(): OrgState {
  return { org: null, invites: [], signIn: { admins: [], members: [] } };
}

describe("org routes", () => {
  it("returns 404 when there is no organization", () => {
    expect(getOrgRoute(emptyOrgState())).toEqual({ status: 404 });
  });
  it("returns the stored org and people from signIn plus the owner", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: "jc", host: { kind: "this-computer" } });
    state.signIn.admins = ["ada@example.test"];
    state.signIn.members = ["zachary@example.test"];
    expect(getOrgRoute(state)).toEqual({
      status: 200,
      body: {
        org: { name: "GOX", ownerUserId: "jc", host: { kind: "this-computer" } },
        people: [
          { id: "jc", role: "owner" },
          { id: "ada@example.test", role: "admin" },
          { id: "zachary@example.test", role: "member" },
        ],
        pendingInvites: [],
      },
    });
  });
  it("lists an open invite without treating it as a member", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: "jc", host: { kind: "this-computer" } });
    issueInviteRoute(state, { actorId: "jc", email: "zachary@example.test", now: 1_000, token: "tok" });
    const body = getOrgRoute(state, 2_000).body;
    expect(body?.people).toEqual([{ id: "jc", role: "owner" }]);
    expect(body?.pendingInvites).toEqual([{ email: "zachary@example.test", expiresAt: 1_000 + 7 * 24 * 60 * 60 * 1000 }]);
  });
  it("joins once and reports already-member the second time", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: "jc", host: { kind: "this-computer" } });
    const issued = issueInviteRoute(state, { actorId: "jc", email: "zachary@example.test", now: 1, token: "tok" });
    expect(issued.status).toBe(200);
    const joined = acceptInviteRoute(state, { token: "tok", userId: "zachary@example.test", now: 2 });
    const used = acceptInviteRoute(state, { token: "tok", userId: "zachary@example.test", now: 3 });
    expect(joined.body?.status ?? joined.status).toBe("joined");
    expect(used.body?.status ?? used.status).toBe("used");
  });
  it("forbids a member from issuing invites", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: "jc", host: { kind: "this-computer" } });
    issueInviteRoute(state, { actorId: "jc", email: "zachary@example.test", now: 1, token: "tok" });
    acceptInviteRoute(state, { token: "tok", userId: "zachary@example.test", now: 2 });
    expect(issueInviteRoute(state, { actorId: "zachary@example.test", email: "ada@example.test", now: 3, token: "tok-2" })).toEqual({ status: 403 });
  });
  it("refuses a mismatched userId and joins the invited email", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: "jc", host: { kind: "this-computer" } });
    issueInviteRoute(state, { actorId: "jc", email: "zachary@example.test", now: 1, token: "tok" });
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
    createOrgRoute(state, { name: "GOX", ownerUserId: "jc", host: { kind: "this-computer" } });
    issueInviteRoute(state, { actorId: "jc", email: "Zachary@Example.test", now: 1, token: "tok" });
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
    createOrgRoute(state, { name: "GOX", ownerUserId: "jc", host: { kind: "this-computer" } });
    issueInviteRoute(state, { actorId: "jc", email: "zachary@example.test", now: 1, token: "tok" });
    expect(state.signIn.members.includes("zachary@example.test")).toBe(false);
    expect(signInListWithOpenInvites({
      admins: state.signIn.admins,
      members: state.signIn.members,
      invites: state.invites,
      now: 1,
    }).members).toEqual(["zachary@example.test"]);
  });
  it("keeps the creator as owner after a profile email replaces local-owner", () => {
    expect(ownerUserIdAfterProfileEmail({
      ownerUserId: "local-owner",
      previousEmail: "",
      nextEmail: "Ada@Example.test",
    })).toBe("ada@example.test");
    expect(roleOf({
      ownerUserId: "ada@example.test",
      admins: [],
      members: [],
      userId: "Ada@Example.test",
    })).toBe("owner");
    expect(ownerUserIdAfterProfileEmail({
      ownerUserId: "ada@example.test",
      previousEmail: "Ada@Example.test",
      nextEmail: "ada@example.test",
    })).toBe("ada@example.test");
  });
  it("lets an owner or an admin revoke an open invite", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: "jc", host: { kind: "this-computer" } });
    issueInviteRoute(state, { actorId: "jc", email: "zachary@example.test", now: 1, token: "tok" });
    state.signIn.admins = ["Ada@Example.test"];
    expect(revokeInviteRoute(state, { actorId: "zachary@example.test", token: "tok", now: 2 })).toEqual({ status: 403 });
    expect(state.invites[0]?.revokedAt).toBeUndefined();
    const revoked = revokeInviteRoute(state, { actorId: "ada@example.test", token: "tok", now: 3 });
    expect(revoked.status).toBe(200);
    if (revoked.status === 200) expect(revoked.body.status).toBe("revoked");
    expect(state.invites[0]?.revokedAt).toBe(3);
    issueInviteRoute(state, { actorId: "jc", email: "ada@example.test", now: 5, token: "tok-2" });
    const byOwner = revokeInviteRoute(state, { actorId: "JC", token: "tok-2", now: 6 });
    expect(byOwner.status).toBe(200);
    if (byOwner.status === 200) expect(byOwner.body.status).toBe("revoked");
    const again = acceptInviteRoute(state, { token: "tok", userId: "zachary@example.test", now: 4 });
    expect(again.status).toBe(200);
    if (again.status === 200 && again.body) expect(again.body.status).toBe("revoked");
    expect(state.signIn.members).toEqual([]);
  });
  it("reloads the same org from config", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: "jc", host: { kind: "this-computer" } });
    issueInviteRoute(state, { actorId: "jc", email: "zachary@example.test", now: 1, token: "tok" });
    acceptInviteRoute(state, { token: "tok", userId: "zachary@example.test", now: 2 });
    const reloaded = parseStoredConfig(JSON.parse(JSON.stringify({
      org: state.org,
      invites: state.invites,
      signIn: state.signIn,
    })));
    expect(reloaded.org).toEqual({ name: "GOX", ownerUserId: "jc", host: { kind: "this-computer" } });
    expect(reloaded.invites).toEqual(state.invites);
    expect(reloaded.signIn?.members).toEqual(["zachary@example.test"]);
    expect(reloaded.org).not.toHaveProperty("members");
  });
});
