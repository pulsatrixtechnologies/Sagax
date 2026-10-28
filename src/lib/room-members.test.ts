import { describe, expect, it } from "vitest";

import { addableRosterBots, nextHumanIds, nextMemberIds, rosterBotChoices } from "./room-members";

const pick = (...ids: string[]) => new Set(ids);

describe("nextMemberIds", () => {
  it("keeps the existing roster in place so the room's lead does not move", () => {
    expect(nextMemberIds(["lead", "second"], pick("lead", "second"), ["second", "lead"])).toEqual(["lead", "second"]);
  });

  it("appends newly ticked bots after the members already in the room", () => {
    expect(nextMemberIds(["lead"], pick("lead", "scout", "archivist"), ["archivist", "lead", "scout"])).toEqual([
      "lead",
      "archivist",
      "scout",
    ]);
  });

  it("drops members that were unticked", () => {
    expect(nextMemberIds(["lead", "second"], pick("second"), ["lead", "second"])).toEqual(["second"]);
  });

  it("ignores ticked ids that are not offered in the list", () => {
    expect(nextMemberIds(["lead"], pick("lead", "ghost"), ["lead"])).toEqual(["lead"]);
  });

  it("returns nothing when every member is unticked", () => {
    expect(nextMemberIds(["lead"], pick(), ["lead"])).toEqual([]);
  });
});

describe("nextHumanIds", () => {
  it("keeps who stays in place and appends people added from the picker", () => {
    expect(nextHumanIds(["pr_ada", "Bob@Example.test"], new Set(["pr_ada", "bob@example.test", "pr_cleo"]), ["pr_cleo"])).toEqual([
      "pr_ada",
      "bob@example.test",
      "pr_cleo",
    ]);
  });

  it("drops people unticked and never lists anyone twice", () => {
    expect(nextHumanIds(["pr_ada", "pr_bob"], new Set(["pr_bob", "pr_cleo"]), ["PR_CLEO", "pr_cleo", "pr_bob"])).toEqual(["pr_bob", "pr_cleo"]);
  });
});

describe("rosterBotChoices", () => {
  const bots = [
    { id: "mine", ownerUserId: "pr_me" },
    { id: "mine-archived", ownerUserId: "PR_ME", hidden: true },
    { id: "theirs", ownerUserId: "pr_ada" },
    { id: "theirs-archived-member", ownerUserId: "pr_ada", hidden: true },
  ];

  it("offers the owner every bot, archived ones only while they are members", () => {
    expect(rosterBotChoices(bots, { memberIds: ["theirs-archived-member"], ownsRoom: true, actorId: "pr_me" }).map((b) => b.id)).toEqual([
      "mine",
      "theirs",
      "theirs-archived-member",
    ]);
  });

  it("offers a member who does not own the room only their own bots (#1240)", () => {
    expect(rosterBotChoices(bots, { memberIds: ["theirs", "mine-archived"], ownsRoom: false, actorId: "pr_me" }).map((b) => b.id)).toEqual([
      "mine",
      "mine-archived",
    ]);
    expect(rosterBotChoices(bots, { memberIds: [], ownsRoom: false, actorId: "" })).toEqual([]);
  });
});

describe("addableRosterBots", () => {
  const bots = [
    { id: "mine", ownerUserId: "pr_me" },
    { id: "mine-in", ownerUserId: "pr_me" },
    { id: "mine-archived", ownerUserId: "pr_me", hidden: true },
    { id: "theirs", ownerUserId: "pr_ada" },
    { id: "theirs-in", ownerUserId: "pr_ada" },
  ];

  it("offers a member only their own bots that are not already in the room (#1240)", () => {
    expect(addableRosterBots(bots, { memberIds: ["mine-in", "theirs-in"], ownsRoom: false, actorId: "pr_me" }).map((b) => b.id)).toEqual(["mine"]);
  });

  it("offers the owner every bot that is not already in the room", () => {
    expect(addableRosterBots(bots, { memberIds: ["mine-in", "theirs-in"], ownsRoom: true, actorId: "pr_me" }).map((b) => b.id)).toEqual([
      "mine",
      "theirs",
    ]);
  });
});
