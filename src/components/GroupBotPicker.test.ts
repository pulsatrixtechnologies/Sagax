import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BotPublicProfile } from "../../shared/bot-public-profile";
import { GroupBotPicker, matchingRosterBots } from "./GroupBotPicker";

const bot = (id: string, name: string, title = ""): BotPublicProfile => ({ id, name, title, color: "green", avatarUrl: null });

describe("matchingRosterBots", () => {
  const bots = [bot("iris", "Iris", "Dev Ops"), bot("atlas", "Atlas", "Service desk")];

  it("keeps every bot when the search is empty", () => {
    expect(matchingRosterBots(bots, "  ").map((item) => item.id)).toEqual(["iris", "atlas"]);
  });

  it("matches the name or the title", () => {
    expect(matchingRosterBots(bots, "ops").map((item) => item.id)).toEqual(["iris"]);
    expect(matchingRosterBots(bots, "DESK").map((item) => item.id)).toEqual(["atlas"]);
  });
});

describe("GroupBotPicker (#1240, #1260)", () => {
  it("lists the bots this person may add, with Add and Done", () => {
    const html = renderToStaticMarkup(createElement(GroupBotPicker, {
      bots: [bot("iris", "Iris", "Dev Ops"), bot("atlas", "Atlas")],
      emptyHint: "You have no bot to add yet.",
      onAdd: () => {},
      onDone: () => {},
    }));
    expect(html).toContain("data-group-bot-picker");
    expect(html).toContain('data-add-bot="iris"');
    expect(html).toContain('data-add-bot="atlas"');
    expect(html).toContain("Iris");
    expect(html).toContain('aria-label="Search bots"');
    expect(html).toContain("Done");
    expect(html).toContain('data-roster-done=""');
    expect(html).not.toContain("You have no bot to add yet.");
  });

  it("says when there is nothing left to add, and still offers Done", () => {
    const html = renderToStaticMarkup(createElement(GroupBotPicker, {
      bots: [],
      emptyHint: "You have no bot to add yet.",
      onAdd: () => {},
      onDone: () => {},
    }));
    expect(html).toContain("You have no bot to add yet.");
    expect(html).toContain("Done");
    expect(html).not.toContain('aria-label="Search bots"');
    expect(html).not.toContain("data-add-bot");
  });

  it("hides Done when the room panel draws one Done for people and bots", () => {
    const html = renderToStaticMarkup(createElement(GroupBotPicker, {
      bots: [bot("iris", "Iris")],
      emptyHint: "none",
      showDone: false,
      onAdd: () => {},
      onDone: () => {},
    }));
    expect(html).toContain('data-add-bot="iris"');
    expect(html).not.toContain("data-roster-done");
  });
});
