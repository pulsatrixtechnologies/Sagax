import { describe, expect, it } from "vitest";
import { initialState, reducer, type Bot, type Group } from "@/state/store";

import { groupMemberBots } from "./group-members";
import { mainConversation } from "./main-view";
import { buildTeamMapSections } from "./team-map";

const bot = (id: string, name = id): Bot => ({
  id, threadId: `t-${id}`, name, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "fake", model: "test" }, messages: [],
});

describe("groupMemberBots: every bot in a room, as each person in it sees it", () => {
  const room = {
    memberIds: ["scout", "ember", "yuki"],
    memberProfiles: [
      { id: "scout", name: "Scout", title: "Lead", color: "blue" as const, avatarUrl: null, mascotLook: { character: "shape" } as never },
      { id: "ember", name: "Ember", title: "", color: "orange" as const, avatarUrl: "/api/attachments/ember.png" },
      { id: "yuki", name: "Yuki", title: "", color: "pink" as const, avatarUrl: null },
    ],
  };

  it("counts and names all three bots for a person who owns only one of them", () => {
    const members = groupMemberBots(room, [bot("yuki", "Yuki (mine)")]);
    expect(members.map((member) => member.name)).toEqual(["Scout", "Ember", "Yuki (mine)"]);
    expect(members).toHaveLength(3);
  });

  it("keeps the look of someone else's bot and marks it as not openable", () => {
    const [scout, ember, yuki] = groupMemberBots(room, [bot("yuki")]);
    expect(scout).toMatchObject({ name: "Scout", title: "Lead", color: "blue", mascotLook: { character: "shape" }, publicProfile: true });
    expect(ember).toMatchObject({ avatarUrl: "/api/attachments/ember.png", publicProfile: true });
    expect(yuki!.publicProfile).toBeUndefined();
    // nothing of the bot beyond its public identity
    expect(scout!.messages).toEqual([]);
    expect(scout!.threadId).toBe("");
  });

  it("prefers the viewer's own copy of a bot, and leaves out a member nobody describes", () => {
    expect(groupMemberBots({ memberIds: ["gone", "yuki"] }, [bot("yuki")]).map((member) => member.id)).toEqual(["yuki"]);
  });
});

describe("mainConversation: the empty state only when there is no bot and no group at all", () => {
  const groups = [{ id: "dm", dm: true }, { id: "room" }];

  it("opens a group for a person who owns no bot and was added to one", () => {
    expect(mainConversation([], groups, "")).toEqual({ group: groups[1] });
  });

  it("shows nothing (the empty state) only with no bot and no group", () => {
    expect(mainConversation([], [], "")).toEqual({});
  });

  it("keeps the selected conversation, else the first bot", () => {
    const bots = [bot("a"), bot("b")];
    expect(mainConversation(bots, groups, "room").group?.id).toBe("room");
    expect(mainConversation(bots, groups, "b").bot?.id).toBe("b");
    expect(mainConversation(bots, groups, "").bot?.id).toBe("a");
  });
});

describe("sidebar teams: a room shows with no bot in the list", () => {
  it("keeps General for an unsectioned room when the viewer owns no bot", () => {
    expect(buildTeamMapSections([], [])).toEqual([]);
    expect(buildTeamMapSections([], [], { general: true })).toEqual([{ key: "", name: "General", chiefs: [], members: [] }]);
  });
});

describe("hydrate: a viewer with only a group lands on it", () => {
  it("selects the first group when the snapshot holds no bot", () => {
    const room = { id: "room", threadId: "t-room", name: "Planning", memberIds: ["x"], defaultResponder: { kind: "everyone" }, bulletin: "", unread: false, createdAt: 1, messages: [] } as unknown as Group;
    const next = reducer(initialState, { type: "hydrate", bots: [], groups: [room], sections: [], computerControl: {} });
    expect(next.selectedId).toBe("room");
    expect(reducer(initialState, { type: "hydrate", bots: [], groups: [], sections: [], computerControl: {} }).selectedId).toBe("");
  });
});
