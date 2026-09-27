import { describe, expect, it } from "vitest";
import { INVITE_TTL_MS } from "./org-directory.ts";
import { createOrg, issueInvite, memberListsAfterAccept } from "./org-record.ts";

describe("org record", () => {
  it("records the creator as the only owner on this computer", () => {
    expect(createOrg({ name: "GOX", ownerUserId: "jc", host: { kind: "this-computer" } })).toEqual({
      name: "GOX",
      ownerUserId: "jc",
      host: { kind: "this-computer" },
    });
  });
  it("rejects a blank name", () => {
    expect(() => createOrg({ name: "  ", ownerUserId: "jc", host: { kind: "this-computer" } })).toThrow(/name/);
  });
  it("issues a single-use invite that expires in 7 days", () => {
    expect(issueInvite({ email: "zachary@example.test", now: 50, token: "tok" }).expiresAt).toBe(50 + INVITE_TTL_MS);
  });
  it("returns an existing member without a second row", () => {
    expect(memberListsAfterAccept({ members: ["zachary@example.test"], email: "zachary@example.test" })).toEqual({
      members: ["zachary@example.test"],
      alreadyMember: true,
    });
  });
});
