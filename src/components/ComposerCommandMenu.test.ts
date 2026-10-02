import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { composerCommandMenu, composerGroupCommandMenu } from "@/lib/composer-commands";
import { ComposerCommandMenu } from "./ComposerCommandMenu";

describe("ComposerCommandMenu", () => {
  it("shows the groups, argument hints, and what the chat cannot run with its reason", () => {
    const items = composerCommandMenu(
      [{ id: "setup", label: "/setup", description: "Set this bot up" }],
      [
        { name: "compact", description: "Free up context", group: "engine", argumentHint: "<instructions>" },
        { name: "color", description: "Prompt bar color", group: "engine", unavailable: "interactive" },
        { name: "pulsatrix-flow:using-px-flow", description: "Flow entry", group: "plugins" },
        { name: "mcp__github__review_pr", description: "Review a PR", group: "mcp" },
      ],
      "",
    );
    const markup = renderToStaticMarkup(createElement(ComposerCommandMenu, {
      items, highlight: 0, loading: false, onPick: () => {}, onHighlight: () => {}, onRefresh: () => {},
    }));
    for (const text of ["Sagax", "Engine", "Plugins", "MCP", "/setup", "/compact", "&lt;instructions&gt;", "/pulsatrix-flow:using-px-flow", "/mcp__github__review_pr"]) {
      expect(markup).toContain(text);
    }
    expect(markup).toContain("aria-disabled=\"true\"");
    expect(markup).toContain("Needs the engine&#x27;s own terminal");
    expect(markup).not.toContain("Prompt bar color");
    expect(markup).toContain("Refresh engine commands");
  });

  it("lists a group's engine commands under each bot's name", () => {
    const compact = { name: "compact", description: "Free up context", group: "engine" as const };
    const items = composerGroupCommandMenu([{ id: "goal", label: "/goal", description: "Keep a team working" }], [
      { bot: { id: "scout", name: "Scout" }, commands: [compact], mention: true },
      { bot: { id: "pixel", name: "Pixel" }, commands: [compact, { name: "review", description: "Review", group: "plugins" }], mention: true },
    ], "");
    const markup = renderToStaticMarkup(createElement(ComposerCommandMenu, {
      items, highlight: 0, loading: false, onPick: () => {}, onHighlight: () => {},
    }));
    for (const text of ["Sagax", "Scout", "Pixel", "/goal", "/compact", "/review"]) expect(markup).toContain(text);
    // one heading per bot, never the engine groups
    expect(markup.match(/>Pixel</g)?.length).toBe(1);
    expect(markup).not.toContain(">Plugins<");
  });
});
