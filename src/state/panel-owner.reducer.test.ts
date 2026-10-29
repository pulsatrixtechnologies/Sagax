// A split-view section's bot panel (AppState.panelOwner): its pill opens
// that bot's panel without touching the main chat, one panel at a time.
import { describe, expect, it } from "vitest";
import { initialState, reducer, type AppState, type Bot } from "./store";

const bot = (id: string) => ({ id, name: id, threadId: `t-${id}`, title: "", description: "", unread: false, messages: [], color: "green" } as unknown as Bot);
const base: AppState = { ...initialState, bots: [bot("main"), bot("side")], selectedId: "main" };
const owner = { botId: "side", leafId: "pane-1" };

describe("the bot panel opened from a split-view section", () => {
  it("opens that bot's panel and leaves the main chat's selection alone", () => {
    const opened = reducer(base, { type: "toggleSettings", open: true, owner });
    expect(opened).toMatchObject({ settingsOpen: true, selectedId: "main", panelOwner: owner });
  });

  it("is one panel: the main chat's pill takes it back, another section's takes it over", () => {
    const opened = reducer({ ...base, settingsOpen: true }, { type: "toggleSettings", open: true, owner });
    expect(opened.panelOwner).toEqual(owner);
    const main = reducer(opened, { type: "toggleSettings", open: true, owner: null });
    expect(main).toMatchObject({ settingsOpen: true, panelOwner: null, selectedId: "main" });
    const other = reducer(opened, { type: "toggleSettings", open: true, owner: { botId: "main", leafId: "pane-2" } });
    expect(other.panelOwner).toEqual({ botId: "main", leafId: "pane-2" });
  });

  it("keeps its owner across its own tabs, and lets go once it closes", () => {
    const opened = reducer(base, { type: "toggleSettings", open: true, owner });
    const computer = reducer(opened, { type: "toggleComputer", open: true });
    expect(computer).toMatchObject({ computerOpen: true, settingsOpen: false, panelOwner: owner });
    const back = reducer(computer, { type: "toggleSettings", open: true });
    expect(back.panelOwner).toEqual(owner);
    const closed = reducer(reducer(back, { type: "toggleSettings", open: false }), { type: "toggleComputer", open: false });
    expect(closed.panelOwner).toBeNull();
    // another panel in the slot closes it too
    expect(reducer(opened, { type: "openPersonPanel", personId: "pr_x" }).panelOwner).toBeNull();
  });

  it("gives the panel back to the main chat for a link that names another bot", () => {
    const opened = reducer(base, { type: "toggleSettings", open: true, owner });
    const linked = reducer(opened, { type: "toggleSettings", open: true, botId: "main" });
    expect(linked).toMatchObject({ panelOwner: null, selectedId: "main", settingsOpen: true });
    const same = reducer(opened, { type: "toggleSettings", open: true, botId: "side" });
    expect(same).toMatchObject({ panelOwner: owner, selectedId: "main" });
  });
});
