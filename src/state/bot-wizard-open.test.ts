import { describe, expect, it } from "vitest";

import { initialState, reducer } from "./store";

describe("the bot creation wizard's screen", () => {
  it("opens over New bot, on a new bot or on a bot's own draft, and closes", () => {
    expect(initialState.botWizard).toBeNull();
    const withNewBot = reducer(initialState, { type: "toggleNewBot", open: true });
    const opened = reducer(withNewBot, { type: "openBotWizard" });
    expect(opened.botWizard).toEqual({ botId: null });
    expect(opened.newBotOpen).toBe(false);
    expect(reducer(initialState, { type: "openBotWizard", botId: "bot-1", redo: true }).botWizard).toEqual({ botId: "bot-1", redo: true });
    expect(reducer(opened, { type: "closeBotWizard" }).botWizard).toBeNull();
  });

  it("Connect apps opens over it without closing it (its Tools step)", () => {
    const opened = reducer(initialState, { type: "openBotWizard", botId: "bot-1" });
    const apps = reducer(opened, { type: "togglePlugins", open: true, surface: "apps", botId: "bot-1" });
    expect(apps.pluginsOpen).toBe(true);
    expect(apps.botWizard).toEqual({ botId: "bot-1" });
  });
});
