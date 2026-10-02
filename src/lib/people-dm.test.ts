import { describe, expect, it } from "vitest";
import { peopleDmPeer, personInitials } from "./people-dm";
import type { OrgDirectoryPerson } from "./perspicax-org";

describe("peopleDmPeer", () => {
  const people = new Map<string, OrgDirectoryPerson>([["pr_bob", { principalId: "pr_bob", name: "Bob Tremblay", login: "bob", role: "member", disabled: false }]]);
  it("reads a people-only conversation as the other person", () => {
    expect(peopleDmPeer({ peopleDm: true, humanIds: ["pr_alice", "pr_bob"], name: "Alice, Bob" }, "PR_ALICE", people))
      .toMatchObject({ id: "pr_bob", name: "Bob Tremblay", initials: "BT" });
    expect(peopleDmPeer({ humanIds: ["pr_alice", "pr_bob"], name: "Room" }, "pr_alice", people)).toBeNull();
    expect(peopleDmPeer({ peopleDm: true, humanIds: ["pr_alice", "pr_zed"], name: "Alice, Zed" }, "pr_alice", people)?.name).toBe("Alice, Zed");
    expect(personInitials("carol")).toBe("C");
    expect(personInitials("Carol Roy")).toBe("CR");
  });
});
