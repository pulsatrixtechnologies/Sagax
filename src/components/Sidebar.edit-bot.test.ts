// Edit bot in a bot's right-click menu opens the bot editor (JC, 2026-10-16).
// The sidebar never passed onEditPersona, so the item fell back to the old
// panel route and nothing visible opened.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { initialState, reducer } from "@/state/store";

describe("Edit bot from the sidebar menu", () => {
  it("is wired to the bot editor", () => {
    const source = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    const menu = source.slice(source.indexOf("<BotContextMenu"), source.indexOf("/>", source.indexOf("<BotContextMenu")));
    expect(menu).toMatch(/onEditPersona=\{\(target\) => dispatch\(\{ type: "openPersonaEditor", botId: target\.id \}\)\}/);
  });

  it("opens the editor for that bot", () => {
    const state = reducer({ ...initialState, bots: [{ id: "scout" }] as typeof initialState.bots }, { type: "openPersonaEditor", botId: "scout" });
    expect(state.personaEditor?.botId).toBe("scout");
  });
});
