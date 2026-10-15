import { describe, expect, it } from "vitest";

import { initialState, reducer } from "./store";

describe("Connect apps opened from a bot", () => {
  it("remembers the bot a bot panel opened it on, and forgets it on close", () => {
    const opened = reducer(initialState, { type: "togglePlugins", open: true, botId: "maya" });
    expect(opened).toMatchObject({ pluginsOpen: true, pluginsBotId: "maya" });
    expect(reducer(opened, { type: "togglePlugins", open: false })).toMatchObject({ pluginsOpen: false, pluginsBotId: null });
  });

  it("keeps that bot while it stays open, and opens on no bot from anywhere else", () => {
    const opened = reducer(initialState, { type: "togglePlugins", open: true, botId: "maya" });
    expect(reducer(opened, { type: "togglePlugins", open: true }).pluginsBotId).toBe("maya");
    expect(reducer(initialState, { type: "togglePlugins", open: true }).pluginsBotId).toBeNull();
    const closed = reducer(opened, { type: "togglePlugins", open: false });
    expect(reducer(closed, { type: "togglePlugins", open: true }).pluginsBotId).toBeNull();
  });
});

describe("a routine line in the conversation opens the routine", () => {
  it("opens its bot's panel on Routines and asks for that routine's page once", () => {
    const state = { ...initialState, bots: [{ id: "maya", name: "Maya", hidden: false }] } as unknown as typeof initialState;
    const opened = reducer(state, { type: "openRoutine", botId: "maya", routineId: "r1" });
    expect(opened).toMatchObject({ settingsOpen: true, selectedId: "maya", routineFocus: { botId: "maya", routineId: "r1" } });
    expect(reducer(opened, { type: "routineFocused" }).routineFocus).toBeNull();
    // a bot the person does not have opens nothing
    expect(reducer(state, { type: "openRoutine", botId: "ghost", routineId: "r1" })).toBe(state);
  });
});
