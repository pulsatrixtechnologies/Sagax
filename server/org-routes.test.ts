import { describe, expect, it } from "vitest";
import { parseStoredConfig } from "./config.ts";
import { acceptInviteRoute, createOrgRoute, getOrgRoute, issueInviteRoute, type OrgState } from "./org-routes.ts";
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
      },
    });
  });
  it("joins once and reports already-member the second time", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: "jc", host: { kind: "this-computer" } });
    const issued = issueInviteRoute(state, { actorId: "jc", email: "zachary@example.test", now: 1, token: "tok" });
    expect(issued.status).toBe(200);
    expect(acceptInviteRoute(state, { token: "tok", userId: "zachary@example.test", now: 2 }).body.status).toBe("joined");
    expect(acceptInviteRoute(state, { token: "tok", userId: "zachary@example.test", now: 3 }).body.status).toBe("used");
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
    expect(acceptInviteRoute(state, { token: "tok", userId: "zachary@example.test", now: 3 }).body.status).toBe("joined");
    expect(state.signIn.members).toEqual(["zachary@example.test"]);
  });
  it("lets a non-member accept an invite at client scope", () => {
    expect(requiredScope("POST", "/api/org/invites/tok/accept")).toBe("client");
    expect(requiredScope("GET", "/api/org")).toBe("client");
    expect(requiredScope("POST", "/api/org")).toBe("admin");
    expect(requiredScope("POST", "/api/org/invites")).toBe("admin");
  });
  it("reloads the same org from config", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "GOX", ownerUserId: "jc", host: { kind: "this-computer" } });
    issueInviteRoute(state, { actorId: "jc", email: "zachary@example.test", now: 1, token: "tok" });
    acceptInviteRoute(state, { token: "tok", userId: "zachary@example.test", now: 2 });
    const reloaded = parseStoredConfig({
      org: state.org,
      invites: state.invites,
      signIn: state.signIn,
    });
    expect(reloaded.org).toEqual({ name: "GOX", ownerUserId: "jc", host: { kind: "this-computer" } });
    expect(reloaded.invites).toEqual(state.invites);
    expect(reloaded.signIn?.members).toEqual(["zachary@example.test"]);
    expect(reloaded.org).not.toHaveProperty("members");
  });
});
