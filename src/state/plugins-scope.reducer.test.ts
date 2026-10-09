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
