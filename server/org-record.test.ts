import { describe, expect, it } from "vitest";
import { INVITE_TTL_MS } from "./org-directory.ts";
import { createOrg, issueInvite, memberListsAfterAccept } from "./org-record.ts";

describe("org record", () => {
  it("records the creator as the only owner on a server", () => {
    expect(createOrg({ name: "GOX", ownerUserId: "jc", host: { kind: "server", url: "https://pulsa.gox.ca" } })).toEqual({
      name: "GOX",
      ownerUserId: "jc",
      host: { kind: "server", url: "https://pulsa.gox.ca" },
    });
  });
  it("rejects a blank name", () => {
    expect(() => createOrg({ name: "  ", ownerUserId: "jc", host: { kind: "server", url: "https://pulsa.gox.ca" } })).toThrow(/name/);
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
  it("requires a server address for a new organization", () => {
    expect(() => createOrg({ name: "GOX", ownerUserId: "pr_x", host: { kind: "this-computer" } })).toThrow(/server address/);
    expect(() => createOrg({ name: "GOX", ownerUserId: "pr_x", host: { kind: "server", url: "http://10.0.0.5:8799" } })).toThrow(/server address/);
    expect(createOrg({ name: "GOX", ownerUserId: "pr_x", host: { kind: "server", url: "http://localhost:8080" } }).host)
      .toEqual({ kind: "server", url: "http://localhost:8080" });
    expect(createOrg({ name: "GOX", ownerUserId: "pr_x", host: { kind: "server", url: "http://gox-fs01.tail1234.ts.net:8799" } }).host)
      .toEqual({ kind: "server", url: "http://gox-fs01.tail1234.ts.net:8799" });
  });
  it("keeps the principal id as given", () => {
    expect(createOrg({ name: "GOX", ownerUserId: "pr_00000000-0000-4000-8000-000000000000", host: { kind: "server", url: "https://a.b" } }).ownerUserId)
      .toBe("pr_00000000-0000-4000-8000-000000000000");
  });
});
