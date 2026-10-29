import { describe, expect, it } from "vitest";

import { closeBotCatalog, initialState, openBotCatalog, reducer } from "./store";

describe("Browse Bots links (2026-10-29: Connect apps' Bots tab)", () => {
  it("opens Connect apps on its Bots tab, not a window of its own", () => {
    expect(initialState.botCatalogOpen).toBe(false);
    const opened = reducer(initialState, openBotCatalog());
    expect(opened.botCatalogOpen).toBe(false);
    expect(opened.pluginsOpen).toBe(true);
    expect(opened.pluginsPage).toBe("bots");
    expect(opened.botCatalogTarget).toBeNull();
  });

  it("carries a link to Templates (and an install link) to the tab, a new object each time", () => {
    const opened = reducer(initialState, openBotCatalog({ section: "templates", installUrl: "https://example.test/team" }));
    expect(opened.pluginsPage).toBe("bots");
    expect(opened.botCatalogTarget).toEqual({ section: "templates", installUrl: "https://example.test/team" });
    const again = reducer(opened, openBotCatalog({ section: "templates" }));
    expect(again.botCatalogTarget).toEqual({ section: "templates" });
    expect(again.botCatalogTarget).not.toBe(opened.botCatalogTarget);
  });

  it("forgets the Templates request when Connect apps closes", () => {
    const opened = reducer(initialState, openBotCatalog({ section: "templates" }));
    const closed = reducer(opened, { type: "togglePlugins", open: false });
    expect(closed.pluginsOpen).toBe(false);
    expect(closed.botCatalogTarget).toBeNull();
  });

  it("keeps Browse Bots' own window and its close action", () => {
    const windowOpen = { ...initialState, botCatalogOpen: true };
    expect(reducer(windowOpen, openBotCatalog())).toBe(windowOpen);
    const closed = reducer(windowOpen, closeBotCatalog());
    expect(closed.botCatalogOpen).toBe(false);
    expect(reducer(closed, closeBotCatalog())).toBe(closed);
  });
});
