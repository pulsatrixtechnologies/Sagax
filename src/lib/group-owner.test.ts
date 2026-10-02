import { describe, expect, it } from "vitest";

import type { ConfigStatus } from "@/state/store";
import { viewerMayDeleteGroup, viewerOwnsGroup } from "./group-owner";

const config = (principalId: string, role: "owner" | "admin" | "member", email = "") =>
  ({ viewer: { operator: false, principalId, email, name: "", role, canCreateBots: true } }) as unknown as ConfigStatus;

describe("group owner on the client", () => {
  it("changes nothing on a solo server", () => {
    expect(viewerOwnsGroup({}, config("pr_a", "member"))).toBe(true);
    expect(viewerMayDeleteGroup({}, null)).toBe(true);
  });

  it("lets only the owner edit, and an admin delete", () => {
    expect(viewerOwnsGroup({ ownerId: "pr_a" }, config("PR_A", "member"))).toBe(true);
    expect(viewerOwnsGroup({ ownerId: "pr_a" }, config("pr_b", "admin"))).toBe(false);
    expect(viewerMayDeleteGroup({ ownerId: "pr_a" }, config("pr_b", "admin"))).toBe(true);
    expect(viewerMayDeleteGroup({ ownerId: "pr_a" }, config("pr_b", "member"))).toBe(false);
    expect(viewerOwnsGroup({ ownerId: "b@example.test" }, config("pr_b", "member", "b@example.test"))).toBe(true);
  });

  it("gives an ownerless group to its admins", () => {
    expect(viewerOwnsGroup({ ownerId: null }, config("pr_b", "admin"))).toBe(true);
    expect(viewerOwnsGroup({ ownerId: null }, config("pr_b", "member"))).toBe(false);
  });
});
