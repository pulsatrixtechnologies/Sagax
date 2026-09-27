import { describe, expect, it } from "vitest";
import { acceptInviteRoute, createOrgRoute, issueInviteRoute, type OrgState } from "./org-routes.ts";

function emptyOrgState(): OrgState {
  return { org: null, invites: [], signIn: { admins: [], members: [] } };
}

describe("org routes", () => {
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
});
