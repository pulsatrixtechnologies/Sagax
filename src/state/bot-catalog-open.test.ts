import { describe, expect, it } from "vitest";

import { closeBotCatalog, initialState, openBotCatalog, reducer } from "./store";

describe("Bot catalogue modal state", () => {
  it("is closed by default and opens and closes through its two actions", () => {
    expect(initialState.botCatalogOpen).toBe(false);
    const opened = reducer(initialState, openBotCatalog());
    expect(opened.botCatalogOpen).toBe(true);
    expect(reducer(opened, openBotCatalog())).toBe(opened);
    const closed = reducer(opened, closeBotCatalog());
    expect(closed.botCatalogOpen).toBe(false);
    expect(reducer(closed, closeBotCatalog())).toBe(closed);
  });
});
