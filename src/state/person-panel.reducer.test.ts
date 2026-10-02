import { describe, expect, it } from "vitest";
import { initialState, reducer, type AppState, type Bot, type Group } from "./store";

const bot = { id: "maya", name: "Maya", threadId: "t-maya", title: "", description: "", unread: false, messages: [], color: "green" } as unknown as Bot;
const dm = { id: "dm", name: "dm", threadId: "t-dm", peopleDm: true, humanIds: ["pr_me", "pr_ada"], memberIds: [], unread: false, messages: [], createdAt: 1, bulletin: "" } as unknown as Group;
const room = { ...dm, id: "ops", name: "Ops", threadId: "t-ops", peopleDm: false, humanIds: ["pr_me", "pr_ada"] } as unknown as Group;
const base: AppState = { ...initialState, bots: [bot], groups: [dm, room], config: { ...initialState.config, viewer: { principalId: "pr_me" } } as AppState["config"] };

describe("person panel in the right slot", () => {
  it("opens for a person and closes bot settings, the computer and app settings", () => {
    const opened = reducer({ ...base, settingsOpen: true, computerOpen: true, appSettingsOpen: true }, { type: "openPersonPanel", personId: "pr_ada" });
    expect(opened).toMatchObject({ personPanelId: "pr_ada", settingsOpen: false, computerOpen: false, appSettingsOpen: false });
    expect(reducer(opened, { type: "openPersonPanel", personId: null }).personPanelId).toBeNull();
  });

  it("gives way to bot settings or the computer when they open", () => {
    const opened = reducer(base, { type: "openPersonPanel", personId: "pr_ada" });
    expect(reducer(opened, { type: "toggleSettings", open: true }).personPanelId).toBeNull();
    expect(reducer(opened, { type: "toggleComputer", open: true }).personPanelId).toBeNull();
  });

  it("follows the selection like the bot panel: a person's conversation shows them, a bot its own panel", () => {
    const withBotPanel = { ...base, settingsOpen: true };
    expect(reducer(withBotPanel, { type: "select", id: "dm" })).toMatchObject({ personPanelId: "pr_ada", settingsOpen: false });
    const withPerson = reducer(base, { type: "openPersonPanel", personId: "pr_ada" });
    expect(reducer(withPerson, { type: "select", id: "maya" })).toMatchObject({ personPanelId: null, settingsOpen: true });
    expect(reducer(withPerson, { type: "select", id: "ops" })).toMatchObject({ personPanelId: null, settingsOpen: true });
    // no panel open: selecting opens nothing
    expect(reducer(base, { type: "select", id: "dm" })).toMatchObject({ personPanelId: null, settingsOpen: false });
  });
});
