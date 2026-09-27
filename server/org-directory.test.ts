import { describe, expect, it } from "vitest";
import { INVITE_TTL_MS, acceptInvite, inviteStatus, roleOf, type OrgInvite } from "./org-directory.ts";

const invite = (over: Partial<OrgInvite> = {}): OrgInvite => ({
  token: "tok",
  email: "zachary@example.test",
  createdAt: 0,
  expiresAt: INVITE_TTL_MS,
  ...over,
});

describe("inviteStatus", () => {
  it("treats the exact expiry instant as expired", () => {
    expect(inviteStatus(invite(), INVITE_TTL_MS)).toBe("expired");
  });
  it("reports used even after expiry", () => {
    expect(inviteStatus(invite({ usedAt: 10 }), INVITE_TTL_MS + 1)).toBe("used");
  });
  it("reports revoked above used and expired", () => {
    expect(inviteStatus(invite({ usedAt: 10, revokedAt: 11 }), 12)).toBe("revoked");
  });
});

describe("acceptInvite", () => {
  it("marks a token used once and refuses the second presentation", () => {
    const first = acceptInvite(invite(), 1_000);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = acceptInvite(first.invite, 2_000);
    expect(second).toEqual({ ok: false, status: "used" });
  });
});

describe("roleOf", () => {
  it("gives the creator owner and keeps admins distinct from members", () => {
    const lists = { ownerUserId: "jc", admins: ["jc", "ada@example.test"], members: ["zachary@example.test"] };
    expect(roleOf({ ...lists, userId: "jc" })).toBe("owner");
    expect(roleOf({ ...lists, userId: "ada@example.test" })).toBe("admin");
    expect(roleOf({ ...lists, userId: "zachary@example.test" })).toBe("member");
    expect(roleOf({ ...lists, userId: "stranger" })).toBeNull();
  });
});
