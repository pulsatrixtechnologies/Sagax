// The main column never falls back on a conversation the sidebar does not
// list (bug 2026-10-15: an empty sidebar, yet the page showed a direct
// conversation with a person the viewer had closed, composer and all).
import { describe, expect, it } from "vitest";
import { mainConversation } from "@/lib/main-view";
import { initialState, reducer, type AppState, type Bot, type Group } from "./store";

const me = "pr_me";
const greg = "pr_greg";
const dmWithGreg = {
  id: "dm-greg", threadId: "t-dm-greg", name: "Gregory Jeanne", memberIds: [], humanIds: [me, greg], peopleDm: true,
  defaultResponder: { kind: "everyone" }, bulletin: "", unread: false, createdAt: 1, messages: [],
} as unknown as Group;
const room = { ...dmWithGreg, id: "room", threadId: "t-room", name: "Planning", humanIds: [me], peopleDm: undefined } as unknown as Group;
const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `t-${id}`, name: id, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "fake", model: "test" }, messages: [], ...extra,
});
const closedGreg = new Set([`person:${greg}`]);
const hydrate = (state: AppState, bots: Bot[], groups: Group[], resumeId?: string) =>
  reducer(state, { type: "hydrate", bots, groups, sections: [], computerControl: {}, ...(resumeId ? { resumeId } : {}) });
const withHidden = (keys: Set<string>): AppState => ({ ...initialState, sidebarHiddenKeys: keys });
const shown = (state: AppState) => mainConversation(state.bots, state.groups, state.selectedId, state.sidebarHiddenKeys);

describe("launch: a closed direct conversation is never restored nor fallen back on", () => {
  it("leaves nothing selected and the empty state when the only conversation is closed", () => {
    const next = hydrate(withHidden(closedGreg), [], [dmWithGreg], dmWithGreg.id);
    expect(next.selectedId).toBe("");
    expect(shown(next)).toEqual({});
  });

  it("does not fall back on it either when nothing was remembered", () => {
    const next = hydrate(withHidden(closedGreg), [], [dmWithGreg]);
    expect(next.selectedId).toBe("");
    expect(shown(next)).toEqual({});
  });

  it("falls back on a listed room instead", () => {
    const next = hydrate(withHidden(closedGreg), [], [dmWithGreg, room], dmWithGreg.id);
    expect(next.selectedId).toBe("room");
    expect(shown(next).group?.id).toBe("room");
  });

  it("skips bots the person hid and bots the server hides", () => {
    const next = hydrate(withHidden(new Set(["bot:a"])), [bot("a"), bot("b", { hidden: true }), bot("c")], []);
    expect(next.selectedId).toBe("c");
    expect(hydrate(withHidden(new Set(["bot:a"])), [bot("a"), bot("b", { hidden: true })], []).selectedId).toBe("");
  });

  it("still restores an open direct conversation", () => {
    expect(hydrate(initialState, [], [dmWithGreg], dmWithGreg.id).selectedId).toBe(dmWithGreg.id);
  });
});

describe("the main column with nothing selected", () => {
  it("does not render a closed direct conversation, a hidden bot or a bot's own chat group", () => {
    const dmGroup = { ...room, id: "bot-dm", dm: true } as Group;
    expect(mainConversation([], [dmWithGreg, dmGroup], "", closedGreg)).toEqual({});
    expect(mainConversation([bot("a", { hidden: true })], [], "", new Set())).toEqual({});
    expect(mainConversation([], [], "gone", new Set())).toEqual({});
  });

  it("still renders an explicit pick of a hidden entry (search, person panel)", () => {
    expect(mainConversation([], [dmWithGreg], dmWithGreg.id, closedGreg).group?.id).toBe(dmWithGreg.id);
  });
});

describe("the open conversation disappears", () => {
  it("empties the page when the open direct conversation is deleted and nothing else is listed", () => {
    const open = hydrate(initialState, [], [dmWithGreg], dmWithGreg.id);
    expect(open.selectedId).toBe(dmWithGreg.id);
    const next = reducer(open, { type: "groupDeleted", groupId: dmWithGreg.id });
    expect(next.selectedId).toBe("");
    expect(shown(next)).toEqual({});
  });

  it("empties the page when the person closes it (or the closed list arrives from another device)", () => {
    const open = hydrate(initialState, [], [dmWithGreg], dmWithGreg.id);
    const next = reducer(open, { type: "sidebarHidden", keys: closedGreg });
    expect(next.selectedId).toBe("");
    expect(shown(next)).toEqual({});
  });

  it("moves to the next listed conversation when there is one", () => {
    const open = hydrate(initialState, [], [dmWithGreg, room], dmWithGreg.id);
    expect(reducer(open, { type: "sidebarHidden", keys: closedGreg }).selectedId).toBe("room");
  });

  it("keeps an explicit pick of a hidden entry when another entry is hidden", () => {
    const picked = reducer(hydrate(withHidden(closedGreg), [], [dmWithGreg, room]), { type: "select", id: dmWithGreg.id });
    expect(picked.selectedId).toBe(dmWithGreg.id);
    expect(reducer(picked, { type: "sidebarHidden", keys: new Set([...closedGreg, "group:room"]) }).selectedId).toBe(dmWithGreg.id);
  });

  it("falls back past a hidden bot when the open bot is deleted", () => {
    const open = reducer(hydrate(withHidden(new Set(["bot:a"])), [bot("a"), bot("b")], []), { type: "select", id: "b" });
    expect(reducer(open, { type: "deleteBot", botId: "b" }).selectedId).toBe("");
  });
});
