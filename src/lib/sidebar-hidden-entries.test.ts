import { describe, expect, it } from "vitest";
import type { Bot, Group } from "@/state/store";
import { hiddenKey } from "./sidebar-hidden";
import { groupHiddenKey, hiddenSidebarRows, withoutHiddenEntries } from "./sidebar-hidden-entries";

const bot = (id: string, name: string, extra: Partial<Bot> = {}) => ({ id, name, threadId: `t-${id}`, title: "", description: "", unread: false, messages: [], ...extra }) as unknown as Bot;
const group = (id: string, name: string, extra: Partial<Group> = {}) => ({ id, name, threadId: `t-${id}`, memberIds: [], unread: false, messages: [], createdAt: 1, bulletin: "", defaultResponder: { kind: "lead" }, ...extra }) as unknown as Group;

const ME = "pr_me";
const bots = [bot("maya", "Maya"), bot("rex", "Rex"), bot("old", "Old", { hidden: true })];
const groups = [
  group("ops", "Ops"),
  group("dm-ada", "dm", { peopleDm: true, humanIds: [ME, "pr_ada"] }),
  group("dm-bo", "dm", { peopleDm: true, humanIds: ["pr_bo", ME] }),
];

describe("hidden sidebar entries", () => {
  it("keys a direct conversation by the other person", () => {
    expect(groupHiddenKey(groups[1]!, ME)).toBe("person:pr_ada");
    expect(groupHiddenKey(groups[0]!, ME)).toBe("group:ops");
  });

  it("leaves hidden bots, groups and people out of the lists, and only them", () => {
    const hidden = new Set([hiddenKey("bot", "maya"), hiddenKey("group", "ops"), hiddenKey("person", "pr_ada")]);
    const out = withoutHiddenEntries(bots, groups, hidden, ME);
    expect(out.bots.map((b) => b.id)).toEqual(["rex", "old"]);
    expect(out.groups.map((g) => g.id)).toEqual(["dm-bo"]);
    expect(withoutHiddenEntries(bots, groups, new Set(), ME).groups).toHaveLength(3);
  });

  it("names each hidden entry that still exists, a person from the directory", () => {
    const rows = hiddenSidebarRows(
      [
        { kind: "bot", id: "maya", at: 1 },
        { kind: "bot", id: "old", at: 1 },
        { kind: "bot", id: "gone", at: 1 },
        { kind: "group", id: "ops", at: 1 },
        { kind: "person", id: "pr_ada", at: 1 },
      ],
      { bots, groups, viewerId: ME, people: new Map([["pr_ada", { name: "Ada Example", login: "ada" }]]) },
    );
    expect(rows.map((row) => [row.key, row.name])).toEqual([
      ["person:pr_ada", "Ada Example"],
      ["bot:maya", "Maya"],
      ["group:ops", "Ops"],
    ]);
  });
});
