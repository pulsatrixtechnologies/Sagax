import { describe, expect, it } from "vitest";

import { groupHumanLabel, groupPeopleCandidates, showPrivateConversationHint } from "./private-threads";

const ALICE = "pr_00000000-0000-4000-8000-000000000001";
const BOB = "pr_00000000-0000-4000-8000-000000000002";
const CAROL = "pr_00000000-0000-4000-8000-000000000003";
const person = (principalId: string, name: string, login: string, disabled = false) => ({ principalId, name, login, role: "member" as const, disabled });

describe("showPrivateConversationHint", () => {
  it("never shows on a solo server", () => {
    expect(showPrivateConversationHint({ org: false, viewerId: BOB, bot: { ownerUserId: ALICE } })).toBe(false);
  });
  it("shows for a bot someone else owns", () => {
    expect(showPrivateConversationHint({ org: true, viewerId: BOB, bot: { ownerUserId: ALICE } })).toBe(true);
  });
  it("shows to the owner of a shared bot, not of an unshared one", () => {
    expect(showPrivateConversationHint({ org: true, viewerId: ALICE, bot: { ownerUserId: ALICE, grants: [{}] } })).toBe(true);
    expect(showPrivateConversationHint({ org: true, viewerId: ALICE, bot: { ownerUserId: ALICE, directGrants: [BOB] } })).toBe(true);
    expect(showPrivateConversationHint({ org: true, viewerId: ALICE.toUpperCase(), bot: { ownerUserId: ALICE, grants: [] } })).toBe(false);
  });
});

describe("groupHumanLabel", () => {
  const directory = { people: [person(ALICE, "Alice", "alice"), person(BOB, "", "bob")], teams: [{ id: "T1", name: "Support" }] };
  it("names directory people and teams", () => {
    expect(groupHumanLabel(ALICE.toUpperCase(), directory)).toBe("Alice");
    expect(groupHumanLabel(`user:${BOB}`, directory)).toBe("bob");
    expect(groupHumanLabel("team:T1", directory)).toBe("Support");
  });
  it("falls back to the raw entry", () => {
    expect(groupHumanLabel(CAROL, directory)).toBe(CAROL);
    expect(groupHumanLabel("ada@example.test", null)).toBe("ada@example.test");
  });
});

describe("groupPeopleCandidates", () => {
  const people = [person(ALICE, "Alice", "alice"), person(BOB, "Bob", "bob"), person(CAROL, "Carol", "carol", true)];
  it("leaves out people already listed and disabled people", () => {
    expect(groupPeopleCandidates(people, { taken: [ALICE.toUpperCase()], query: "" }).map((p) => p.login)).toEqual(["bob"]);
  });
  it("matches the search", () => {
    expect(groupPeopleCandidates(people, { taken: [], query: "ALI" }).map((p) => p.login)).toEqual(["alice"]);
    expect(groupPeopleCandidates(people, { taken: [], query: "", limit: 1 })).toHaveLength(1);
  });
});
