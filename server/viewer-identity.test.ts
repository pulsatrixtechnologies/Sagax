import { describe, expect, it } from "vitest";

import { configForViewer, displayNameFromEmail, sessionIsOperator, type ViewerIdentity } from "./viewer-identity.ts";

const LOCAL = "pr_00000000-0000-4000-8000-000000000001";
const ZARA = "pr_00000000-0000-4000-8000-000000000002";

describe("viewer identity", () => {
  it("names a person by their email's local part", () => {
    expect(displayNameFromEmail("zara.q@example.test")).toBe("zara.q");
    expect(displayNameFromEmail("")).toBe("");
    expect(displayNameFromEmail(undefined)).toBe("");
  });

  it("treats the operator's principal, email and paired devices as the operator, and anyone else as themselves", () => {
    const base = { localPrincipalId: LOCAL, operatorEmail: "jc@gox.ca", admin: false, orgExists: true };
    expect(sessionIsOperator({ ...base, principalId: LOCAL })).toBe(true);
    expect(sessionIsOperator({ ...base, principalId: ZARA, admin: true })).toBe(false);
    expect(sessionIsOperator({ ...base, email: "JC@gox.ca" })).toBe(true);
    expect(sessionIsOperator({ ...base, email: "zara@example.test" })).toBe(false);
    // devices paired before principals
    expect(sessionIsOperator({ ...base, admin: true })).toBe(true);
    expect(sessionIsOperator({ ...base })).toBe(false);
    expect(sessionIsOperator({ ...base, orgExists: false })).toBe(true);
  });

  it("gives a member their own profile and keeps the operator's for the operator", () => {
    const status = { profile: { name: "JC", email: "jc@gox.ca", aboutMe: "private", avatarUrl: "/api/profile/avatar.png" }, other: 1 };
    const member: ViewerIdentity = { operator: false, principalId: ZARA, email: "zara@example.test", name: "zara", role: "member", canCreateBots: true, operatorName: "JC" };
    expect(configForViewer(status, member)).toEqual({ ...status, profile: { name: "zara", email: "zara@example.test", aboutMe: "", avatarUrl: "" }, viewer: member });
    const operator: ViewerIdentity = { operator: true, principalId: LOCAL, email: "jc@gox.ca", name: "JC", role: "owner", canCreateBots: true };
    expect(configForViewer(status, operator)).toEqual({ ...status, viewer: operator });
    expect(configForViewer(status, null)).toBe(status);
  });
});
